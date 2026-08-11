// Plinko — the "brain". INSTANT family: every drop is one POST that settles
// server-side; the client animates the exact left/right chain the server
// returned. Rapid taps pour multiple balls — each is its own settled round,
// and the balance lands as each ball reaches its bucket.
import { useState, useEffect } from "react";
import { apiGet, apiPost } from "../api";
import { sound } from "../lib/sound";
import { reportBalance, nextBalanceSeq, reportStakeDebit } from "../lib/operatorBridge";
import { GameBottombar } from "./mint/GameChrome";
import { FitBox, useStableViewportHeight } from "./mint/FitBox";
import { PlinkoBoard, PlinkoRowsSlider, buildBallPath } from "./mint/PlinkoVisuals";
import { useHiloMobile } from "./mint/HiloVisuals";
import { BetAmountInput, ActionButton, StatField, SelectField, CabinetControlBar } from "./mint/BetPanelLite";

const RISKS = [
  { key: "low", label: "Low" },
  { key: "medium", label: "Medium" },
  { key: "high", label: "High" },
];

export default function PlinkoGame({ initialBalance, onHome }) {
  const [amount, setAmount] = useState("10.00");
  const [balance, setBalance] = useState(typeof initialBalance === "number" ? initialBalance : null);
  const maxBet = () => { if (typeof balance === "number" && Number.isFinite(balance)) setAmount(balance.toFixed(2)); };
  const [rows, setRows] = useState(16);
  const [risk, setRisk] = useState("medium");
  const [table, setTable] = useState([]);
  const [balls, setBalls] = useState([]);
  const [primers, setPrimers] = useState([]); // 0ms drop-in balls awaiting the server
  const [flash, setFlash] = useState({});
  const [error, setError] = useState("");
  const mobile = useHiloMobile();
  const vh = useStableViewportHeight();
  const bet = parseFloat(amount) || 0;

  // Cash inserted mid-game must be spendable immediately — the validator
  // (and its simulator) broadcast the new balance on this event.
  useEffect(() => {
    const onCash = (e) => setBalance(e.detail.balance);
    window.addEventListener("cabinet:cash-in", onCash);
    return () => window.removeEventListener("cabinet:cash-in", onCash);
  }, []);

  // The scaled payout table comes from the server (it depends on the
  // operator's RTP) — refetch on rows/risk change; the drop response
  // refreshes it too, so it can never go stale against a real bet.
  useEffect(() => {
    let dead = false;
    apiGet(`/api/games/plinko/table?rows=${rows}&risk=${risk}`).then(({ ok, data }) => {
      if (!dead && ok) setTable(data.table);
    });
    return () => { dead = true; };
  }, [rows, risk]);

  const land = (ball) => {
    // Each ball carries the balance after ITS round settled — reporting it
    // here (not at the POST) steps the operator wallet ball-by-ball, in
    // sync with what the player watches. The seq (claimed at response
    // arrival = ledger order) stops an out-of-order landing from stepping
    // the wallet backwards onto a stale balance.
    reportBalance(ball.balance, ball.seq);
    setFlash((f) => ({ ...f, [ball.bucket]: ball.id }));
    setTimeout(() => setFlash((f) => { const n = { ...f }; if (n[ball.bucket] === ball.id) delete n[ball.bucket]; return n; }), 520);
    // sub-1× buckets land silently (client preference — no defeat beat)
    if (ball.mult >= 10) sound.cashOut();
    else if (ball.mult >= 1) sound.tick(ball.mult);
    setBalls((b) => b.filter((bb) => bb.id !== ball.id));
  };

  // No client-side pour limit: every tap is its own settled round, and every
  // ball stays on the board until it lands. The only real limits are the
  // player's balance and the table's bet bounds — the server enforces both
  // and the error banner reports them.
  async function drop() {
    if (typeof balance === "number" && Number.isFinite(balance) && (bet) > balance + 1e-9) { setError("Insufficient balance"); return; }
    sound.prime();
    sound.tileTap();
    setError("");
    reportStakeDebit(bet); // stake leaves the operator wallet at the tap; arms its poll-guard
    // 0ms: a primer ball drops in at the release point the instant the
    // player taps; the real server-path ball replaces it seamlessly (both
    // start from the same spot above the first pin row)
    const pid = "p" + Date.now() + Math.random().toString(36).slice(2);
    setPrimers((p) => [...p, pid]);
    const { ok, data } = await apiPost("/api/games/plinko/start", { betAmount: bet, rows, risk });
    setPrimers((p) => p.filter((x) => x !== pid));
    if (!ok) {
      setError(data.error || "Something went wrong");
      return;
    }
    setTable(data.table);
    const path = buildBallPath(data.rows, data.directions);
    if (typeof data.balance === "number") setBalance(data.balance);
    setBalls((b) => [...b, { id: data.roundId, ...path, bucket: data.bucket, mult: data.multiplier, balance: data.balance, seq: nextBalanceSeq() }]);
  }

  const bottombar = <GameBottombar game="plinko" />;

  const riskPicker = (
    <SelectField label="Risk" value={risk} onChange={setRisk} disabled={balls.length > 0}
      options={RISKS.map((r) => ({ value: r.key, label: r.label }))} />
  );

  const board = (
    <PlinkoBoard rows={rows} table={table.length ? table : Array(rows + 1).fill(0)} balls={balls} primers={primers} flash={flash} onLand={land} compact={mobile} />
  );

  // ── MOBILE ──
  if (mobile) {
    return (
      // scrolling page like roulette: board at natural size on top, controls
      // flow below it, the PAGE scrolls — nothing pinned, no fit-scaling
      <div style={{ minHeight: vh, display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
        <div style={{ flex: "0 0 auto", position: "relative", padding: "12px 10px 12px", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }}>
          {board}
        </div>
        <div style={{ flex: "1 1 auto", padding: "10px 12px 14px", display: "flex", flexDirection: "column", gap: 8, background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
          {error && (
            <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-caption)", fontWeight: 600 }}>{error}</div>
          )}
          <ActionButton label="Bet" tone="primary" onClick={drop} small />
          {riskPicker}
          <PlinkoRowsSlider value={rows} onChange={setRows} disabled={balls.length > 0} />
          <BetAmountInput value={amount} onChange={setAmount} disabled={false}
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
    <div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 26px 10px", boxSizing: "border-box", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }} />
        <FitBox>
          <div style={{ width: "min(640px, 92vw)" }}>{board}</div>
        </FitBox>
      </div>
      <CabinetControlBar
        amount={amount} onAmount={setAmount} betLocked={false} onMax={maxBet}
        actionLabel="Bet" actionTone="primary" glow
        onAction={drop} error={error}
      >
        <div style={{ flex: "0 0 auto", minWidth: 190 }}>
          {riskPicker}
        </div>
        <div style={{ flex: "0 0 auto", minWidth: 220 }}>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", fontWeight: 600, marginBottom: 6 }}>Rows</div>
          <PlinkoRowsSlider value={rows} onChange={setRows} disabled={balls.length > 0} />
        </div>
        <div style={{ flex: "0 0 auto", minWidth: 170 }}>
          <StatField label="Top payout" value={table.length ? `×${Math.max(...table).toFixed(2)}` : "—"} tone="mint" />
        </div>
      </CabinetControlBar>
      {bottombar}
    </div>
  );
}
