// Roulette — the "brain". INSTANT family: place chips on the board, then Spin
// sends the whole layout in one POST that settles server-side; the client then
// spins the wheel and lands the ball on the server's pocket. Between spins the
// layout persists so you can re-spin the same board.
//
// Visuals are the design system's Roulette (wheel + table + win popup) inside
// the platform shell (topbar + left panel).
import { useState, useRef, useEffect } from "react";
import { apiPost } from "../api";
import { sound } from "../lib/sound";
import { reportBalance, reportStakeDebit } from "../lib/operatorBridge";
import { GameBottombar } from "./mint/GameChrome";
import {
  SPIN_S, numColor, C,
  RouletteFelt, RouletteWheel, RouletteTable, RouletteVerticalTable,
  WinPopup, UndoIcon, ClearIcon,
} from "./mint/RouletteVisuals";
import { ChipValueSelector, fmtUSD } from "./mint/ChipKit";
import { useHiloMobile } from "./mint/HiloVisuals";
import { useStableViewportHeight } from "./mint/FitBox";
import { ActionButton } from "./mint/BetPanelLite";

export default function RouletteGame({ initialBalance } = {}) {
  const [chip, setChip] = useState(1);
  // Live wallet balance. A NUMBER for in-house players (and operators that
  // expose one at launch); NULL for seamless-wallet operators, which don't —
  // in that case we never gate locally and let the server reject overbets.
  const [balance, setBalance] = useState(typeof initialBalance === "number" ? initialBalance : null);
  const [bets, setBets] = useState({});           // spotKey -> { type, n, ns, stake, count }
  const [history, setHistory] = useState([]);     // stack of prior bets snapshots (undo)
  const [spinning, setSpinning] = useState(false);
  const [busy, setBusy] = useState(false);        // API call in flight OR wheel spinning
  const [result, setResult] = useState(null);
  const [recent, setRecent] = useState([]);
  const [ball, setBall] = useState(false);
  const [pocketNum, setPocketNum] = useState(null); // server pocket -> ball drop
  const [settled, setSettled] = useState(null);   // { net, won, mult, ret }
  const [winPop, setWinPop] = useState(null);     // dedicated win popup (auto-fades)
  const [error, setError] = useState("");
  const mobile = useHiloMobile();
  const vh = useStableViewportHeight();
  const [wheelOpen, setWheelOpen] = useState(false);

  // mobile is ALWAYS the vertical table (the reference layout); the wheel
  // only appears as an overlay while spinning, then returns to the table
  const verticalMode = mobile;

  const timers = useRef([]);
  const landRef = useRef(null);   // resolves the current spin when the ball lands

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => clearTimers(), []);

  // Cash inserted mid-game must be spendable immediately — the validator
  // (and its simulator) broadcast the new balance on this event.
  useEffect(() => {
    const onCash = (e) => setBalance(e.detail.balance);
    window.addEventListener("cabinet:cash-in", onCash);
    return () => window.removeEventListener("cabinet:cash-in", onCash);
  }, []);

  const totalStaked = +Object.values(bets).reduce((s, b) => s + b.stake, 0).toFixed(2);

  // Only enforce affordability when we actually know the balance (in-house /
  // launch-balance operators). `extra` is the additional stake about to be
  // committed on top of what is already on the table.
  const balanceKnown = typeof balance === "number" && Number.isFinite(balance);
  const canAfford = (extra) => !balanceKnown || totalStaked + extra <= balance + 1e-9;
  const broke = balanceKnown && balance < 1 - 1e-9; // can't afford even the $1 minimum chip

  const flashError = (msg) => { setError(msg); later(() => setError(""), 1800); };

  function place(key, bet) {
    if (busy || spinning) return;
    if (!canAfford(chip)) { flashError("Insufficient balance"); return; }
    if (winPop) setWinPop(null);
    if (settled) { setSettled(null); setResult(null); setBall(false); }
    setHistory((h) => [...h, bets]);
    setBets((b) => {
      const x = { ...b };
      const cur = x[key];
      x[key] = { ...bet, stake: +(((cur ? cur.stake : 0) + chip)).toFixed(2), count: (cur ? cur.count : 0) + 1 };
      return x;
    });
    sound.chip();
  }
  const undo = () => {
    if (busy || spinning || history.length === 0) return;
    setBets(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    setSettled(null); setResult(null); setBall(false);
  };
  const clearBets = () => { if (busy || spinning) return; setBets({}); setHistory([]); setSettled(null); setResult(null); setBall(false); };
  // ½ / 2X act on ALL placed chips (and the chip value) — kit behavior
  const scaleBets = (fn) => { setBets((b) => { const x = {}; for (const k in b) x[k] = { ...b[k], stake: +Math.max(0.01, fn(b[k].stake)).toFixed(2) }; return x; }); };
  const halfAll = () => { if (busy || spinning) return; if (totalStaked > 0) { scaleBets((s) => s / 2); setSettled(null); setResult(null); setBall(false); } };
  const doubleAll = () => {
    if (busy || spinning || totalStaked <= 0) return;
    if (!canAfford(totalStaked)) { flashError("Insufficient balance"); return; } // doubling adds another whole stake
    scaleBets((s) => s * 2); setSettled(null); setResult(null); setBall(false);
  };

  async function spin() {
    if (busy || spinning || totalStaked <= 0) return;
    // Gate BEFORE the optimistic ball launch: without this the wheel/ball
    // fired for a bet the server would reject, then snapped back.
    if (balanceKnown && totalStaked > balance + 1e-9) { flashError("Insufficient balance"); return; }
    sound.prime();
    setBusy(true);
    setError("");
    reportStakeDebit(totalStaked); // stake leaves the operator wallet at the tap; arms its poll-guard
    setSettled(null); setResult(null); setBall(false); setWinPop(null); setPocketNum(null);
    clearTimers();

    // 0ms: the wheel is ALWAYS spinning — the tap just launches the BALL,
    // which orbits while the server answers and then drops into the pocket
    setSpinning(true);
    if (mobile) setWheelOpen(true);
    sound.wheelSpin(SPIN_S + 1.1);

    const payload = Object.values(bets).map((b) => ({ type: b.type, n: b.n, ns: b.ns, stake: b.stake }));
    const { ok, data } = await apiPost("/api/games/roulette/start", { bets: payload });
    if (!ok) {
      setSpinning(false);
      setBusy(false);
      if (mobile) setWheelOpen(false);
      setError(data.error || "Something went wrong");
      return;
    }

    const r = data.pocket;
    setPocketNum(r); // the wheel component steers the ball into this pocket

    let done = false;
    const finish = () => {
      if (done) return; done = true; landRef.current = null;
      const ret = +(data.payout || 0).toFixed(2);
      const staked = +(data.totalStaked || 0).toFixed(2);
      const net = +(ret - staked).toFixed(2);
      const mult = staked > 0 ? +(ret / staked).toFixed(2) : 0;
      setResult(r);
      setRecent((x) => [r, ...x].slice(0, 12));
      if (typeof data.balance === "number") setBalance(data.balance); // keep the local gate in sync
      reportBalance(data.balance); // operator wallet moves as the ball seats
      setSettled({ net, won: net > 0, mult, ret });
      setSpinning(false); setBall(true); setBusy(false);
      // mobile: back to the TABLE immediately; the win popup shows there
      if (mobile) setWheelOpen(false);
      if (ret > 0) {
        later(() => {
          setWinPop({ mult, amount: ret, number: r, won: mult >= 1 });
          if (mult >= 1) sound.coins();
          later(() => setWinPop(null), 3400);
        }, mobile ? 320 : 0);
      }
    };
    landRef.current = finish;             // resolves exactly when the ball seats
    later(finish, 9000);                  // fallback if frames are throttled
  }

  const locked = busy || spinning;

  const bottombar = <GameBottombar game="roulette" />;

  // total-bet readout with ½ / 2X quick buttons (scale all placed chips)
  const totalRow = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", fontWeight: 600 }}>Total Bet</span>
      <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, height: 40, display: "flex", alignItems: "center", padding: "0 12px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "var(--fs-base)", color: "var(--mint-bright)" }}>
          {fmtUSD(totalStaked)}
        </div>
        {[["½", halfAll], ["2X", doubleAll]].map(([lb, fn]) => (
          <button key={lb} onClick={fn} disabled={locked || totalStaked <= 0}
            style={{ flex: "0 0 44px", borderRadius: "var(--r-md)", border: "1px solid var(--border)", background: "var(--surface-raised)", color: "var(--text)", cursor: locked ? "default" : "pointer", opacity: (locked || totalStaked <= 0) ? 0.5 : 1, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13 }}>
            {lb}
          </button>
        ))}
      </div>
    </div>
  );

  const spinButton = (small) => (
    <ActionButton label={locked ? "Spinning…" : "Spin"} tone="primary" glow={!locked && totalStaked > 0} onClick={spin} disabled={locked || totalStaked <= 0} small={small} />
  );
  const hint = totalStaked <= 0 && !locked && (
    <div style={{ textAlign: "center", fontSize: "var(--fs-caption)", color: broke ? "var(--loss)" : "var(--text-muted)" }}>
      {broke ? "No balance to bet" : "Tap the table to place chips"}
    </div>
  );
  const chipSelector = <ChipValueSelector value={chip} onSelect={setChip} disabled={locked || broke} min={1} />;

  // Mobile sheet: action FIRST (kit `.bet-action { order: -1 }`) so the player
  // can re-spin without scrolling, then chips and total below.
  const controlsMobile = (
    <>
      {spinButton(true)}
      {chipSelector}
      {totalRow}
    </>
  );

  // ── canvas: wheel zone + table (classic) / vertical table ──

  const canvas = (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", margin: 0, padding: mobile ? (verticalMode ? "12px 0 0" : "32px 0 0") : 0, boxSizing: "border-box", overflow: "hidden" }}>
      <RouletteFelt />
      {winPop && (
        <div onClick={() => setWinPop(null)} style={{ position: "absolute", inset: 0, zIndex: 29, cursor: "pointer", background: "rgba(0,0,0,0.45)", animation: "rl-fade 240ms ease-out" }} />
      )}
      {winPop && (
        <WinPopup mult={winPop.mult} amount={winPop.amount} number={winPop.number} won={winPop.won} />
      )}
      {verticalMode && (
        <RouletteVerticalTable bets={bets} place={place} result={result} settled={settled} recent={recent} undo={undo} clearBets={clearBets} spinning={locked} canUndo={history.length > 0} totalStaked={totalStaked} />
      )}
      {!verticalMode && (<>
        {/* wheel zone */}
        <div style={{ position: "relative", zIndex: 1, width: "100%", flex: "1 1 auto", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
          {/* result square (left) — hidden on phones to save width */}
          <div style={{ position: "absolute", left: "9%", top: "50%", transform: "translateY(-50%)", width: 88, height: 88, borderRadius: 14, display: mobile ? "none" : "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Unbounded', var(--font-numeric)", fontWeight: 700, fontSize: 40, color: "#fff", background: (settled && result != null) ? (numColor(result) === "green" ? C.green : numColor(result) === "red" ? C.red : C.dark) : "#1a1d24" }}>
            {settled && result != null ? result : ""}
          </div>
          <RouletteWheel spinning={spinning} pocket={pocketNum} ball={ball} mobile={mobile} onLanded={() => landRef.current && landRef.current()} />
          {/* recent results — vertical history to the right of the wheel */}
          <div style={{ position: "absolute", right: mobile ? "1%" : "8%", top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "column", gap: mobile ? 5 : 8, zIndex: 2 }}>
            {recent.slice(0, 5).map((nn, i) => {
              const sz = mobile ? 30 : 38;
              return <span key={i} style={{ width: sz, height: sz, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: mobile ? 13 : 15, color: "#fff", opacity: 1 - i * 0.15, background: numColor(nn) === "green" ? C.green : numColor(nn) === "red" ? C.red : C.dark, boxShadow: "0 2px 6px rgba(0,0,0,0.35)" }}>{nn}</span>;
            })}
          </div>
        </div>

        {/* table; Undo/Clear live at the canvas's own bottom corners */}
        <div style={{ position: "relative", zIndex: 1, width: mobile ? "min(810px, 98%)" : "min(810px, 88%)", padding: mobile ? "0 0 10px" : "0 0 40px", flex: "0 0 auto" }}>
          <RouletteTable bets={bets} place={place} result={result} settled={settled} mobile={mobile} />
        </div>
        <div style={{ position: "absolute", left: 18, bottom: 10, zIndex: 5 }}>
          <button onClick={undo} disabled={locked || history.length === 0}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: "4px 2px", cursor: (locked || history.length === 0) ? "default" : "pointer", color: "#FFFFFF", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12.5, opacity: (locked || history.length === 0) ? 0.5 : 1 }}>
            <UndoIcon />Undo
          </button>
        </div>
        <div style={{ position: "absolute", right: 18, bottom: 10, zIndex: 5 }}>
          <button onClick={clearBets} disabled={locked || totalStaked === 0}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: "4px 2px", cursor: (locked || totalStaked === 0) ? "default" : "pointer", color: "#FFFFFF", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12.5, opacity: (locked || totalStaked === 0) ? 0.5 : 1 }}>
            Clear<ClearIcon />
          </button>
        </div>
      </>)}
      {verticalMode && wheelOpen && (
        <div onClick={() => { if (settled) setWheelOpen(false); }} style={{ position: "absolute", inset: 0, zIndex: 40, background: "var(--ink)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, cursor: settled ? "pointer" : "default", animation: "rl-fade 200ms ease-out" }}>
          <RouletteWheel spinning={spinning} pocket={pocketNum} ball={ball} mobile={mobile} onLanded={() => landRef.current && landRef.current()} />
          {winPop && <div onClick={() => { setWinPop(null); if (settled) setWheelOpen(false); }} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", cursor: "pointer" }} />}
        </div>
      )}
    </div>
  );

  // ── MOBILE ──
  if (mobile) {
    // The reference gives the TABLE almost the whole screen (the Spin button
    // just peeks at the bottom edge); chips and total scroll below. A fixed
    // tall felt also gives the vertical grid honest room, so its cell-size
    // floors never overflow the box.
    const feltH = Math.max(460, vh - 110);
    return (
      <div style={{ minHeight: vh, display: "flex", flexDirection: "column", background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
        <div style={{ height: feltH, flex: "0 0 auto", position: "relative", display: "flex", margin: "8px 8px 0", borderRadius: 12, background: "var(--ink)", overflow: "hidden" }}>
          {canvas}
        </div>
        <div style={{ flex: "0 0 auto", padding: "10px 12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {error && <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-caption)", fontWeight: 600 }}>{error}</div>}
          {controlsMobile}
        </div>
        {bottombar}
      </div>
    );
  }

  // ── CABINET: the wheel + table own the whole screen, controls docked
  // bottom — same chip selector / total / spin blocks as the old left panel,
  // re-docked side by side in a horizontal strip above the bottombar. ──
  return (
    <div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", padding: 14, boxSizing: "border-box", alignItems: "stretch" }}>
        {/* overflow auto + inner min-height: short viewports scroll instead of clipping the table */}
        <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", boxSizing: "border-box", overflow: "auto" }}>
          <div style={{ position: "relative", width: "100%", minHeight: 560, display: "flex" }}>
            {canvas}
          </div>
        </div>
      </div>
      <div style={{
        flex: "0 0 auto", boxSizing: "border-box", width: "100%",
        display: "flex", alignItems: "flex-end", gap: 14, padding: "12px 18px 14px",
        background: "var(--surface)", borderTop: "1px solid var(--border)",
      }}>
        <div style={{ flex: "0 0 auto" }}>
          {/* full tray — every chip visible, slot-machine style */}
          <ChipValueSelector value={chip} onSelect={setChip} disabled={locked || broke} min={1} full />
        </div>
        <div style={{ flex: "0 0 240px" }}>
          {totalRow}
        </div>
        <div style={{ flex: 1 }} />
        {error && (
          <div style={{ alignSelf: "center", maxWidth: 300, padding: "10px 14px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>
            {error}
          </div>
        )}
        <div style={{ flex: "0 0 300px" }}>
          <ActionButton label={locked ? "Spinning…" : "Spin"} tone="primary" glow={!locked && totalStaked > 0} onClick={spin} disabled={locked || totalStaked <= 0} large />
        </div>
      </div>
      {bottombar}
    </div>
  );
}
