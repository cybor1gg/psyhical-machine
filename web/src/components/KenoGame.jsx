// Keno — the "brain". INSTANT family: one POST settles the round; the client
// paces the ten reveals (~170ms apart) exactly like the design. The scaled
// payout ladder comes from the server so operator RTP overrides always show
// real numbers.
import { useState, useEffect, useRef } from "react";
import { apiGet, apiPost } from "../api";
import { sound } from "../lib/sound";
import { reportBalance, reportStakeDebit } from "../lib/operatorBridge";
import { GameBottombar } from "./mint/GameChrome";
import { FitBox, useStableViewportHeight } from "./mint/FitBox";
import { KenoBoard, KenoDock, KenoGem, fmtMult } from "./mint/KenoVisuals";
import { useHiloMobile } from "./mint/HiloVisuals";
import { BetAmountInput, ActionButton, BetPanelLite, SelectField } from "./mint/BetPanelLite";

const RISKS = ["classic", "low", "medium", "high", "extreme"];
const REVEAL_MS = 170;

export default function KenoGame({ initialBalance }) {
  const [amount, setAmount] = useState("10.00");
  const [balance, setBalance] = useState(typeof initialBalance === "number" ? initialBalance : null);
  const maxBet = () => { if (typeof balance === "number" && Number.isFinite(balance)) setAmount(balance.toFixed(2)); };
  const [risk, setRisk] = useState("medium");
  const [picks, setPicks] = useState(() => new Set());
  const [drawn, setDrawn] = useState([]);      // revealed so far
  const [drawing, setDrawing] = useState(false);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState(null);  // {hits, mult, payout}
  const [winPop, setWinPop] = useState(null);
  const [table, setTable] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mobile = useHiloMobile();
  const vh = useStableViewportHeight();
  const timers = useRef([]);
  const bet = parseFloat(amount) || 0;
  const np = picks.size;
  const locked = drawing || busy;

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => clear(), []);
  const money = (v) => (Math.floor(Math.abs(v) * 100 + 1e-9) / 100).toFixed(2);

  // Scaled ladder from the server, per risk + pick count.
  useEffect(() => {
    if (np === 0) { setTable(null); return; }
    let dead = false;
    apiGet(`/api/games/keno/table?risk=${risk}&picks=${np}`).then(({ ok, data }) => {
      if (!dead && ok) setTable(data.table);
    });
    return () => { dead = true; };
  }, [risk, np]);

  const reset = () => { clear(); setDrawn([]); setDone(false); setResult(null); setDrawing(false); setWinPop(null); };

  const toggle = (n) => {
    if (locked) return;
    if (done) reset();
    setPicks((s) => {
      const x = new Set(s);
      if (x.has(n)) x.delete(n);
      else if (x.size < 10) x.add(n);
      return x;
    });
    sound.tileTap();
  };

  const autoPick = () => {
    if (locked) return;
    reset();
    const pool = [];
    while (pool.length < 10) { const n = 1 + Math.floor(Math.random() * 40); if (!pool.includes(n)) pool.push(n); }
    setPicks(new Set());
    pool.forEach((n, i) => later(() => {
      setPicks((s) => { const x = new Set(s); x.add(n); return x; });
      sound.tileTap();
    }, i * 90));
  };
  const clearPicks = () => { if (locked) return; reset(); setPicks(new Set()); };

  async function betNow() {
    if (locked || np === 0) return;
    if (typeof balance === "number" && Number.isFinite(balance) && (bet) > balance + 1e-9) { setError("Insufficient balance"); return; }
    sound.prime();
    clear();
    setError("");
    setWinPop(null);
    setDrawn([]);
    setDone(false);
    setResult(null);
    setBusy(true);
    reportStakeDebit(bet); // stake leaves the operator wallet at the tap
    const { ok, data } = await apiPost("/api/games/keno/start", { betAmount: bet, picks: [...picks], risk });
    setBusy(false);
    if (!ok) {
      setError(data.error || "Something went wrong");
      return;
    }
    setTable(data.table);
    setDrawing(true);
    const pickSet = new Set(data.picks);
    data.drawn.forEach((n, i) => {
      later(() => {
        setDrawn((d) => [...d, n]);
        if (pickSet.has(n)) sound.gemPing(Math.min(8, i + 1)); else sound.tileTap();
      }, 220 + i * REVEAL_MS);
    });
    later(() => {
      if (typeof data.balance === "number") setBalance(data.balance);
      reportBalance(data.balance); // operator wallet moves as the draw completes
      setResult({ hits: data.hits, mult: data.multiplier, payout: data.payout });
      setDone(true);
      setDrawing(false);
      if (data.multiplier >= 1) {
        if (data.multiplier >= 10) sound.cashOut(); else sound.tick(Math.min(4, data.multiplier));
        setWinPop({ mult: data.multiplier, payout: data.payout });
        later(() => setWinPop(null), 3000);
      }
      // losing draws end silently (client preference — no defeat beat)
    }, 220 + 10 * REVEAL_MS + 250);
  }

  const bottombar = <GameBottombar game="keno" />;

  const drawnSet = new Set(drawn);
  const liveHits = drawing || done ? drawn.filter((n) => picks.has(n)).length : -1;

  const pickBtn = {
    height: 36, borderRadius: "var(--r-md)", border: "1px solid var(--border)",
    background: "var(--surface-raised)", color: "var(--text)",
    fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 12.5, cursor: "pointer",
  };

  const riskPicker = (
    <SelectField label="Risk" value={risk} disabled={locked}
      onChange={(r) => { if (!locked) { setRisk(r); reset(); } }}
      options={RISKS.map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) }))} />
  );

  const board = (
    <div style={{ position: "relative", width: "100%", maxWidth: 620, margin: "0 auto", display: "flex", flexDirection: "column", gap: 10 }}>
      {winPop && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30, pointerEvents: "none" }}>
          <div style={{ background: "#37dd84", borderRadius: 18, padding: 6, boxShadow: "0 20px 55px rgba(0,0,0,0.55)", minWidth: 210, animation: "mb-pop var(--dur-base) var(--ease-bounce)" }}>
            <div style={{ padding: "13px 26px 10px", textAlign: "center", fontFamily: "'Unbounded', var(--font-numeric)", fontWeight: 800, fontSize: 29, color: "#062018", letterSpacing: "-0.02em" }}>x{fmtMult(winPop.mult)}</div>
            <div style={{ background: "#0e1014", border: "2px solid #37dd84", borderRadius: 13, padding: "10px 16px", textAlign: "center", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 15, color: "#fff" }}>${money(winPop.payout)}</div>
          </div>
        </div>
      )}
      <div style={{ filter: winPop ? "brightness(0.62)" : "none", transition: "filter var(--dur-base) var(--ease-out)" }}>
        <KenoBoard picks={picks} drawn={drawnSet} onToggle={toggle} locked={locked} />
      </div>
      {/* One reserved slot holds either the hint (no picks) or the payout dock
          (picks) so the board keeps a stable height — the FitBox scale, and thus
          the grid size, never jumps between the two states on mobile. */}
      <div style={{ minHeight: 74, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {np === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 14px", borderRadius: "var(--r-md)", border: "1px solid var(--border)", background: "rgba(35,51,68,0.30)", color: "var(--text-muted)", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5 }}>
            Select 1–10 numbers to play
          </div>
        ) : (
          <KenoDock table={table} liveHits={liveHits} resultHits={result?.hits} settled={done} />
        )}
      </div>
    </div>
  );

  // ── MOBILE ──
  if (mobile) {
    return (
      <div style={{ height: vh, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
        <div style={{ flex: "1 1 auto", minHeight: 0, position: "relative", display: "flex", padding: "12px 10px 12px", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }}>
          <FitBox>{board}</FitBox>
        </div>
        <div style={{ flex: "0 0 auto", maxHeight: "60%", overflowY: "auto", padding: "8px 12px 14px", display: "flex", flexDirection: "column", gap: 8, background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
          {error && (
            <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-caption)", fontWeight: 600 }}>{error}</div>
          )}
          <ActionButton label={done ? "Bet Again" : np === 0 ? "Pick numbers first" : "Bet"} tone="primary" glow={!locked}
            onClick={betNow} disabled={locked || np === 0} small />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button onClick={autoPick} style={pickBtn}>Auto Pick</button>
            <button onClick={clearPicks} style={pickBtn}>Clear ({np}/10)</button>
          </div>
          {riskPicker}
          <BetAmountInput value={amount} onChange={setAmount} disabled={locked}
            onHalf={() => setAmount(String(Math.max(0, bet / 2).toFixed(2)))}
            onDouble={() => setAmount(String((bet * 2).toFixed(2)))}
            onMax={maxBet} label="Bet Amount" small />
        </div>
        {bottombar}
      </div>
    );
  }

  // ── DESKTOP ──
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 14, padding: 14, boxSizing: "border-box", alignItems: "stretch" }}>
        <div style={{ flex: "0 0 var(--betpanel-w)", width: "var(--betpanel-w)" }}>
          <BetPanelLite
            amount={amount} onAmount={setAmount} betLocked={locked} onMax={maxBet}
            actionLabel={done ? "Bet Again" : np === 0 ? "Pick numbers first" : "Bet"} actionTone="primary" glow={!locked}
            onAction={betNow} actionDisabled={locked || np === 0} error={error}
          >
            {riskPicker}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button onClick={autoPick} style={pickBtn}>Auto Pick</button>
              <button onClick={clearPicks} style={pickBtn}>Clear Table</button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 13px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
              <span style={{ color: "var(--text-muted)", fontSize: 12.5, fontWeight: 600 }}>Selected</span>
              <span style={{ fontFamily: "var(--font-numeric)", fontWeight: 700, color: np ? "var(--mint-bright)" : "var(--text-muted)" }}>{np} / 10</span>
            </div>
          </BetPanelLite>
        </div>
        <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", padding: "14px 16px", boxSizing: "border-box", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }} />
          {board}
        </div>
      </div>
      {bottombar}
    </div>
  );
}
