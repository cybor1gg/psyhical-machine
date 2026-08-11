// Dice — the "brain". INSTANT family: one POST settles the round; the client
// paces the story (die tumbles ~460ms, then the outcome sound + balance land
// together). Multiplier/chance readouts are display math only — the server's
// response is the truth, and the payout factor self-corrects from it (so an
// operator RTP override shows correctly after the first roll).
import { useState, useRef, useEffect } from "react";
import { apiPost } from "../api";
import { sound } from "../lib/sound";
import { reportBalance, reportStakeDebit } from "../lib/operatorBridge";
import { DiceBoard, DiceField, RecentPills } from "./mint/DiceVisuals";
import { useHiloMobile } from "./mint/HiloVisuals";
import { GameBottombar } from "./mint/GameChrome";
import { FitBox, useStableViewportHeight } from "./mint/FitBox";
import { BetAmountInput, ActionButton, StatField, CabinetControlBar } from "./mint/BetPanelLite";

const TRAVEL = 460;

export default function DiceGame({ initialBalance } = {}) {
  const [amount, setAmount] = useState("10.00");
  // Live wallet balance (from the page/embed prop, kept in sync from each
  // response). Number when known; null for seamless operators until a bet
  // settles. Powers the Max button.
  const [balance, setBalance] = useState(typeof initialBalance === "number" ? initialBalance : null);
  const [target, setTarget] = useState(50);
  const [over, setOver] = useState(true);
  const [roll, setRoll] = useState(null);       // displayed roll (number)
  const [rollId, setRollId] = useState(null);   // remount key per roll
  const [won, setWon] = useState(false);
  const [rolls, setRolls] = useState([]);       // recent pills
  const [payoutFactor, setPayoutFactor] = useState(0.99); // (1-edge), corrected from responses
  const [busy, setBusy] = useState(false);
  const [charging, setCharging] = useState(false); // 0ms scramble while the server answers
  const [error, setError] = useState("");
  const mobile = useHiloMobile();
  const vh = useStableViewportHeight();
  const timers = useRef([]);
  const bet = parseFloat(amount) || 0;
  const maxBet = () => { if (typeof balance === "number" && Number.isFinite(balance)) setAmount(balance.toFixed(2)); };

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Cash inserted mid-game must be spendable immediately — the validator
  // (and its simulator) broadcast the new balance on this event.
  useEffect(() => {
    const onCash = (e) => setBalance(e.detail.balance);
    window.addEventListener("cabinet:cash-in", onCash);
    return () => window.removeEventListener("cabinet:cash-in", onCash);
  }, []);

  const winChance = over ? (9999 - Math.round(target * 100)) / 10000 : Math.round(target * 100) / 10000;
  const multiplier = Math.floor((payoutFactor / winChance) * 10000) / 10000;

  async function doRoll() {
    if (busy) return;
    if (typeof balance === "number" && Number.isFinite(balance) && (bet) > balance + 1e-9) { setError("Insufficient balance"); return; }
    sound.prime();
    sound.cardDeal(); // click-time feedback; the cube starts tumbling NOW
    setBusy(true);
    setCharging(true);
    setError("");
    reportStakeDebit(bet); // stake leaves the operator wallet at the tap; arms its poll-guard
    const { ok, data } = await apiPost("/api/games/dice/start", { betAmount: bet, target, over });
    setCharging(false);
    if (!ok) {
      setBusy(false);
      setError(data.error || "Something went wrong");
      return;
    }
    setPayoutFactor(Math.round(data.multiplier * data.winChance * 10000) / 10000);
    setRoll(data.roll);
    setRollId(data.roundId);
    setWon(data.won);
    later(() => {
      setRolls((prev) => [{ n: data.roll, won: data.won, id: data.roundId }, ...prev].slice(0, 6));
      if (typeof data.balance === "number") setBalance(data.balance); // keep Max in sync
      reportBalance(data.balance); // operator wallet moves with the outcome sound
      // losses land silently (client preference — no defeat beat on any Original)
      if (data.won) sound.tick(data.multiplier);
      setBusy(false);
    }, TRAVEL + 40);
  }

  const bottombar = <GameBottombar game="dice" />;

  const statFields = (
    <div style={{ display: "flex", gap: mobile ? 8 : 22, flexWrap: "wrap" }}>
      <DiceField label="Multiplier" value={multiplier.toFixed(4)} suffix="×" editable compact={mobile}
        onCommit={(m) => {
          const c = Math.min(0.98, Math.max(0.02, payoutFactor / Math.max(1.0102, m)));
          setTarget(Math.min(98, Math.max(2, +((over ? 100 - c * 100 : c * 100)).toFixed(2))));
        }} />
      <DiceField label={over ? "Roll Over" : "Roll Under"} value={target.toFixed(2)} editable compact={mobile}
        onSwap={() => { setOver((o) => !o); setTarget((t) => +(100 - t).toFixed(2)); }}
        onCommit={(t) => setTarget(Math.min(98, Math.max(2, +t.toFixed(2))))} />
      <DiceField label="Win Chance" value={(winChance * 100).toFixed(2)} suffix="%" editable compact={mobile}
        onCommit={(c) => {
          const cc = Math.min(98, Math.max(2, c));
          setTarget(over ? +(100 - cc).toFixed(2) : cc);
        }} />
    </div>
  );

  const recent = (
    <div style={{ width: "100%", maxWidth: 760, margin: "0 auto" }}>
      <RecentPills rolls={rolls} fmt={(rr) => rr.n.toFixed(2)} />
    </div>
  );

  const board = (
    <div style={{ position: "relative", width: "100%", maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: mobile ? 14 : 18 }}>
      <div style={{ padding: mobile ? "36px 0 8px" : "44px 0 10px" }}>
        <DiceBoard target={target} onTarget={(t) => !busy && setTarget(t)} over={over}
          roll={roll} rollId={rollId} won={won} compact={mobile} charging={charging} />
      </div>
    </div>
  );

  // ── MOBILE: natural flow, bet-first controls ──
  if (mobile) {
    return (
      <div style={{ height: vh, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
        <div style={{ flex: "1 1 auto", minHeight: 0, position: "relative", display: "flex", flexDirection: "column", padding: "12px 12px 10px" }}>
          {/* past + current rolls pinned to the very top */}
          {recent}
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center" }}>
            <FitBox>{board}</FitBox>
          </div>
          {/* multiplier / roll / chance pinned to the felt's bottom */}
          {statFields}
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
          <StatField label="Profit on Win" value={`$${(Math.floor(bet * (multiplier - 1) * 100) / 100).toFixed(2)}`} tone="mint" />
        </div>
        {bottombar}
      </div>
    );
  }

  // ── CABINET: the board owns the whole screen, controls docked bottom ──
  return (
    <div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column", padding: "14px 26px 10px", boxSizing: "border-box", overflow: "hidden" }}>
        {/* past + current rolls pinned to the very top */}
        {recent}
        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <FitBox grow maxScale={1.45}>
            <div style={{ width: "min(880px, 92vw)" }}>{board}</div>
          </FitBox>
        </div>
        {/* multiplier / roll / chance pinned to the canvas bottom */}
        <div style={{ width: "100%", maxWidth: 880, margin: "0 auto" }}>
          {statFields}
        </div>
      </div>
      <CabinetControlBar
        amount={amount} onAmount={setAmount} betLocked={busy} onMax={maxBet}
        actionLabel={busy ? "Rolling…" : "Bet"} actionTone="primary" glow={!busy}
        onAction={doRoll} actionDisabled={busy} error={error}
      >
        <div style={{ flex: "0 0 auto", minWidth: 170 }}>
          <StatField label="Profit on Win" value={`$${(Math.floor(bet * (multiplier - 1) * 100) / 100).toFixed(2)}`} tone="mint" />
        </div>
      </CabinetControlBar>
      {bottombar}
    </div>
  );
}
