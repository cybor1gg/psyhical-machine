// Dragon Tower — the "brain". Same climb-family contract as hilo:
// start / guess / cashout / active. Server-authoritative: layouts live on the
// server until a row is climbed or the round settles; this component renders
// exactly what the API reveals.
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { apiGet, apiPost } from "../api";
import { sound } from "../lib/sound";
import { reportBalance, reportStakeDebit, reportRoundEnd } from "../lib/operatorBridge";
import { GameBottombar } from "./mint/GameChrome";
import { useStableViewportHeight } from "./mint/FitBox";
import { TowerGrid, TowerBackdrop, DifficultyPicker } from "./mint/TowerVisuals";
import { HiloWinPopup, useHiloMobile } from "./mint/HiloVisuals";
import { BetAmountInput, ActionButton, StatField, BetPanelLite } from "./mint/BetPanelLite";

const ROWS = 9;
const DIFF_TILES = { easy: 4, medium: 3, hard: 2, expert: 3, master: 4 };

export default function TowerGame({ initialBalance, onHome }) {
  const [amount, setAmount] = useState("10.00");
  const [balance, setBalance] = useState(typeof initialBalance === "number" ? initialBalance : null);
  const maxBet = () => { if (typeof balance === "number" && Number.isFinite(balance)) setAmount(balance.toFixed(2)); };
  const [difficulty, setDifficulty] = useState("medium");
  const [active, setActive] = useState(false);
  const [tilesPerRow, setTilesPerRow] = useState(3);
  const [ladderValues, setLadderValues] = useState([]);
  const [currentRow, setCurrentRow] = useState(0);
  const [revealed, setRevealed] = useState([]); // climbed rows: {dragons, pick}
  const [towerReveal, setTowerReveal] = useState(null); // full reveal at settle
  const [mult, setMult] = useState(1);
  const [result, setResult] = useState(null); // 'lost' | 'cashed_out'
  const [winPop, setWinPop] = useState(null);
  const [pendingTile, setPendingTile] = useState(null); // tile awaiting the server
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mobile = useHiloMobile();
  const vh = useStableViewportHeight();
  const timers = useRef([]);
  const bet = parseFloat(amount) || 0;

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => clearTimers(), []);
  const money = (v) => (Math.floor(Math.abs(v) * 100 + 1e-9) / 100).toFixed(2);

  // resume
  const initRan = useRef(false);
  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    apiGet("/api/games/tower/active").then(({ ok, data }) => {
      if (!ok || !data.active) return;
      setDifficulty(data.difficulty);
      setTilesPerRow(data.tilesPerRow);
      setLadderValues(data.ladder);
      setCurrentRow(data.currentRow);
      setRevealed(data.revealed);
      setMult(data.multiplier);
      setAmount(Number(data.betAmount).toFixed(2));
      setActive(true);
    });
  }, []);

  async function api(path, body) {
    setBusy(true);
    setError("");
    const { ok, data } = await apiPost(path, body);
    setBusy(false);
    if (!ok) {
      setError(data.error || "Something went wrong");
      return null;
    }
    return data;
  }

  async function start() {
    if (busy || active) return;
    if (typeof balance === "number" && Number.isFinite(balance) && (bet) > balance + 1e-9) { setError("Insufficient balance"); return; }
    sound.prime();
    sound.tileTap();
    clearTimers();
    setResult(null);
    setTowerReveal(null);
    setWinPop(null);
    setRevealed([]);
    // 0ms optimistic: the tower arms the instant the player taps — row 0
    // lights up immediately; the ladder fills in when the server answers.
    // Picks stay gated on `busy` until the round exists server-side.
    setTilesPerRow(DIFF_TILES[difficulty]);
    setLadderValues([]);
    setCurrentRow(0);
    setMult(1);
    setActive(true);
    reportStakeDebit(bet); // stake leaves the operator wallet at the tap
    const data = await api("/api/games/tower/start", { betAmount: bet, difficulty });
    if (!data) { setActive(false); return; }
    if (typeof data.balance === "number") setBalance(data.balance);
    reportBalance(data.balance, null, "stake"); // server truth; the climb is still in flight
    setTilesPerRow(data.tilesPerRow);
    setLadderValues(data.ladder);
  }

  async function pick(tile) {
    if (busy || !active || pendingTile != null) return;
    sound.prime();
    sound.tileTap();          // instant press feedback
    setPendingTile(tile);     // tile pulses while the server decides
    const data = await api("/api/games/tower/guess", { tile });
    setPendingTile(null);
    if (!data) return;
    if (!data.won) {
      // bust: crystal shatters, then the rest of the tower is revealed
      sound.shatter();
      reportRoundEnd(); // bust pays nothing — closes the round for the host
      setRevealed((r) => [...r, data.row]);
      setActive(false);
      setResult("lost");
      later(() => setTowerReveal(data.tower), 700);
      return;
    }
    sound.gemPing(data.currentRow ?? revealed.length + 1); // pitch climbs with the tower
    setRevealed((r) => [...r, data.row]);
    if (data.top) {
      // reached the top: auto-settled as a win
      sound.cashOut();
      if (typeof data.balance === "number") setBalance(data.balance);
      reportRoundEnd(data.balance); // operator wallet moves with the cash-out
      setMult(data.multiplier);
      setActive(false);
      setResult("cashed_out");
      setTowerReveal(data.tower);
      setWinPop({ mult: data.multiplier, amount: data.payout });
      later(() => setWinPop(null), 3400);
      return;
    }
    setCurrentRow(data.currentRow);
    setMult(data.multiplier);
  }

  async function cashout() {
    if (busy || !active || currentRow < 1) return;
    sound.prime();
    const data = await api("/api/games/tower/cashout");
    if (!data) return;
    sound.cashOut();
    if (typeof data.balance === "number") setBalance(data.balance);
    reportRoundEnd(data.balance); // operator wallet moves with the cash-out
    setActive(false);
    setResult("cashed_out");
    setTowerReveal(data.tower);
    setWinPop({ mult: data.multiplier, amount: data.payout });
    later(() => setWinPop(null), 3400);
  }

  // Build per-row render state (bottom row first).
  const rowsState = Array.from({ length: ROWS }, (_, r) => {
    if (towerReveal) {
      const row = towerReveal[r];
      if (row.pick != null) {
        return { kind: "climbed", dragons: row.dragons, pick: row.pick, bust: row.dragons.includes(row.pick) };
      }
      return { kind: "revealed", dragons: row.dragons, pick: null, bust: false };
    }
    if (r < revealed.length) {
      const row = revealed[r];
      return { kind: "climbed", dragons: row.dragons, pick: row.pick, bust: row.dragons.includes(row.pick) };
    }
    if (active && r === currentRow) return { kind: "active", dragons: null, pick: null, bust: false };
    return { kind: "locked", dragons: null, pick: null, bust: false };
  });

  const displayLadder = ladderValues.length ? ladderValues : Array.from({ length: ROWS }, () => "…");
  const canCashout = active && currentRow >= 1;
  const actionLabel = active
    ? (canCashout ? `Cashout $${money(bet * mult)}` : "Pick a tile to climb")
    : "Bet";

  const bottombar = <GameBottombar game="tower" />;

  // DESKTOP: fit the tower to the canvas — measure the container and derive
  // tile height so all nine rows always fit without page scroll.
  // MOBILE: fixed comfortable tile size; the board renders at its natural
  // height and the PAGE scrolls — rows are never squeezed or clipped.
  const canvasRef = useRef(null);
  const [fit, setFit] = useState({ tileH: mobile ? 34 : 48, rowWidth: mobile ? 320 : 470 });
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const H = el.clientHeight, W = el.clientWidth;
      if (!W) return;
      // per-row footprint = tileH + row padding/border + grid gap
      const tileH = mobile
        ? 34
        : Math.max(30, Math.min(54, Math.floor(((H || 0) - 56) / ROWS - 19)));
      // mobile: full bleed between the edge pillars (18px each + breathing)
      const rowWidth = Math.max(236, Math.min(mobile ? 400 : 470, W - (mobile ? 52 : 110)));
      setFit((f) => (f.tileH === tileH && f.rowWidth === rowWidth ? f : { tileH, rowWidth }));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [mobile]);

  const table = (
    <div ref={canvasRef} style={{
      position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: "100%",
      ...(mobile
        ? { flex: "0 0 auto", padding: "10px 4px 14px" }
        : { flex: 1, minHeight: 0, padding: "14px 10px", overflow: "hidden" }),
    }}>
      <TowerBackdrop compact={mobile} />
      {winPop && <div onClick={() => setWinPop(null)} style={{ position: "absolute", inset: 0, zIndex: 29, cursor: "pointer", background: "rgba(0,0,0,0.45)", animation: "rl-fade 240ms ease-out" }} />}
      {winPop && <HiloWinPopup mult={winPop.mult} amount={winPop.amount} />}
      <TowerGrid rowsState={rowsState}
        tilesPerRow={active || towerReveal ? tilesPerRow : DIFF_TILES[difficulty]}
        onPick={pick} busy={busy} compact={mobile}
        pendingTile={pendingTile} ladderValues={displayLadder} rowWidth={fit.rowWidth} tileH={fit.tileH} />
    </div>
  );

  // ── MOBILE: viewport-locked — controls pinned below, bottom chrome bar,
  // the tower SCALES to the space between so all nine rows always fit. ──
  if (mobile) {
    return (
      // scrolling page like roulette: the tower renders at its natural size
      // on top, controls flow below, the PAGE scrolls — nothing pinned
      <div style={{ minHeight: vh, display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
        <div style={{ flex: "0 0 auto", position: "relative", display: "flex", justifyContent: "center", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }}>
          {table}
        </div>
        <div style={{ flex: "1 1 auto", padding: "8px 12px 14px", display: "flex", flexDirection: "column", gap: 8, background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
          {error && (
            <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-caption)", fontWeight: 600 }}>{error}</div>
          )}
          <ActionButton label={actionLabel} tone={active ? "gold" : "primary"}
            onClick={active ? cashout : start} disabled={busy || (active && !canCashout)} small />
          <DifficultyPicker value={difficulty} onChange={setDifficulty} disabled={active || busy} />
          <BetAmountInput value={amount} onChange={setAmount} disabled={active}
            onHalf={() => setAmount(String(Math.max(0, bet / 2).toFixed(2)))}
            onDouble={() => setAmount(String((bet * 2).toFixed(2)))}
            onMax={maxBet} label="Bet Amount" small />
        </div>
        {bottombar}
      </div>
    );
  }

  // ── DESKTOP ── (height pinned: the tower fits itself to the canvas, so the
  // page must never scroll)
  return (
    <div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 14, padding: 14, boxSizing: "border-box", alignItems: "stretch" }}>
        <div style={{ flex: "0 0 var(--betpanel-w)", width: "var(--betpanel-w)" }}>
          <BetPanelLite
            amount={amount} onAmount={setAmount} betLocked={active} onMax={maxBet}
            actionLabel={actionLabel} actionTone={active ? "gold" : "primary"} glow={!active}
            onAction={active ? cashout : start} actionDisabled={busy || (active && !canCashout)}
            error={error}
          >
            <DifficultyPicker value={difficulty} onChange={setDifficulty} disabled={active || busy} />
            <StatField
              label={active && currentRow < ROWS && typeof displayLadder[currentRow] === "number"
                ? `Row ${currentRow}/${ROWS} · next pays ×${displayLadder[currentRow].toFixed(2)}`
                : `Current Multiplier (row ${currentRow}/${ROWS})`}
              value={`×${mult.toFixed(4)}`} tone="mint" />
          </BetPanelLite>
        </div>
        <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", padding: "12px 10px", boxSizing: "border-box", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }} />
          {table}
        </div>
      </div>
      {bottombar}
    </div>
  );
}
