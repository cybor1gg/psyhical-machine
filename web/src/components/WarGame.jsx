// Casino War — the "brain". Server-authoritative like the other games: this
// sends intents (start/war/surrender) and paces the reveal of decided
// outcomes. Deal order on screen follows the design (dealer first, then you);
// the provable draw order (your card = first nonce) is a server convention
// and independent of presentation.
import { useState, useEffect, useRef } from "react";
import { apiGet, apiPost } from "../api";
import { sound } from "../lib/sound";
import { reportStakeDebit, reportRoundEnd } from "../lib/operatorBridge";
import { GameBottombar } from "./mint/GameChrome";
import { FitBox, useStableViewportHeight } from "./mint/FitBox";
import { cardFromApi } from "./mint/PlayingCard";
import { BJShoe, useCanvasHeight } from "./mint/BlackjackVisuals";
import { WarFelt, WarSlot, WarPrompt, StreakChip, WarSideSpot, WAR_SIDE_SPOTS } from "./mint/WarVisuals";
import { ChipValueSelector } from "./mint/ChipKit";
import { useHiloMobile } from "./mint/HiloVisuals";
import { BetAmountInput, ActionButton, StatField, CabinetControlBar } from "./mint/BetPanelLite";

export default function WarGame({ initialBalance }) {
  const [amount, setAmount] = useState("10.00");
  const [balance, setBalance] = useState(typeof initialBalance === "number" ? initialBalance : null);
  const maxBet = () => { if (typeof balance === "number" && Number.isFinite(balance)) setAmount(balance.toFixed(2)); };
  const [tieAmount, setTieAmount] = useState("0.00");
  const [ctieAmount, setCtieAmount] = useState("0.00");
  const [chip, setChip] = useState(1); // desktop side-bet chip denomination
  // idle | dealing | war | warDeal | settled
  const [stage, setStage] = useState("idle");
  const [playerCards, setPlayerCards] = useState([]);
  const [dealerCards, setDealerCards] = useState([]);
  const [result, setResult] = useState(null);
  const [net, setNet] = useState(0);
  const [tieWin, setTieWin] = useState(0);
  const [ctieWin, setCtieWin] = useState(0);
  const [streak, setStreak] = useState(0);
  const [stakeUi, setStakeUi] = useState(0);
  const [warInfo, setWarInfo] = useState(null); // { warCost, surrenderReturns }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mobile = useHiloMobile();
  const vh = useStableViewportHeight();
  const timers = useRef([]);
  const bet = parseFloat(amount) || 0;
  const tieBet = parseFloat(tieAmount) || 0;
  const ctieBet = parseFloat(ctieAmount) || 0;

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => clearTimers(), []);
  const money = (v) => (Math.floor(Math.abs(v) * 100 + 1e-9) / 100).toFixed(2);

  // Cash inserted mid-game must be spendable immediately — the validator
  // (and its simulator) broadcast the new balance on this event.
  useEffect(() => {
    const onCash = (e) => setBalance(e.detail.balance);
    window.addEventListener("cabinet:cash-in", onCash);
    return () => window.removeEventListener("cabinet:cash-in", onCash);
  }, []);

  // resume: only a pending tie decision persists
  const initRan = useRef(false);
  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    apiGet("/api/games/war/active").then(({ ok, data }) => {
      if (!ok || !data.active) return;
      setPlayerCards(data.playerCards.map(cardFromApi));
      setDealerCards(data.dealerCards.map(cardFromApi));
      setAmount(Number(data.betAmount).toFixed(2));
      setTieAmount(Number(data.tieBet).toFixed(2));
      setCtieAmount(Number(data.ctieBet ?? 0).toFixed(2));
      setStakeUi(data.totalStaked);
      setStreak(data.streak || 0);
      setWarInfo({ warCost: data.warCost, surrenderReturns: data.surrenderReturns });
      setStage("war");
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

  function landBanner(data, delay) {
    later(() => {
      setResult(data.result);
      setNet(data.payout - data.totalStaked);
      setTieWin(data.tieWin || 0);
      setCtieWin(data.ctieWin || 0);
      setStreak(data.streak || 0);
      const n = data.payout - data.totalStaked;
      if (typeof data.balance === "number") setBalance(data.balance);
      reportRoundEnd(data.balance); // moves with the banner; a loss carries no balance
      if (data.result === "bonus") sound.cashOut();
      else if (n > 0) sound.tick(2);
      else if (data.result === "surrender") sound.cardFlip();
      // losses land silently (client preference — no defeat beat on any Original)
      setStage("settled");
    }, delay);
  }

  async function start() {
    if (busy || stage === "dealing" || stage === "war" || stage === "warDeal") return;
    if (typeof balance === "number" && Number.isFinite(balance) && (bet + (tieBet || 0) + (ctieBet || 0)) > balance + 1e-9) { setError("Insufficient balance"); return; }
    sound.prime();
    clearTimers();
    setResult(null);
    setTieWin(0);
    setCtieWin(0);
    setPlayerCards([]);
    setDealerCards([]);
    setWarInfo(null);
    // 0ms optimistic deal: both cards fly FACE-DOWN the instant Bet is
    // clicked; values fill at touchdown when the server answers (the classic
    // DealtCard flips 60ms after a fill, so fills are timed to the landing).
    setStage("dealing");
    reportStakeDebit(bet + (tieBet || 0) + (ctieBet || 0)); // stakes leave at the tap
    const t0 = Date.now();
    later(() => setDealerCards([null]), 60);
    later(() => setPlayerCards([null]), 400);

    const data = await api("/api/games/war/start", { betAmount: bet, tieBet, ctieBet });
    if (!data) {
      clearTimers();
      setDealerCards([]);
      setPlayerCards([]);
      setStage("idle");
      return;
    }
    setStakeUi(data.totalStaked);

    const p = cardFromApi(data.playerCards[0]);
    const d = cardFromApi(data.dealerCards[0]);
    const elapsed = () => Date.now() - t0;
    // touchdown = mount + 50ms hold + 430ms flight
    later(() => setDealerCards([d]), Math.max(0, 60 + 490 - elapsed()));
    later(() => setPlayerCards([p]), Math.max(0, 400 + 490 - elapsed()));

    const beat = Math.max(0, 1460 - elapsed());
    if (data.stage === "settled") {
      landBanner(data, beat);
    } else {
      later(() => {
        setStreak(data.streak || 0); // the tie just grew the streak — show it
        setWarInfo({ warCost: data.warCost, surrenderReturns: data.surrenderReturns });
        setStage("war");
      }, beat);
    }
  }

  async function goToWar() {
    if (busy || stage !== "war") return;
    sound.prime();
    // optimistic war raise: the two war cards fly face-down immediately
    setStage("warDeal");
    reportStakeDebit(warInfo?.warCost || bet); // the raise leaves at the tap
    setWarInfo(null);
    const t0 = Date.now();
    later(() => setDealerCards((c) => [...c, null]), 80);
    later(() => setPlayerCards((c) => [...c, null]), 420);

    const data = await api("/api/games/war/war");
    if (!data) {
      clearTimers();
      setDealerCards((c) => c.filter(Boolean));
      setPlayerCards((c) => c.filter(Boolean));
      setStage("war");
      return;
    }
    setStakeUi(data.totalStaked);
    const wp = cardFromApi(data.playerCards[1]);
    const wd = cardFromApi(data.dealerCards[1]);
    const elapsed = () => Date.now() - t0;
    later(() => setDealerCards((c) => c.map((x, i) => (i === 1 ? wd : x))), Math.max(0, 80 + 490 - elapsed()));
    later(() => setPlayerCards((c) => c.map((x, i) => (i === 1 ? wp : x))), Math.max(0, 420 + 490 - elapsed()));
    landBanner(data, Math.max(0, 1480 - elapsed()));
  }

  async function surrender() {
    if (busy || stage !== "war") return;
    sound.prime();
    const data = await api("/api/games/war/surrender");
    if (!data) return;
    setWarInfo(null);
    landBanner(data, 250);
  }

  const inRound = ["dealing", "war", "warDeal"].includes(stage);
  const ringFor = (side) => {
    if (stage !== "settled") return null;
    const won = net > 0;
    if (result === "surrender") return side === "player" ? "var(--gold)" : null;
    return side === "player" ? (won ? "var(--mint-bright)" : "var(--loss)") : null;
  };
  // Settled rounds re-badge the player slot itself (Win / Lose / Surrender)
  // instead of a banner; the dealer slot always stays "Dealer".
  const playerLabel = stage !== "settled" ? "You"
    : result === "surrender" ? "Surrender"
    : ["win", "war-win", "bonus"].includes(result) ? "Win" : "Lose";
  const playerLabelColor = stage !== "settled" ? null
    : result === "surrender" ? "var(--gold)"
    : ["win", "war-win", "bonus"].includes(result) ? "var(--mint-bright)" : "var(--loss)";
  // Desktop felt chips: drop the selected denomination on a side-bet spot at
  // the tap — same string states feed the round-start POST and mobile fields.
  // Placements are gated on the known balance (like roulette's chip gate) and
  // recorded in a trail so Undo can pop them one at a time.
  const chipTrail = useRef([]);
  const errTimer = useRef(null);
  const flashError = (msg) => {
    setError(msg);
    clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setError(""), 1600);
  };
  useEffect(() => () => clearTimeout(errTimer.current), []);
  const placeSideChip = (key) => {
    if (inRound) return;
    if (typeof balance === "number" && Number.isFinite(balance) && bet + tieBet + ctieBet + chip > balance + 1e-9) {
      flashError("Insufficient balance");
      return;
    }
    sound.chip();
    chipTrail.current.push({ key, amt: chip });
    if (key === "tie") setTieAmount(String((tieBet + chip).toFixed(2)));
    else setCtieAmount(String((ctieBet + chip).toFixed(2)));
  };
  const undoSideChip = () => {
    if (inRound || !chipTrail.current.length) return;
    sound.chip();
    const last = chipTrail.current.pop();
    if (last.key === "tie") setTieAmount(String(Math.max(0, tieBet - last.amt).toFixed(2)));
    else setCtieAmount(String(Math.max(0, ctieBet - last.amt).toFixed(2)));
  };
  const clearSideBets = () => { if (!inRound) { chipTrail.current = []; setTieAmount("0.00"); setCtieAmount("0.00"); } };

  const bottombar = <GameBottombar game="war" />;

  // Desktop cards scale to the measured canvas: two slots (label + card 1.4w
  // each) + the corner spot columns (spot ≈ 125 + button 32) + breathing
  // ≈ 2.8w + 310 must fit. Cap raised to 126 — the client wants big cards.
  const [canvasRef, canvasH] = useCanvasHeight();
  const cardW = mobile ? 76 : (canvasH ? Math.max(72, Math.min(126, Math.floor((canvasH - 310) / 2.8))) : 100);
  // Mobile: content-sized table + scrollable page — cards can never spill into
  // the bet panel. Desktop keeps the space-around felt.
  const table = (
    <div ref={canvasRef} style={{
      position: "relative", display: "flex", flexDirection: "column", alignItems: "center", width: "100%",
      ...(mobile
        // constant-height stage: FitBox's scale must not change between idle,
        // dealing and the war prompt, or the felt visibly resizes
        ? { flex: "0 0 auto", justifyContent: "flex-start", gap: 8, padding: "12px 6px 16px", height: 390, boxSizing: "border-box" }
        // space-between + growing spacer: dealer stays high, the player slot
        // sits low right above the corner spots — the client wants the player
        // cards pushed toward the bottom
        : { flex: 1, minHeight: 0, justifyContent: "space-between", padding: "26px 10px 14px" }),
    }}>
      <WarFelt compact={mobile} />
      <BJShoe w={mobile ? 52 : 72} mobile={mobile} />
      {streak > 0 && (
        <div style={{ position: "absolute", top: mobile ? 10 : 16, left: mobile ? 10 : 18, zIndex: 2 }}>
          <StreakChip streak={streak} />
        </div>
      )}
      {/* Desktop renders the full slot structure in EVERY stage — WarSlot
          reserves its card-row height when empty, so clicking Bet mounts the
          cards into space that already exists and the felt never reflows.
          Mobile keeps its constant-height stage and hides idle slots. */}
      {mobile && stage === "idle" ? (
        <span />
      ) : (
        <>
          {/* clear the absolutely-positioned shoe/streak chip on phones */}
          {mobile && <div style={{ height: 26, flex: "0 0 auto" }} />}
          <WarSlot label="Dealer" cards={dealerCards} w={cardW} />
          <div style={{ minHeight: 26, flex: mobile ? "0 0 auto" : "1 1 auto" }} />
          <WarSlot label={playerLabel} labelColor={playerLabelColor} badge={stage === "settled"}
            cards={playerCards} w={cardW} ringColor={ringFor("player")} active={stage === "war"} />
        </>
      )}
      {/* the WAR! decision floats OVER the felt — in flow it would grow the
          banner row and shift the table the moment a tie lands */}
      {stage === "war" && warInfo && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 6 }}>
          <WarPrompt warCost={warInfo.warCost} surrenderReturns={warInfo.surrenderReturns}
            onWar={goToWar} onSurrender={surrender} busy={busy} />
        </div>
      )}
      {/* desktop side bets live ON the felt: Draw pinned to the bottom-left
          corner, Colour Draw to the bottom-right, Undo/Clear between them —
          all always rendered (disabled when unusable) so nothing ever pops
          in or out of the layout */}
      {!mobile && (() => {
        const cornerBtn = (label, onClick, enabled) => (
          <button onClick={onClick} disabled={!enabled}
            style={{ width: "100%", height: 32, borderRadius: "var(--r-md)", border: "1px solid var(--border)",
              background: "var(--surface-raised)", color: "var(--text)", fontFamily: "var(--font-display)",
              fontWeight: 700, fontSize: 12.5, cursor: enabled ? "pointer" : "default",
              opacity: enabled ? 1 : 0.4, transition: "opacity var(--dur-fast)" }}>
            {label}
          </button>
        );
        // Undo lives under the left spot, Clear under the right — the same
        // corner-column arrangement the other table games use.
        return (
          <div style={{ width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, zIndex: 3 }}>
            <div style={{ flex: "0 0 auto", width: 200, display: "flex", flexDirection: "column", gap: 6 }}>
              <WarSideSpot spot={WAR_SIDE_SPOTS[0]} active={!inRound}
                amount={tieBet} won={stage === "settled" && tieWin > 0} hit={tieWin}
                onPlace={() => placeSideChip("tie")} />
              {cornerBtn("Undo", undoSideChip, !inRound && chipTrail.current.length > 0)}
            </div>
            <div style={{ flex: "0 0 auto", width: 200, display: "flex", flexDirection: "column", gap: 6 }}>
              <WarSideSpot spot={WAR_SIDE_SPOTS[1]} active={!inRound}
                amount={ctieBet} won={stage === "settled" && ctieWin > 0} hit={ctieWin}
                onPlace={() => placeSideChip("ctie")} />
              {cornerBtn("Clear", clearSideBets, !inRound && (tieBet > 0 || ctieBet > 0))}
            </div>
          </div>
        );
      })()}
    </div>
  );

  // ── MOBILE ──
  if (mobile) {
    return (
      <div style={{ height: vh, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
        <div style={{ flex: "1 1 auto", minHeight: 0, position: "relative", display: "flex", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }}>
          <FitBox>{table}</FitBox>
        </div>
        <div style={{ flex: "0 0 auto", maxHeight: "60%", overflowY: "auto", padding: "8px 12px 14px", display: "flex", flexDirection: "column", gap: 8, background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
          {/* Bet FIRST: after a round you re-bet with one tap */}
          {error && (
            <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-caption)", fontWeight: 600 }}>{error}</div>
          )}
          <ActionButton label={inRound ? "In play…" : "Bet"} tone="primary" glow={!inRound} onClick={start} disabled={busy || inRound} small />
          <BetAmountInput value={amount} onChange={setAmount} disabled={inRound}
            onHalf={() => setAmount(String(Math.max(0, bet / 2).toFixed(2)))}
            onDouble={() => setAmount(String((bet * 2).toFixed(2)))}
            onMax={maxBet} label="Bet Amount" small />
          {/* the two side bets share one row so the panel stays short */}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <BetAmountInput value={tieAmount} onChange={setTieAmount} disabled={inRound}
                onHalf={() => setTieAmount(String(Math.max(0, tieBet / 2).toFixed(2)))}
                onDouble={() => setTieAmount(String((tieBet * 2).toFixed(2)))}
                onMax={() => {}} label="Draw · 10:1" compact small />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <BetAmountInput value={ctieAmount} onChange={setCtieAmount} disabled={inRound}
                onHalf={() => setCtieAmount(String(Math.max(0, ctieBet / 2).toFixed(2)))}
                onDouble={() => setCtieAmount(String((ctieBet * 2).toFixed(2)))}
                onMax={() => {}} label="Colour · 20:1" compact small />
            </div>
          </div>
        </div>
        {bottombar}
      </div>
    );
  }

  // ── DESKTOP ──
  return (
    <div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column", padding: "14px 26px 10px", boxSizing: "border-box", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }} />
        {table}
      </div>
      <CabinetControlBar
        amount={amount} onAmount={setAmount} betLocked={inRound} onMax={maxBet}
        actionLabel={inRound ? "In play…" : "Bet"} actionTone="primary" glow={!inRound}
        onAction={start} actionDisabled={busy || inRound} error={error}
      >
        <div style={{ flex: "0 0 auto", minWidth: 220 }}>
          <ChipValueSelector value={chip} onSelect={setChip} disabled={inRound} min={1} />
        </div>
        <div style={{ flex: "0 0 auto", minWidth: 170 }}>
          <StatField label="Total Stake" value={`$${money(inRound || stage === "settled" ? stakeUi : bet + tieBet + ctieBet)}`} tone="mint" />
        </div>
      </CabinetControlBar>
      {bottombar}
    </div>
  );
}
