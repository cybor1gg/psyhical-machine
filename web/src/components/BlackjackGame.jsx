// MintBets Blackjack — the "brain". Server-authoritative: this component sends
// intents (start/hit/stand/double/split/insurance) and renders responses. The
// server answers each intent in one shot with everything decided; the client
// PACES the story — cards travel from the shoe ~340ms apart, the hole card
// flips in place at reveal, dealer draws land one by one, and the banner comes
// last. Split re-deals into two hands; insurance pauses play with a prompt.
import { useState, useEffect, useRef } from "react";
import { apiGet, apiPost } from "../api";
import { sound } from "../lib/sound";
import { reportBalance, reportStakeDebit, reportRoundEnd } from "../lib/operatorBridge";
import { GameBottombar } from "./mint/GameChrome";
import { FitBox, useStableViewportHeight } from "./mint/FitBox";
import { cardFromApi } from "./mint/PlayingCard";
import { useCanvasHeight } from "./mint/BlackjackVisuals";
import { SBJHand, SBJShoe, SBJButton, SBJRibbon, handTotal } from "./mint/StakeBJ";
import { BJ_ICONS } from "./mint/BlackjackVisuals";
import { useHiloMobile } from "./mint/HiloVisuals";
import { BetAmountInput, ActionButton } from "./mint/BetPanelLite";

const DEAL_MS = 400;   // gap between cards on the opening deal (hold 30 + fly 430)
const DRAW_MS = 470;   // gap between dealer draws at reveal

// hands state shape (client): [{ cards: (designCard|null)[], doubled, done, result, bet }]
const mapHand = (h) => ({
  cards: h.cards.map(cardFromApi),
  doubled: h.doubled, done: h.done, result: h.result, bet: h.bet,
});

export default function BlackjackGame({ initialBalance } = {}) {
  const [amount, setAmount] = useState("10.00");
  const [balance, setBalance] = useState(typeof initialBalance === "number" ? initialBalance : null);
  const maxBet = () => { if (typeof balance === "number" && Number.isFinite(balance)) setAmount(balance.toFixed(2)); };
  // idle | dealing | insurance | player | revealing | settled
  const [stage, setStage] = useState("idle");
  const [hands, setHands] = useState([]);
  const [activeHand, setActiveHand] = useState(0);
  const [dealerCards, setDealerCards] = useState([]); // null slot = hole
  const [stakeUi, setStakeUi] = useState(0);
  const [canDouble, setCanDouble] = useState(false);
  const [canSplit, setCanSplit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mobile = useHiloMobile();
  const vh = useStableViewportHeight();
  const timers = useRef([]);
  const bet = parseFloat(amount) || 0;

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

  const money = (v) => (Math.floor(Math.abs(v) * 100 + 1e-9) / 100).toFixed(2);

  function applyLiveState(data) {
    setHands(data.hands.map(mapHand));
    setActiveHand(data.activeHand);
    setCanDouble(data.canDouble);
    setCanSplit(data.canSplit);
    setStakeUi(data.totalStaked);
    setStage(data.stage);
  }

  // ── resume after refresh (no pacing — the round is mid-flight) ──
  const initRan = useRef(false);
  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    apiGet("/api/games/blackjack/active").then(({ ok, data }) => {
      if (!ok || !data.active) return;
      setDealerCards([...data.dealer.cards.map(cardFromApi), null]);
      setAmount(Number(data.betAmount).toFixed(2));
      applyLiveState(data);
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
    // Mid-round balances (stake taken on start/double/split/insurance) show
    // immediately — that's bet feedback. Settled rounds hold their balance
    // for revealSettlement so the win lands WITH the banner, not before it.
    if (typeof data.balance === "number") setBalance(data.balance);
    if (data.stage !== "settled") reportBalance(data.balance, null, "stake"); // hand still in play
    return data;
  }

  // Reveal a settled response: hole flips in place, extra dealer cards land
  // one by one, then the banner + outcome sound + balance together.
  function revealSettlement(data, delayFirst = 0) {
    setStage("revealing");
    setCanDouble(false);
    setCanSplit(false);

    const dealer = data.dealer.cards.map(cardFromApi);
    later(() => setDealerCards([dealer[0], dealer[1]]), delayFirst);

    const extras = dealer.length - 2;
    for (let k = 0; k < extras; k++) {
      // deal sound fires from the card's own mount (SBJDealtCard) — always in sync
      later(() => setDealerCards(dealer.slice(0, 3 + k)), delayFirst + 520 + k * DRAW_MS);
    }

    later(() => {
      setDealerCards(dealer);
      setHands(data.hands.map(mapHand));
        setStakeUi(data.totalStaked);
      // settle is silent AND wordless by design: the green/red card borders
      // and pill colors carry the outcome
      if (typeof data.balance === "number") setBalance(data.balance);
      reportRoundEnd(data.balance); // moves with the outcome; a loss carries no balance
      setStage("settled");
    }, delayFirst + 520 + extras * DRAW_MS + 460);
  }

  async function start() {
    if (busy || stage === "dealing" || stage === "insurance" || stage === "player" || stage === "revealing") return;
    if (typeof balance === "number" && Number.isFinite(balance) && (bet) > balance + 1e-9) { setError("Insufficient balance"); return; }
    sound.prime();
    clearTimers();
    // Reset the LAST round and leave "settled" synchronously — clearing the
    // result while the stage stayed settled used to re-render the banner
    // with empty values (a phantom "Push") for the whole network wait.
    setStakeUi(bet);
    setStage("dealing");
    reportStakeDebit(bet); // stake leaves the operator wallet at the tap

    // Round transition: instant table clear (the reference's snap style —
    // no sweep ritual), fresh deal flies in right away.
    const SWEEP = 0;
    setHands([]);
    setDealerCards([]);

    // 0ms optimistic deal: the opening cards fly FACE-DOWN the instant Bet is
    // clicked; their values flip in the moment the server answers. The server
    // settled the round before any face shows, so it stays fully
    // authoritative — perceived latency is zero regardless of the round-trip.
    const resolved = { current: null };
    const shellBase = { doubled: false, done: false, result: null, bet };
    // Mounts ALWAYS deal face-down (values flip in separately, one card at a
    // time) — and preserve any value a previous fill already applied.
    const mountPlayer = (count) => () => {
      setHands((prev) => [{ ...(resolved.current ? resolved.current.shell : shellBase), cards: Array.from({ length: count }, (_, i) => prev[0]?.cards?.[i] ?? null) }]);
    };
    const mountDealer = (withHole) => () => {
      setDealerCards((prev) => (withHole ? [prev[0] ?? null, null] : [prev[0] ?? null]));
    };
    const t0 = Date.now();
    // Opening choreography — casino order: you, dealer up, you, dealer hole.
    later(mountPlayer(1), SWEEP + 60);
    later(mountDealer(false), SWEEP + 60 + DEAL_MS);
    later(mountPlayer(2), SWEEP + 60 + DEAL_MS * 2);
    later(mountDealer(true), SWEEP + 60 + DEAL_MS * 3);

    const data = await api("/api/games/blackjack/start", { betAmount: bet });
    if (!data) {
      // bet refused (limits/balance): sweep the phantom cards off the table
      clearTimers();
      setHands([]);
      setDealerCards([]);
      setStage("idle");
      return;
    }
    setStakeUi(data.totalStaked);
    const player = data.hands[0].cards.map(cardFromApi);
    const dealerUp = cardFromApi(data.dealer.cards[0]);
    resolved.current = { player, dealerUp, shell: { doubled: false, done: false, result: null, bet: data.hands[0].bet } };
    // Values flip in PER CARD, in deal order — never two faces at once, so
    // the flip sounds keep the dealt rhythm. Each position's value lands as
    // its flight ends (or as soon as the response allows, still in order).
    const flipAt = (k) => SWEEP + 60 + DEAL_MS * k + 470; // touchdown: 30ms hold + 430ms flight
    const elapsedNow = () => Date.now() - t0;
    later(() => setHands((prev) => (prev.length ? [{ ...resolved.current.shell, cards: prev[0].cards.map((c, i) => (i === 0 ? player[0] : c)) }] : prev)), Math.max(0, flipAt(0) - elapsedNow()));
    later(() => setDealerCards((prev) => (prev.length ? prev.map((c, i) => (i === 0 ? dealerUp : c)) : prev)), Math.max(60, flipAt(1) - elapsedNow()));
    later(() => setHands((prev) => (prev.length ? [{ ...resolved.current.shell, cards: prev[0].cards.map((c, i) => (i === 1 ? player[1] : c)) }] : prev)), Math.max(120, flipAt(2) - elapsedNow()));

    // hand control / settlement on the ORIGINAL timeline measured from the click
    const elapsed = Date.now() - t0;
    if (data.stage === "settled") {
      later(() => revealSettlement(data), Math.max(0, SWEEP + 60 + DEAL_MS * 3 + 760 - elapsed));
      return;
    }
    later(() => applyLiveState(data), Math.max(0, SWEEP + 60 + DEAL_MS * 3 + 680 - elapsed));
  }

  async function answerInsurance(take) {
    if (busy || stage !== "insurance") return;
    sound.prime();
    const data = await api("/api/games/blackjack/insurance", { take });
    if (!data) return;
    if (data.stage === "settled") {
      revealSettlement(data, 250);
      return;
    }
    applyLiveState(data);
  }

  async function split() {
    if (busy || stage !== "player" || !canSplit) return;
    sound.prime();
    const data = await api("/api/games/blackjack/split");
    if (!data) return;
    setStakeUi(data.totalStaked);

    // Choreography: the ACTIVE pair splits into two hands in place (re-split
    // keeps earlier hands untouched), then each new hand's second card
    // arrives from the shoe. Positional keys make only the split cards
    // re-deal — the rest of the table stays put.
    const idx = activeHand; // the hand that just split → new hands at idx, idx+1
    const mapped = data.hands.map(mapHand);
    setStage("dealing");
    setHands(mapped.map((h, i) => (i === idx || i === idx + 1 ? { ...h, cards: [h.cards[0]] } : h)));
    later(() => setHands(mapped.map((h, i) => (i === idx + 1 ? { ...h, cards: [h.cards[0]] } : h))), DEAL_MS);
    later(() => setHands(mapped), DEAL_MS * 2);

    if (data.stage === "settled") {
      later(() => revealSettlement(data), DEAL_MS * 2 + 520);
      return;
    }
    later(() => applyLiveState(data), DEAL_MS * 2 + 440);
  }

  async function hit() {
    if (busy || stage !== "player") return;
    sound.prime();
    const data = await api("/api/games/blackjack/hit");
    if (!data) return;
    if (data.stage === "settled") {
      setHands((prev) => prev.map((h, i) => (i === activeHand ? mapHand(data.hands[i]) : h)));
      revealSettlement(data, 540);
      return;
    }
    applyLiveState(data);
  }

  async function stand() {
    if (busy || stage !== "player") return;
    sound.prime();
    const data = await api("/api/games/blackjack/stand");
    if (!data) return;
    if (data.stage === "settled") {
      revealSettlement(data);
      return;
    }
    applyLiveState(data); // next split hand becomes active
  }

  async function doubleDown() {
    if (busy || stage !== "player" || !canDouble) return;
    sound.prime();
    const data = await api("/api/games/blackjack/double");
    if (!data) return;
    setStakeUi(data.totalStaked);
    if (data.stage === "settled") {
      setHands((prev) => prev.map((h, i) => (i === activeHand ? mapHand(data.hands[i]) : h)));
      revealSettlement(data, 540);
      return;
    }
    applyLiveState(data);
  }

  const inRound = ["dealing", "insurance", "player", "revealing"].includes(stage);
  const actionLabel = inRound ? "In play…" : "Bet";

  const bottombar = <GameBottombar game="blackjack" />;

  // One neutral tone for all four actions (the reference style) — 2×2 grid
  // on every breakpoint.
  const actionsRow = (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: mobile ? 8 : 8 }}>
      <SBJButton big={mobile} label="Hit" icon={BJ_ICONS.hit} iconColor="var(--gold)" onClick={hit} disabled={busy || stage !== "player"} />
      <SBJButton big={mobile} label="Stand" icon={BJ_ICONS.stand} iconColor="#B79CFF" onClick={stand} disabled={busy || stage !== "player"} />
      <SBJButton big={mobile} label="Split" icon={BJ_ICONS.split} iconColor="var(--text-muted)" onClick={split} disabled={busy || stage !== "player" || !canSplit} />
      <SBJButton big={mobile} label="Double" onClick={doubleDown} disabled={busy || stage !== "player" || !canDouble} />
    </div>
  );

  // Insurance is answered where the actions live (the reference's placement,
  // both breakpoints): "Insurance?" + two side-by-side buttons swap in for
  // the action grid.
  const insuranceBlock = (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ textAlign: "center", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13.5 }}>Insurance?</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <SBJButton big={mobile} label="Accept insurance" onClick={() => answerInsurance(true)} disabled={busy} />
        <SBJButton big={mobile} label="No insurance" onClick={() => answerInsurance(false)} disabled={busy} />
      </div>
    </div>
  );

  // Desktop cards scale to the measured canvas, a size smaller than before
  // (the reference's cards sit modestly in a roomy table).
  const [canvasRef, canvasH] = useCanvasHeight();
  const fitW = canvasH ? Math.max(64, Math.min(104, Math.floor((canvasH - 170) / 2.9))) : 96;
  const cardW = mobile
    ? (hands.length > 2 ? 44 : hands.length > 1 ? 54 : 70)
    : (hands.length > 2 ? Math.round(fitW * 0.62) : hands.length > 1 ? Math.round(fitW * 0.8) : fitW);
  // The FLAT table: deck pokes half-clipped from the top edge, rules ribbon
  // stays dead-centre in AND out of rounds, dealer top / player bottom, the
  // result toast floats over the ribbon. overflow:hidden does the deck clip.
  // Mobile keeps a constant-height stage inside FitBox so dealing can never
  // resize the layout.
  // Structure: dealer row · flex spacer · ribbon (IN FLOW) · flex spacer ·
  // player row. The two spacers are identical flex:1, so the gap above and
  // below the ribbon is ALWAYS equal — no matter how tall either hand grows.
  const table = (
    <div ref={canvasRef} style={{
      position: "relative", display: "flex", flexDirection: "column", alignItems: "center",
      width: "100%", boxSizing: "border-box",
      // desktop clips its own deck at the stage top; MOBILE must stay open —
      // the deck sits on the panel outside this (scaled) box, and clipping
      // here cuts cards mid-flight on their way in from it
      overflow: mobile ? "visible" : "hidden",
      ...(mobile
        ? { flex: "0 0 auto", height: 430, padding: "10px 8px 14px" }
        : { flex: 1, minHeight: 0, padding: "16px 16px 22px" }),
    }}>
      {/* desktop deck lives in the stage; the MOBILE deck is rendered on the
          panel itself (outside the FitBox) — the scaled-down stage centres
          with side margins, and a stage-anchored deck would float away from
          the screen edge instead of hugging it */}
      {!mobile && <SBJShoe w={96} right={8} />}
      {/* dealer, top — pill turns red when the dealer busts */}
      <div style={{ display: "flex", justifyContent: "center", minHeight: stage === "idle" ? 0 : undefined }}>
        {dealerCards.length > 0 && (
          <SBJHand cards={dealerCards} w={cardW} finished={stage === "settled"}
            result={stage === "settled" && handTotal(dealerCards).total > 21 ? "bust" : null} />
        )}
      </div>
      <SBJRibbon compact={mobile} />
      <div style={{ flex: 1 }} />
      {/* player hands, bottom */}
      <div style={{ display: "flex", gap: mobile ? 10 : 22, alignItems: "flex-end", justifyContent: "center" }}>
        {hands.map((h, i) => (
          <SBJHand key={i} cards={h.cards} w={cardW}
            active={stage === "player" && hands.length > 1 && i === activeHand && !h.done}
            doubled={h.doubled}
            result={stage === "settled" ? h.result : null} />
        ))}
      </div>
      {/* no win/lose message — borders and pills say it all; insurance is
          answered in the bet panel / controls sheet, never over the table */}
    </div>
  );

  // ── MOBILE: viewport-locked — topbar pinned, controls pinned, the felt
  // SCALES to the space between. Nothing scrolls, dealing can't move the page,
  // and the Bet button is always on screen. ──
  if (mobile) {
    // Reference mobile order: table panel (rounded, inset) → Bet → amount →
    // action grid. Page chrome sits on the lighter surface tone; the table
    // itself is the darker inset panel.
    return (
      <div style={{ height: vh, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
        <div style={{ flex: "1 1 auto", minHeight: 0, position: "relative", display: "flex", margin: "8px 8px 0", borderRadius: 12, background: "var(--ink)", overflow: "hidden" }}>
          {/* deck anchored to the PANEL edge, immune to FitBox scaling —
              half-clipped at the top (reference look); flights launch from
              its visible bottom edge so cards are never cut */}
          <SBJShoe w={46} right={2} />
          <FitBox>{table}</FitBox>
        </div>
        <div style={{ flex: "0 0 auto", maxHeight: "60%", overflowY: "auto", padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <ActionButton label={actionLabel} tone="primary" glow={!inRound} onClick={start} disabled={busy || inRound} small />
          <BetAmountInput value={amount} onChange={setAmount} disabled={inRound}
            onHalf={() => setAmount(String(Math.max(0, bet / 2).toFixed(2)))}
            onDouble={() => setAmount(String((bet * 2).toFixed(2)))}
            onMax={maxBet} label="Bet Amount" small compact
            topRight={`$${money(inRound || stage === "settled" ? stakeUi : bet)}`} />
          {/* CONSTANT-height zone (the 2x2 grid's exact height): swapping in
              the insurance question must never resize the sheet — a height
              change rescales the FitBox above and the whole table "flashes" */}
          <div style={{ height: 104, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            {stage === "insurance" ? insuranceBlock : actionsRow}
          </div>
          {error && (
            <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-caption)", fontWeight: 600 }}>{error}</div>
          )}
        </div>
        {bottombar}
      </div>
    );
  }

  // ── CABINET: the table owns the whole screen, controls docked bottom ──
  // Hand actions re-docked as a single horizontal row (same SBJButtons as the
  // panel's 2×2 grid); insurance swaps into the same slot as a row.
  const cabinetActions = (
    <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
      <SBJButton big label="Hit" icon={BJ_ICONS.hit} iconColor="var(--gold)" onClick={hit} disabled={busy || stage !== "player"} />
      <SBJButton big label="Stand" icon={BJ_ICONS.stand} iconColor="#B79CFF" onClick={stand} disabled={busy || stage !== "player"} />
      <SBJButton big label="Split" icon={BJ_ICONS.split} iconColor="var(--text-muted)" onClick={split} disabled={busy || stage !== "player" || !canSplit} />
      <SBJButton big label="Double" onClick={doubleDown} disabled={busy || stage !== "player" || !canDouble} />
    </div>
  );

  const cabinetInsurance = (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <div style={{ flex: "0 0 auto", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, padding: "0 6px" }}>Insurance?</div>
      <SBJButton big label="Accept insurance" onClick={() => answerInsurance(true)} disabled={busy} />
      <SBJButton big label="No insurance" onClick={() => answerInsurance(false)} disabled={busy} />
    </div>
  );

  return (
    <div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", padding: 14, boxSizing: "border-box", alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", padding: "12px 10px", boxSizing: "border-box", overflow: "hidden" }}>
          {table}
        </div>
      </div>
      <div style={{
        flex: "0 0 auto", boxSizing: "border-box", width: "100%",
        display: "flex", alignItems: "flex-end", gap: 14, padding: "12px 18px 14px",
        background: "var(--surface)", borderTop: "1px solid var(--border)",
      }}>
        <div style={{ flex: "0 0 320px" }}>
          <BetAmountInput value={amount} onChange={setAmount} disabled={inRound}
            onHalf={() => setAmount(String(Math.max(0, bet / 2).toFixed(2)))}
            onDouble={() => setAmount(String((bet * 2).toFixed(2)))}
            onMax={maxBet} label="Bet Amount"
            topRight={`$${money(inRound || stage === "settled" ? stakeUi : bet)}`} />
        </div>
        <div style={{ flex: "1 1 auto", minWidth: 0, maxWidth: 560 }}>
          {stage === "insurance" ? cabinetInsurance : cabinetActions}
        </div>
        <div style={{ flex: 1 }} />
        {error && (
          <div style={{ alignSelf: "center", maxWidth: 300, padding: "10px 14px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>
            {error}
          </div>
        )}
        <div style={{ flex: "0 0 300px" }}>
          <ActionButton label={actionLabel} tone="primary" glow={!inRound} onClick={start} disabled={busy || inRound} large />
        </div>
      </div>
      {bottombar}
    </div>
  );
}
