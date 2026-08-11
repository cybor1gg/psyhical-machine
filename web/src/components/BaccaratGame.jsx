// Baccarat — the "brain". INSTANT family: drop chips on Player / Tie / Banker,
// Deal sends the layout in one POST that resolves the coup server-side; the
// client then deals the server's cards with the minimal flat-table
// choreography shared with blackjack (constant-size flights from the corner
// deck, silent flips on arrival, diagonal glides, wordless settle — the
// winner reads from pill colors and card rings, loser stays neutral).
import { useState, useRef, useEffect } from "react";
import { apiPost } from "../api";
import { sound } from "../lib/sound";
import { reportBalance, reportStakeDebit } from "../lib/operatorBridge";
import { GameBottombar } from "./mint/GameChrome";
import { cardFromApi } from "./mint/PlayingCard";
import { BACC_SPOTS } from "./mint/BaccaratVisuals";
import { SBJShoe } from "./mint/StakeBJ";
import { baccValue, SBaccHand, SBaccSpot, SBaccRibbon, SBaccWinToast } from "./mint/StakeBacc";
import { ChipValueSelector } from "./mint/ChipKit";
import { useHiloMobile } from "./mint/HiloVisuals";
import { FitBox, useStableViewportHeight } from "./mint/FitBox";
import { ActionButton, BetAmountInput } from "./mint/BetPanelLite";

const DEAL_START = 60;    // ms before the first card leaves the deck (from CLICK)
const DEAL_GAP = 460;     // ms between cards (matches blackjack's rhythm)

export default function BaccaratGame({ initialBalance } = {}) {
  const [chip, setChip] = useState(1);
  // Live wallet balance (from the page/embed prop, synced from each settle
  // response). Number when known; null for seamless operators. Gates the deal.
  const [balance, setBalance] = useState(typeof initialBalance === "number" ? initialBalance : null);
  const [bets, setBets] = useState({ player: 0, tie: 0, banker: 0 });
  const [placements, setPlacements] = useState([]);   // chip-by-chip history for Undo
  const [pCards, setPCards] = useState([]);
  const [bCards, setBCards] = useState([]);
  const [outcome, setOutcome] = useState(null);       // { winner, pv, bv }
  const [dealing, setDealing] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isMobile = useHiloMobile();
  const vh = useStableViewportHeight();
  const timers = useRef([]);

  const total = +(bets.player + bets.tie + bets.banker).toFixed(2);
  const canBet = !dealing && !busy;

  // Total Bet field text: local while typing, resynced when chips/scaling
  // change the real total from outside the field
  const [totalStr, setTotalStr] = useState("0.00");
  useEffect(() => {
    if (Math.abs((parseFloat(totalStr) || 0) - total) > 0.005) setTotalStr(total.toFixed(2));
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const resetTable = () => { setPCards([]); setBCards([]); setOutcome(null); setShowResult(false); };

  // ── betting ──
  const placeChip = (key) => {
    if (!canBet) return;
    if (showResult) resetTable();
    sound.chip();
    setBets((b) => ({ ...b, [key]: +(b[key] + chip).toFixed(2) }));
    setPlacements((p) => [...p, { key, amount: chip }]);
  };
  const undo = () => {
    if (!canBet || !placements.length) return;
    const last = placements[placements.length - 1];
    setBets((b) => ({ ...b, [last.key]: Math.max(0, +(b[last.key] - last.amount).toFixed(2)) }));
    setPlacements((p) => p.slice(0, -1));
  };
  const clearBets = () => { if (canBet) { setBets({ player: 0, tie: 0, banker: 0 }); setPlacements([]); } };
  const scaleBets = (f) => { if (canBet) setBets((b) => ({ player: +(b.player * f).toFixed(2), tie: +(b.tie * f).toFixed(2), banker: +(b.banker * f).toFixed(2) })); };
  const setTotalBet = (val) => {
    if (!canBet) return;
    if (showResult) resetTable();
    const v = Math.max(0, Math.round((parseFloat(val) || 0) * 100) / 100);
    setBets((b) => {
      const cur = +(b.player + b.tie + b.banker).toFixed(2);
      if (v <= 0) return { player: 0, tie: 0, banker: 0 };
      if (cur > 0) { const f = v / cur; return { player: +(b.player * f).toFixed(2), tie: +(b.tie * f).toFixed(2), banker: +(b.banker * f).toFixed(2) }; }
      return { player: v, tie: 0, banker: 0 };
    });
  };

  // ── round ──
  async function deal() {
    if (!canBet || total <= 0) return;
    if (typeof balance === "number" && Number.isFinite(balance) && (total) > balance + 1e-9) { setError("Insufficient balance"); return; }
    sound.prime();
    clearTimers();
    setBusy(true);
    setError("");
    const wager = total;
    reportStakeDebit(wager); // stake leaves the operator wallet at the tap; arms its poll-guard

    // 0ms optimistic deal: the four base cards fly FACE-DOWN the instant
    // Deal is clicked; values fill in when the server answers. Each flip is
    // gated by its own flight's completion, so an early fill can never flip
    // a card mid-air. The server settled the coup before any face shows —
    // it stays fully authoritative.
    resetTable();
    setDealing(true);
    const t0 = Date.now();
    const mountAt = (i) => DEAL_START + i * DEAL_GAP;
    later(() => setPCards((x) => [...x, null]), mountAt(0));
    later(() => setBCards((x) => [...x, null]), mountAt(1));
    later(() => setPCards((x) => [...x, null]), mountAt(2));
    later(() => setBCards((x) => [...x, null]), mountAt(3));

    const payload = Object.entries(bets).filter(([, s]) => s > 0).map(([type, stake]) => ({ type, stake }));
    const { ok, data } = await apiPost("/api/games/baccarat/start", { bets: payload });
    if (!ok) {
      // bet refused: sweep the phantom cards off the table
      clearTimers();
      resetTable();
      setDealing(false);
      setBusy(false);
      setError(data.error || "Something went wrong");
      return;
    }

    const p = data.playerCards.map(cardFromApi);
    const b = data.bankerCards.map(cardFromApi);
    const elapsed = () => Date.now() - t0;
    // fill the base cards' values just after each mount (or immediately if
    // the mount already happened) — the flip waits for the flight anyway
    const fill = (setC, idx, card, at) => later(() => {
      setC((x) => x.map((c, i) => (i === idx ? card : c)));
    }, Math.max(0, at + 30 - elapsed()));
    fill(setPCards, 0, p[0], mountAt(0));
    fill(setBCards, 0, b[0], mountAt(1));
    fill(setPCards, 1, p[1], mountAt(2));
    fill(setBCards, 1, b[1], mountAt(3));
    // thirds arrive with their values at their slots in the sequence
    let n = 4;
    if (p[2]) { const at = mountAt(n++); later(() => setPCards((x) => [...x, p[2]]), Math.max(0, at - elapsed())); }
    if (b[2]) { const at = mountAt(n++); later(() => setBCards((x) => [...x, b[2]]), Math.max(0, at - elapsed())); }
    // last card: mount + 460 flight + flip ≈ +900
    const end = mountAt(n - 1) + 900;
    later(() => {
      // settle is wordless outside the win toast: pills, rings, glowing spot
      if (typeof data.balance === "number") setBalance(data.balance); // keep the deal gate in sync
      reportBalance(data.balance); // operator wallet moves with the last flip
      setOutcome({ winner: data.winner, pv: data.playerValue, bv: data.bankerValue, payout: +(data.payout || 0).toFixed(2), wager });
      setShowResult(true);
      setDealing(false);
      setBusy(false);
    }, Math.max(0, end - elapsed()));
  }

  const bottombar = <GameBottombar game="baccarat" />;
  const locked = dealing || busy;

  // Reference outcome colors: the WINNER goes mint, the loser stays neutral
  // (no red), a tie golds both.
  const handResult = (side) => {
    if (!showResult) return null;
    if (outcome.winner === "tie") return "push";
    return outcome.winner === side ? "win" : null;
  };

  const spotBtns = BACC_SPOTS.map((spot) => (
    <SBaccSpot key={spot.key} spot={spot} amount={bets[spot.key]} active={canBet}
      won={showResult && outcome.winner === spot.key && bets[spot.key] > 0}
      onPlace={() => placeChip(spot.key)} mob={isMobile} />
  ));

  const undoBtn = (
    <button onClick={undo} disabled={!canBet || !placements.length}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: "4px 2px", cursor: canBet && placements.length ? "pointer" : "default", color: "#FFFFFF", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12.5, opacity: canBet && placements.length ? 1 : 0.5 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></svg>
      Undo
    </button>
  );
  const clearBtn = (
    <button onClick={clearBets} disabled={!canBet || total <= 0}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: "4px 2px", cursor: canBet && total > 0 ? "pointer" : "default", color: "#FFFFFF", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12.5, opacity: canBet && total > 0 ? 1 : 0.5 }}>
      Clear
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
    </button>
  );

  // ── the flat table: hands up top (identical stair/pill/glide language as
  // blackjack via SBJHand), TIE ribbon below them, bet spots + Undo/Clear on
  // the felt at the bottom. Hand zone heights are FIXED so nothing shifts. ──
  const cardW = isMobile ? 70 : 100;
  const handZoneH = Math.round(cardW * 1.5) + Math.round(cardW * 0.18) * 2 + 40;
  const stage = (
    <div style={{
      position: "relative", display: "flex", flexDirection: "column", alignItems: "center",
      width: "100%", boxSizing: "border-box",
      overflow: isMobile ? "visible" : "hidden",
      ...(isMobile
        ? { flex: "0 0 auto", height: 430, padding: "12px 10px 140px" }
        : { flex: 1, minHeight: 0, padding: "20px 16px 14px" }),
    }}>
      {!isMobile && <SBJShoe w={96} right={8} />}
      {/* hands — fixed zones, player left / banker right; the fan grows into
          reserved space so nothing on the table ever shifts while dealing */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: isMobile ? 30 : 110, height: handZoneH, flex: "0 0 auto", paddingTop: isMobile ? 4 : 2 }}>
        <SBaccHand cards={pCards} w={cardW} z={1}
          value={pCards.some(Boolean) ? (showResult ? outcome.pv : baccValue(pCards)) : null}
          result={handResult("player")} />
        <SBaccHand cards={bCards} w={cardW} z={2}
          value={bCards.some(Boolean) ? (showResult ? outcome.bv : baccValue(bCards)) : null}
          result={handResult("banker")} />
      </div>
      <div style={{ flex: "0 0 auto", marginTop: isMobile ? 18 : 34 }}>
        <SBaccRibbon compact={isMobile} />
      </div>
      {/* win toast — floats dead-centre with a soft bounce, wager beaten */}
      {showResult && outcome.payout > outcome.wager && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 12 }}>
          <SBaccWinToast mult={outcome.wager > 0 ? outcome.payout / outcome.wager : 0} amount={outcome.payout} />
        </div>
      )}
      <div style={{ flex: 1 }} />
      {/* desktop keeps the spots on the (unscaled) stage; mobile pins them to
          the PANEL below so they span the real screen edge to edge */}
      {!isMobile && (
        <div style={{ width: "100%", maxWidth: 800, display: "flex", gap: 12 }}>
          {spotBtns}
        </div>
      )}
      {/* desktop: Undo / Clear at the stage's bottom corners (mobile pins
          them to the PANEL below, outside the FitBox scaler) */}
      {!isMobile && (
        <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 6px 0", boxSizing: "border-box" }}>
          {undoBtn}
          {clearBtn}
        </div>
      )}
    </div>
  );

  const chipSelector = (
    <div style={{ opacity: locked ? 0.5 : 1, pointerEvents: locked ? "none" : "auto", transition: "opacity var(--dur-base)" }}>
      <ChipValueSelector value={chip} onSelect={setChip} disabled={locked} min={1} />
    </div>
  );
  const totalGroup = (
    <BetAmountInput value={totalStr} disabled={locked}
      onChange={(v) => { setTotalStr(v); setTotalBet(v); }}
      onHalf={() => scaleBets(0.5)} onDouble={() => scaleBets(2)} onMax={() => {}}
      label="Total Bet" small compact topRight={`$${total.toFixed(2)}`} />
  );
  const dealButton = (small) => (
    <ActionButton label={locked ? "Dealing…" : "Deal"} tone="primary" glow={canBet && total > 0} onClick={deal} disabled={locked || total <= 0} small={small} />
  );
  const errBox = error && (
    <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-caption)", fontWeight: 600 }}>{error}</div>
  );

  // ── MOBILE: rounded inset table panel (deck anchored to it), controls
  // below in the reference order: Deal → spots → chips → total ──
  if (isMobile) {
    return (
      <div style={{ height: vh, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
        <div style={{ flex: "1 1 auto", minHeight: 0, position: "relative", display: "flex", margin: "8px 8px 0", borderRadius: 12, background: "var(--ink)", overflow: "hidden" }}>
          {/* deck on the PANEL edge (half-clipped top, immune to FitBox scale);
              flights launch from its visible bottom edge */}
          <SBJShoe w={46} right={2} />
          <FitBox>{stage}</FitBox>
          <div style={{ position: "absolute", left: 8, right: 8, bottom: 36, zIndex: 5, display: "flex", gap: 8 }}>{spotBtns}</div>
          <div style={{ position: "absolute", bottom: 6, left: 12, zIndex: 5 }}>{undoBtn}</div>
          <div style={{ position: "absolute", bottom: 6, right: 12, zIndex: 5 }}>{clearBtn}</div>
        </div>
        <div style={{ flex: "0 0 auto", maxHeight: "62%", overflowY: "auto", padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {dealButton(true)}
          {chipSelector}
          {totalGroup}
          {errBox}
        </div>
        {bottombar}
      </div>
    );
  }

  // ── CABINET: the flat table owns the whole screen (bet spots + Undo/Clear
  // stay on the felt), controls docked bottom — the old left panel's chip
  // selector / total / deal blocks re-docked side by side in a strip. ──
  return (
    <div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", padding: 14, boxSizing: "border-box", alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", padding: "12px 10px", boxSizing: "border-box", overflow: "hidden" }}>
          {stage}
        </div>
      </div>
      <div style={{
        flex: "0 0 auto", boxSizing: "border-box", width: "100%",
        display: "flex", alignItems: "flex-end", gap: 14, padding: "12px 18px 14px",
        background: "var(--surface)", borderTop: "1px solid var(--border)",
      }}>
        <div style={{ flex: "0 0 auto", opacity: locked ? 0.5 : 1, pointerEvents: locked ? "none" : "auto", transition: "opacity var(--dur-base)" }}>
          {/* full tray — every chip visible, slot-machine style */}
          <ChipValueSelector value={chip} onSelect={setChip} disabled={locked} min={1} full />
        </div>
        <div style={{ flex: "0 0 250px" }}>
          {totalGroup}
        </div>
        <div style={{ flex: 1 }} />
        {errBox && <div style={{ alignSelf: "center", maxWidth: 300 }}>{errBox}</div>}
        <div style={{ flex: "0 0 300px" }}>
          <ActionButton label={locked ? "Dealing…" : "Deal"} tone="primary" glow={canBet && total > 0} onClick={deal} disabled={locked || total <= 0} large />
        </div>
      </div>
      {bottombar}
    </div>
  );
}
