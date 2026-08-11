// Limbo — the "brain". INSTANT family like dice: one POST settles the round;
// the big multiplier counts up to the rolled result and the outcome sound +
// balance land when the count finishes.
import { useState, useRef, useEffect } from "react";
import { apiPost } from "../api";
import { sound } from "../lib/sound";
import { reportBalance, reportStakeDebit } from "../lib/operatorBridge";
import { MultiplierDisplay } from "./mint/LimboVisuals";
import { DiceField, RecentPills } from "./mint/DiceVisuals";
import { useHiloMobile } from "./mint/HiloVisuals";
import { GameBottombar } from "./mint/GameChrome";
import { FitBox, useStableViewportHeight } from "./mint/FitBox";
import { BetAmountInput, ActionButton, StatField, CabinetControlBar } from "./mint/BetPanelLite";

const COUNT_MS = 420;
const MAX_TARGET_UI = 10000; // display clamp; the server enforces the real cap

export default function LimboGame({ initialBalance }) {
  const [amount, setAmount] = useState("10.00");
  const [balance, setBalance] = useState(typeof initialBalance === "number" ? initialBalance : null);
  const maxBet = () => { if (typeof balance === "number" && Number.isFinite(balance)) setAmount(balance.toFixed(2)); };
  const [target, setTarget] = useState(2);
  const [value, setValue] = useState(1);
  const [runId, setRunId] = useState(null);
  const [state, setState] = useState("idle"); // idle | win | big | loss
  const [rolls, setRolls] = useState([]);
  const [payoutFactor, setPayoutFactor] = useState(0.99);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mobile = useHiloMobile();
  const vh = useStableViewportHeight();
  const timers = useRef([]);
  const bet = parseFloat(amount) || 0;

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Cash inserted mid-game must be spendable immediately — the validator
  // (and its simulator) broadcast the new balance on this event.
  useEffect(() => {
    const onCash = (e) => setBalance(e.detail.balance);
    window.addEventListener("cabinet:cash-in", onCash);
    return () => window.removeEventListener("cabinet:cash-in", onCash);
  }, []);

  const winChance = Math.min(1, payoutFactor / target);
  const setTargetSafe = (m) => setTarget(Math.min(MAX_TARGET_UI, Math.max(1.01, +(+m).toFixed(2))));

  async function doRoll() {
    if (busy) return;
    if (typeof balance === "number" && Number.isFinite(balance) && (bet) > balance + 1e-9) { setError("Insufficient balance"); return; }
    sound.prime();
    sound.cardDeal();
    setBusy(true);
    setError("");
    reportStakeDebit(bet); // stake leaves the operator wallet at the tap
    const { ok, data } = await apiPost("/api/games/limbo/start", { betAmount: bet, target });
    if (!ok) {
      setBusy(false);
      setError(data.error || "Something went wrong");
      return;
    }
    setPayoutFactor(Math.round(data.winChance * data.target * 10000) / 10000);
    setValue(data.result);
    setRunId(data.roundId);
    setState(data.won ? (data.target >= 50 ? "big" : "win") : "loss");
    later(() => {
      if (typeof data.balance === "number") setBalance(data.balance);
      reportBalance(data.balance); // operator wallet moves as the number lands
      setRolls((prev) => [{ n: data.result, won: data.won, id: data.roundId }, ...prev].slice(0, 6));
      // wins get their tick; losses land silently (client preference — the
      // red number is the whole story, no defeat beat on any Original)
      if (data.won) sound.tick(Math.min(4, data.target));
      setBusy(false);
    }, COUNT_MS + 60);
  }

  const bottombar = <GameBottombar game="limbo" />;

  const board = (
    <div style={{ position: "relative", width: "100%", maxWidth: 880, margin: "0 auto", height: "100%", display: "flex", flexDirection: "column", gap: mobile ? 12 : 18 }}>
      <RecentPills rolls={rolls} fmt={(rr) => rr.n.toFixed(2) + "×"} />
      {/* no "Win +$x" pill: the bet panel's Payout on Win already says the money,
          and the green number IS the win signal */}
      <div style={{ flex: 1, minHeight: mobile ? 160 : 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <MultiplierDisplay value={value} state={state} runId={runId} size={mobile ? "clamp(52px, 17vw, 84px)" : "clamp(64px, 13vw, 124px)"} duration={COUNT_MS} />
      </div>
      <div style={{ display: "flex", gap: mobile ? 8 : 22, flexWrap: "wrap" }}>
        <DiceField label="Target Multiplier" value={target.toFixed(2)} suffix="×" editable compact={mobile}
          onCommit={(m) => setTargetSafe(m)} />
        <DiceField label="Win Chance" value={(winChance * 100).toFixed(2)} suffix="%" editable compact={mobile}
          onCommit={(ch) => setTargetSafe((payoutFactor * 100) / Math.min(98, Math.max(0.01, ch)))} />
      </div>
    </div>
  );

  // ── MOBILE ──
  if (mobile) {
    return (
      <div style={{ height: vh, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
        <div style={{ flex: "1 1 auto", minHeight: 0, position: "relative", display: "flex", padding: "14px 12px 14px", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }}>
          <FitBox>{board}</FitBox>
        </div>
        <div style={{ flex: "0 0 auto", maxHeight: "60%", overflowY: "auto", padding: "8px 12px 14px", display: "flex", flexDirection: "column", gap: 8, background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
          {error && (
            <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-caption)", fontWeight: 600 }}>{error}</div>
          )}
          <ActionButton label={busy ? "Rolling…" : "Bet"} tone="primary" glow={!busy} onClick={doRoll} disabled={busy} small />
          <BetAmountInput value={amount} onChange={setAmount} disabled={busy}
            onHalf={() => setAmount(String(Math.max(0, bet / 2).toFixed(2)))}
            onDouble={() => setAmount(String((bet * 2).toFixed(2)))}
            onMax={maxBet} label="Bet Amount" small />
        </div>
        {bottombar}
      </div>
    );
  }

  // ── CABINET: the board owns the whole screen, controls docked bottom ──
  return (
    <div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column", padding: "14px 26px 10px", boxSizing: "border-box", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }} />
        {board}
      </div>
      <CabinetControlBar
        amount={amount} onAmount={setAmount} betLocked={busy} onMax={maxBet}
        actionLabel={busy ? "Rolling…" : "Bet"} actionTone="primary" glow={!busy}
        onAction={doRoll} actionDisabled={busy} error={error}
      >
        <div style={{ flex: "0 0 auto", minWidth: 170 }}>
          <StatField label="Payout on Win" value={`$${(Math.floor(bet * target * 100) / 100).toFixed(2)} · ${target.toFixed(2)}×`} tone="mint" />
        </div>
      </CabinetControlBar>
      {bottombar}
    </div>
  );
}
