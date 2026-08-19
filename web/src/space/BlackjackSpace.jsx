// BLACKJACK — space-theme cabinet screen, ported from the "Blackjack Game"
// design handoff prototype. The deal choreography (cards 400ms apart, back-
// first flight + delayed 3D flip), the hole-card reveal, the paced dealer
// draw-out, the clear-out sweep, card faces/backs and the synthesized sfx are
// all the prototype's; every card, rule decision and payout is SERVER-
// authoritative (api/routes/blackjack.js: start / hit / stand / double /
// split / insurance / active). This design has no insurance UI — when the
// server lands in stage "insurance" (dealer shows an Ace) the client
// immediately and silently POSTs { take: false } and continues with the
// follow-up response. One split max here, even though the server allows
// re-splitting to four hands.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar,
  GoldButton, SoundButton, BetStepper, tileStyle, T,
} from "./Shell";
import { beep, whoosh, sfx, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import { useMaxBet } from "./limits";
import "./space.css";
import "./blackjack.css";

const CARD_W = "clamp(68px, 13vh, 152px)";

// Server card model: index 0..51, rank = index % 13 (0=Two…12=Ace),
// suit = floor(index / 13) → ♣ ♦ ♥ ♠ (api/lib/games/hilo.js).
const RANK_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = [
  { glyph: "♣", color: "#232c42" },
  { glyph: "♦", color: "#d64545" },
  { glyph: "♥", color: "#d64545" },
  { glyph: "♠", color: "#232c42" },
];

// Display-only blackjack totals (authoritative values come from the server;
// this only scores the cards currently VISIBLE mid-choreography).
const bjVal = (rank) => (rank === 12 ? 11 : rank >= 9 ? 10 : rank + 2);
function scoreOf(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (!c || c.index == null || c.faceDown) continue;
    const v = bjVal(c.index % 13);
    total += v;
    if (v === 11) aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

// Blackjack sfx kinds (prototype recipes) on the shared audio engine.
const bjSfx = {
  deal: () => { whoosh(1400, 3600, 0.09, 0.14); beep("triangle", 640, 480, 0.06, 0.08, 0.03); },
  flip: () => { whoosh(900, 2600, 0.1, 0.18); beep("sine", 880, 1100, 0.07, 0.12, 0.04); },
  click: sfx.click,
  win: sfx.win, // rising 4-note win chord — same notes as the prototype
  // NOTE: there is deliberately no lose sfx — the cabinet only celebrates
  // wins; a losing round settles in silence.
  // blackjack jackpot fanfare (prototype's 'huge')
  huge: () => {
    beep("sawtooth", 180, 1400, 0.1, 0.5);
    [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => {
      beep("square", f, 0, 0.07, 0.16, 0.12 + i * 0.055);
      beep("sine", f, 0, 0.12, 0.22, 0.12 + i * 0.055);
    });
    [0, 0.18, 0.36].forEach((at, k) => [523, 659, 784, 1047].forEach((f) => beep("triangle", f * (k === 2 ? 1.5 : 1), 0, 0.09, 0.5, 0.55 + at)));
    beep("sine", 3136, 1568, 0.05, 1.1, 0.6);
    beep("sine", 65, 45, 0.3, 0.6, 0.05);
  },
};

// Client card: { index: 0..51 | null (unknown hole), faceDown, anim }.
// anim 'deal' plays the fly-in (+flip when face-up); 'none' renders in place.
const mkCard = (apiCard, anim = "deal") => ({ index: apiCard.index, faceDown: false, anim });
const holeCard = () => ({ index: null, faceDown: true, anim: "deal" });

// One playing card, exactly per the prototype's cardView: 5/7 aspect,
// clamp() width, corner ranks, centre pip, and the space-themed back with
// the gold "M" orb. The hole reveal is the ROT change — the .65s transform
// transition flips it in place.
function CardCell({ c, i, clearing }) {
  const suit = c.index != null ? SUITS[Math.floor(c.index / 13)] : null;
  const rank = c.index != null ? RANK_LABELS[c.index % 13] : "";
  const color = suit ? suit.color : "#232c42";
  let dealAnim = "none", flipAnim = "none";
  if (clearing) {
    dealAnim = `bjClearOut .45s ease ${(i * 0.06).toFixed(2)}s both`;
  } else if (c.anim === "deal") {
    dealAnim = "bjDealIn .5s ease both" + (i > 0 ? ", bjMakeRoom .45s cubic-bezier(.25,.8,.35,1) both" : "");
    if (!c.faceDown) flipAnim = "bjFlipIn .65s cubic-bezier(.3,.9,.3,1) .34s both";
  }
  return (
    <div style={{ width: CARD_W, aspectRatio: "5 / 7", perspective: 900, animation: dealAnim }}>
      <div style={{ position: "relative", width: "100%", height: "100%", transformStyle: "preserve-3d", transform: `rotateY(${c.faceDown ? "180deg" : "0deg"})`, transition: "transform .65s cubic-bezier(.3,.9,.3,1)", animation: flipAnim }}>
        {/* face */}
        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", borderRadius: 12, background: "linear-gradient(160deg, #fdfdf8, #eef0ee 60%, #dde2e2)", boxShadow: "0 10px 26px rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ position: "absolute", top: 6, left: 10, fontSize: "clamp(25px, 4.2vh, 40px)", fontWeight: 700, lineHeight: 1, color }}>{rank}</span>
          <span style={{ position: "absolute", top: "clamp(30px, 5vh, 44px)", left: 11, fontSize: "clamp(15px, 2.2vh, 20px)", lineHeight: 1, color }}>{suit ? suit.glyph : ""}</span>
          <span style={{ fontSize: "clamp(39px, 6.6vh, 64px)", color }}>{suit ? suit.glyph : ""}</span>
          <span style={{ position: "absolute", bottom: 6, right: 10, fontSize: "clamp(25px, 4.2vh, 40px)", fontWeight: 700, lineHeight: 1, color, transform: "rotate(180deg)" }}>{rank}</span>
        </div>
        {/* back: deep-space blue, star specks, gold inner frame, "M" orb */}
        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)", borderRadius: 12, background: "radial-gradient(130% 120% at 30% 20%, #1c2740, #0d1322 70%)", boxShadow: "0 10px 26px rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <span style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 22% 28%, rgba(255,255,255,.8) 1px, transparent 1.6px), radial-gradient(circle at 68% 16%, rgba(240,217,154,.7) 1px, transparent 1.6px), radial-gradient(circle at 80% 70%, rgba(255,255,255,.6) 1px, transparent 1.6px), radial-gradient(circle at 36% 78%, rgba(140,190,255,.6) 1px, transparent 1.6px), radial-gradient(circle at 55% 48%, rgba(255,255,255,.5) 1px, transparent 1.6px)" }} />
          <span style={{ position: "absolute", inset: 8, borderRadius: 8, border: "1px solid rgba(217,178,106,.5)" }} />
          <span style={{ width: "46%", aspectRatio: "1", borderRadius: "50%", background: "radial-gradient(circle at 36% 32%, #f6e3ac, #d9b26a 55%, #97742f)", boxShadow: "0 0 22px rgba(240,217,154,.5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "clamp(17px, 2.6vh, 24px)", fontWeight: 700, color: "#1a1408" }}>M</span>
        </div>
      </div>
    </div>
  );
}

function RulesModal({ onClose }) {
  const row = (mark, color, text) => (
    <div style={{ display: "flex", gap: 13 }}>
      <span style={{ color, fontWeight: 700 }}>{mark}</span><span>{text}</span>
    </div>
  );
  return (
    // a flat scrim, never backdrop-filter: the scene behind this never stops
    // moving, so the blur would re-read and re-blur the whole screen every
    // frame for as long as a player leaves the rules open
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,6,10,.86)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540, padding: "38px 42px", borderRadius: 24, border: `2px solid ${T.ctlBorder}`, background: "linear-gradient(180deg,#111826,#0a0d14)", boxShadow: "0 34px 90px rgba(0,0,0,.65)" }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>HOW TO PLAY</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 15, margin: "26px 0 30px", fontSize: 17, lineHeight: 1.5, color: "#b7c0d1" }}>
          {row("♠", T.gold, "Get closer to 21 than the dealer without going over.")}
          {/* ♥/♦ carry the CARD's red — a suit colour, not a loss signal */}
          {row("♥", "#d64545", "HIT takes a card, STAND ends your turn, DOUBLE doubles the bet for one final card.")}
          {row("♦", "#d64545", "Matching pair? SPLIT into two hands, each with its own bet.")}
          {row("♣", T.gold, "Blackjack pays 3:2. Dealer stands on all 17s.")}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}

export default function BlackjackSpace() {
  // the backoffice owns this; the screen used to hardcode it
  const MAX_BET = useMaxBet("blackjack");
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  // phase: idle → clearing → dealing → player → dealer (reveal) → over
  const [phase, setPhase] = useState("idle");
  const [bet, setBet] = useState(100);
  // hands: [{ cards, bet, doubled, done, result }] — server-confirmed only
  const [hands, setHands] = useState([]);
  const [dealer, setDealer] = useState([]);
  const [activeHand, setActiveHand] = useState(0);
  const [holeUp, setHoleUp] = useState(false);
  const [canDouble, setCanDouble] = useState(false);
  const [canSplit, setCanSplit] = useState(false);
  const [lastWin, setLastWin] = useState(null); // net of the last settled round
  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState("idle"); // big | win | push | lose
  const [shake, setShake] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const timers = useRef([]);
  const busyRef = useRef(false);
  const hasSplitRef = useRef(false); // design allows ONE split per round
  const handsRef = useRef(hands); handsRef.current = hands;
  const dealerRef = useRef(dealer); dealerRef.current = dealer;

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // ── SUSPENSE: freeze the credits readout from the moment a settling
  // request goes out until the reveal choreography actually shows the
  // outcome. holdsRef counts our own outstanding holds so every early
  // return (error, !ok, unmount mid-flight) can give them all back.
  const holdsRef = useRef(0);
  const takeHold = () => { holdsRef.current++; holdBalance(); };
  const dropHold = () => { if (holdsRef.current > 0) { holdsRef.current--; releaseBalance(); } };
  useEffect(() => () => {
    clearTimers();
    while (holdsRef.current > 0) { holdsRef.current--; releaseBalance(); }
  }, []);

  const setBusyBoth = (v) => { busyRef.current = v; setBusy(v); };
  const showError = (m) => { setError(m || "SOMETHING WENT WRONG"); later(() => setError(""), 2600); };

  // Merge a server hands array into the client hands, REUSING existing card
  // objects (same slot, same index) so in-flight deal animations never
  // restart when flags/results land.
  function mergeHands(prev, serverHands) {
    return serverHands.map((sh, hi) => {
      const ph = prev[hi];
      return {
        bet: sh.bet,
        doubled: sh.doubled,
        done: sh.done,
        result: sh.result ?? null,
        cards: sh.cards.map((c, ci) => {
          const pc = ph && ph.cards[ci];
          return pc && pc.index === c.index && !pc.faceDown ? pc : { index: c.index, faceDown: false, anim: "none" };
        }),
      };
    });
  }

  function applyLive(eff) {
    setHands((prev) => mergeHands(prev, eff.hands));
    setActiveHand(eff.activeHand);
    setCanDouble(!!eff.canDouble);
    setCanSplit(!!eff.canSplit);
    setPhase("player");
  }

  // ── settle reveal: hole flips in place, extra dealer draws land one by
  // one (prototype pacing: first at 650ms, then 800ms apart), banner last ──
  function revealSettlement(eff) {
    setPhase("dealer");
    setCanDouble(false);
    setCanSplit(false);
    const dc = eff.dealer.cards;
    bjSfx.flip();
    setHoleUp(true);
    setDealer((prev) => {
      const next = prev.slice(0, 2);
      while (next.length < 2) next.push(holeCard());
      if (!(next[0].index === dc[0].index && !next[0].faceDown)) next[0] = { index: dc[0].index, faceDown: false, anim: "none" };
      next[1] = { index: dc[1].index, faceDown: false, anim: "none" }; // rot 180 → 0 transition = the flip
      return next;
    });
    const extras = dc.length - 2;
    for (let k = 0; k < extras; k++) {
      later(() => {
        bjSfx.deal();
        later(bjSfx.flip, 400);
        setDealer((prev) => [...prev, mkCard(dc[2 + k])]);
      }, 650 + k * 800);
    }
    later(() => finishRound(eff), extras > 0 ? 650 + extras * 800 + 550 : 700);
  }

  function finishRound(eff) {
    const dv = eff.dealer.value;
    const dealerBJ = eff.dealer.cards.length === 2 && dv === 21;
    const payout = Number(eff.payout) || 0;
    const staked = Number(eff.totalStaked) || 0;
    const net = Math.round((payout - staked) * 100) / 100;
    const allBust = eff.hands.every((h) => h.result === "bust");
    const anyBJ = eff.hands.some((h) => h.result === "blackjack");
    let m, kind;
    if (anyBJ && net > 0) { m = "BLACKJACK!"; kind = "big"; }
    else if (allBust) { m = "BUST"; kind = "lose"; }
    else if (net > 0) { m = "WIN +" + fmtMKD(net); kind = "win"; }
    else if (net === 0 && payout > 0) { m = "PUSH"; kind = "push"; }
    else if (dealerBJ) { m = "DEALER BLACKJACK"; kind = "lose"; }
    else { m = dv > 21 ? "DEALER BUSTS" : "DEALER WINS"; kind = "lose"; }
    setHands((prev) => mergeHands(prev, eff.hands));
    setLastWin(net);
    setMsg(m);
    setMsgKind(kind);
    setShake(kind === "big" || kind === "win");
    setFlashOn(kind === "big");
    setPhase("over");
    if (kind === "big") bjSfx.huge();
    else if (kind === "win") bjSfx.win();
    else if (kind === "push") bjSfx.click();
    // a losing round makes no sound at all
    dropHold(); // the banner is up — the credits may move now
    later(() => { setShake(false); setFlashOn(false); }, 800);
  }

  // ── insurance auto-decline (this design has no insurance UI) ──────────────
  async function declineInsurance() {
    for (let a = 0; a < 3; a++) {
      const { ok, data } = await apiPost("/api/games/blackjack/insurance", { take: false });
      if (ok) return data;
      if (a === 2) showError(data && data.error);
      await new Promise((r) => setTimeout(r, 400));
    }
    return null;
  }

  // ── resume a live server round (mount / 409 on start) — no deal anims ─────
  async function resumeActive() {
    const { ok, data } = await apiGet("/api/games/blackjack/active");
    if (!ok || !data.active) return false;
    clearTimers();
    setBet(Math.max(50, Math.min(MAX_BET, Math.round((Number(data.betAmount) || 50) / 50) * 50)));
    hasSplitRef.current = data.hands.length > 1 || data.hands.some((h) => h.fromSplit);
    setHands(data.hands.map((h) => ({
      bet: h.bet, doubled: h.doubled, done: h.done, result: h.result ?? null,
      cards: h.cards.map((c) => ({ index: c.index, faceDown: false, anim: "none" })),
    })));
    setDealer([
      { index: data.dealer.cards[0].index, faceDown: false, anim: "none" },
      { index: null, faceDown: true, anim: "none" },
    ]);
    setHoleUp(false);
    setActiveHand(data.activeHand);
    setCanDouble(!!data.canDouble);
    setCanSplit(!!data.canSplit);
    setLastWin(null);
    setMsg("");
    setMsgKind("idle");
    if (data.stage === "insurance") {
      setPhase("dealing");
      setBusyBoth(true);
      takeHold(); // declining can settle the round (dealer natural)
      let eff = null;
      try { eff = await declineInsurance(); } finally { setBusyBoth(false); }
      if (!eff || eff.stage === "insurance") { dropHold(); setPhase("player"); return true; }
      if (eff.stage === "settled") revealSettlement(eff); // finishRound releases
      else { dropHold(); applyLive(eff); }
    } else {
      setPhase("player");
    }
    return true;
  }

  useEffect(() => {
    armAmbientOnGesture();
    startAmbient();
    let dead = false;
    (async () => { if (!dead) await resumeActive(); })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── DEAL: sweep old cards, POST start, choreograph the response ───────────
  const inRound = phase === "clearing" || phase === "dealing" || phase === "player" || phase === "dealer";

  function beginChoreo(data) {
    hasSplitRef.current = false;
    setPhase("dealing");
    setHoleUp(false);
    setLastWin(null);
    setMsg("");
    setMsgKind("idle");
    setShake(false);
    setFlashOn(false);
    setActiveHand(0);
    setCanDouble(false);
    setCanSplit(false);
    const h0 = data.hands[0];
    setHands([{ bet: h0.bet, doubled: false, done: false, result: null, cards: [] }]);
    setDealer([]);
    const giveP = (c) => setHands((prev) => (prev.length ? [{ ...prev[0], cards: [...prev[0].cards, mkCard(c)] }] : prev));
    // casino order, 400ms apart: you, dealer up, you, dealer hole (stays down)
    later(() => { bjSfx.deal(); later(bjSfx.flip, 380); giveP(h0.cards[0]); }, 60);
    later(() => { bjSfx.deal(); later(bjSfx.flip, 380); setDealer([mkCard(data.dealer.cards[0])]); }, 460);
    later(() => { bjSfx.deal(); later(bjSfx.flip, 380); giveP(h0.cards[1]); }, 860);
    later(() => { bjSfx.deal(); setDealer((prev) => [...prev, holeCard()]); }, 1260);
  }

  async function deal() {
    if (busyRef.current || inRound) return;
    if (balance < 50) return;
    setBusyBoth(true);
    setError("");
    const stake = Math.max(50, Math.min(bet, MAX_BET, Math.floor(balance)));
    setBet(stake);
    const hadCards = handsRef.current.length > 0 || dealerRef.current.length > 0;
    const t0 = performance.now();
    if (hadCards) {
      // sweep the old round off first (prototype's clear-out, 60ms stagger)
      setPhase("clearing");
      setMsg("");
      setLastWin(null);
      bjSfx.flip();
    }
    // the deal itself can settle instantly (naturals) — freeze the credits
    takeHold();
    const { ok, status, data } = await apiPost("/api/games/blackjack/start", { betAmount: stake });
    if (!ok) {
      dropHold();
      setBusyBoth(false);
      setHands([]);
      setDealer([]);
      setPhase("idle");
      if (status === 409 && (await resumeActive())) return; // round already live → pick it up
      showError(data && data.error);
      return;
    }
    // Dealer shows an Ace → server pauses in stage "insurance". No insurance
    // in this design: decline in the background while the cards fly in.
    let effPromise = Promise.resolve(data);
    if (data.stage === "insurance") effPromise = declineInsurance().then((d) => d || data);

    const wait = hadCards ? Math.max(0, 480 - (performance.now() - t0)) : 0;
    later(() => beginChoreo(data), wait);
    later(async () => {
      let eff;
      try { eff = await effPromise; } catch { dropHold(); setBusyBoth(false); return; }
      setBusyBoth(false);
      if (eff.stage === "settled") revealSettlement(eff); // natural — finishRound releases
      else if (eff.stage === "player") { dropHold(); applyLive(eff); }
      else { dropHold(); setPhase("player"); } // decline failed hard; leave the round visible
    }, wait + 1900);
  }

  // ── player actions (server decides; the client paces the cards) ───────────
  async function hit() {
    if (phase !== "player" || busyRef.current) return;
    setBusyBoth(true);
    const idx = activeHand;
    takeHold(); // a hit can bust the hand and settle the round
    const { ok, data } = await apiPost("/api/games/blackjack/hit");
    if (!ok) { dropHold(); setBusyBoth(false); showError(data && data.error); return; }
    const sh = data.hands[idx];
    const card = sh.cards[sh.cards.length - 1];
    bjSfx.deal();
    later(bjSfx.flip, 400);
    setHands((prev) => prev.map((h, i) => (i === idx ? { ...h, done: sh.done, cards: [...h.cards, mkCard(card)] } : h)));
    if (data.stage === "settled") {
      later(() => { setBusyBoth(false); revealSettlement(data); }, 800); // finishRound releases
    } else if (sh.done) {
      // 21 or bust on a split hand — pause, then the next hand takes over
      later(() => { dropHold(); setBusyBoth(false); applyLive(data); }, 700);
    } else {
      dropHold(); // nothing settled — the stake is already on screen
      setBusyBoth(false);
      applyLive(data);
    }
  }

  async function stand() {
    if (phase !== "player" || busyRef.current) return;
    bjSfx.click();
    setBusyBoth(true);
    takeHold(); // standing hands the round to the dealer — it can settle
    const { ok, data } = await apiPost("/api/games/blackjack/stand");
    setBusyBoth(false);
    if (!ok) { dropHold(); showError(data && data.error); return; }
    if (data.stage === "settled") revealSettlement(data); // finishRound releases
    else { dropHold(); applyLive(data); }
  }

  async function doubleDown() {
    if (phase !== "player" || busyRef.current || !canDouble) return;
    setBusyBoth(true);
    const idx = activeHand;
    takeHold(); // one final card, then the round settles
    // doubling charges a second bet on this hand — deduct it at the press
    const { ok, data } = await apiPost("/api/games/blackjack/double", null, { stake: hands[idx]?.bet || 0 });
    if (!ok) { dropHold(); setBusyBoth(false); showError(data && data.error); return; }
    const sh = data.hands[idx];
    const card = sh.cards[sh.cards.length - 1];
    bjSfx.deal();
    later(bjSfx.flip, 400);
    setHands((prev) => prev.map((h, i) => (i === idx ? { ...h, doubled: true, done: true, cards: [...h.cards, mkCard(card)] } : h)));
    if (data.stage === "settled") later(() => { setBusyBoth(false); revealSettlement(data); }, 800); // finishRound releases
    else later(() => { dropHold(); setBusyBoth(false); applyLive(data); }, 700);
  }

  async function split() {
    if (phase !== "player" || busyRef.current || !canSplit || hasSplitRef.current) return;
    setBusyBoth(true);
    takeHold(); // split aces auto-stand — the round can settle straight away
    // the new hand carries its own bet — deduct it at the press
    const { ok, data } = await apiPost("/api/games/blackjack/split", null, { stake: hands[activeHand]?.bet || 0 });
    if (!ok) { dropHold(); setBusyBoth(false); showError(data && data.error); return; }
    hasSplitRef.current = true; // ONE split per round in this design
    setCanDouble(false);
    setCanSplit(false);
    setPhase("dealing");
    const m = data.hands; // the pair became hands 0 and 1
    bjSfx.deal();
    later(bjSfx.deal, 160);
    // pair parts in place, then each new hand draws its second card
    setHands((prev) => {
      const h = prev[0] || { cards: [] };
      const c0 = h.cards[0] && h.cards[0].index === m[0].cards[0].index
        ? h.cards[0]
        : { index: m[0].cards[0].index, faceDown: false, anim: "none" };
      return [
        { bet: m[0].bet, doubled: false, done: false, result: null, cards: [c0] },
        { bet: m[1].bet, doubled: false, done: false, result: null, cards: [{ index: m[1].cards[0].index, faceDown: false, anim: "deal" }] },
      ];
    });
    const addSecond = (hi) => setHands((prev) => prev.map((h, i) => (i === hi ? { ...h, cards: [...h.cards, mkCard(m[hi].cards[1])] } : h)));
    later(() => { bjSfx.deal(); later(bjSfx.flip, 380); addSecond(0); }, 420);
    later(() => { bjSfx.deal(); later(bjSfx.flip, 380); addSecond(1); }, 820);
    if (data.stage === "settled") later(() => { setBusyBoth(false); revealSettlement(data); }, 1500); // split aces auto-stood; finishRound releases
    else later(() => { dropHold(); setBusyBoth(false); applyLive(data); }, 1350);
  }

  // ── derived render values (prototype's renderVals) ────────────────────────
  const clearing = phase === "clearing";
  const canDeal = !inRound && !busy && balance >= 50;
  const betLabel = fmtMKD(Math.max(50, Math.min(bet, Math.max(50, Math.floor(balance) || 50))));

  const dealerHasScore = dealer.length > 0;
  const dealerScore = !dealerHasScore
    ? ""
    : holeUp
      ? String(scoreOf(dealer))
      : dealer[0] && dealer[0].index != null ? String(bjVal(dealer[0].index % 13)) : "";

  // Per-hand verdict. Wins keep their gold/green; losing hands read in the
  // neutral greys — legible, never punishing (no red anywhere on a loss).
  const RES_MAP = {
    win: ["WIN", T.win],
    blackjack: ["BLACKJACK", T.gold],
    push: ["PUSH", T.text2],
    lose: ["LOSE", T.text2],
    bust: ["BUST", T.text2],
  };

  const handRows = hands.map((h, hi) => {
    const v = scoreOf(h.cards);
    const activeH = phase === "player" && hi === activeHand && !h.done;
    const resKey = h.result || (h.done && v > 21 ? "bust" : null);
    const res = resKey ? RES_MAP[resKey] : null;
    return {
      cards: h.cards,
      score: h.cards.length ? String(v) : "",
      scoreColor: v > 21 ? T.text2 : v === 21 ? T.win : T.gold,
      scoreBorder: v > 21 ? T.ctlBorder : v === 21 ? "#2b6e55" : activeH && hands.length > 1 ? T.accent : T.ctlBorder,
      betText: fmtMKD(h.bet * (h.doubled ? 2 : 1)) + (h.doubled ? " ×2" : ""),
      result: res ? res[0] : "",
      resColor: res ? res[1] : T.muted,
    };
  });

  // centre readout pill
  let readText = "", readColor = T.muted, readGlow = "rgba(0,0,0,0)";
  if (error) { readText = String(error).toUpperCase(); readColor = T.lose; readGlow = "rgba(255,90,74,.5)"; }
  else if (phase === "idle") readText = "PRESS DEAL TO START";
  else if (phase === "over") {
    readText = msg;
    readColor = msgKind === "big" ? T.gold : msgKind === "win" ? T.win : T.text2; // losses read neutral grey
    readGlow = msgKind === "big" ? "rgba(240,217,154,.55)" : msgKind === "win" ? "rgba(46,230,166,.45)" : "rgba(0,0,0,0)";
  } else if (phase === "dealer") { readText = "DEALER DRAWS…"; readColor = T.text2; }
  else if (phase === "dealing" || phase === "clearing") { readText = "DEALING…"; readColor = T.text2; }
  else if (hands.length > 1) { readText = `HAND ${activeHand + 1} OF 2`; readColor = T.gold; }

  // header status chip (last win)
  const chip = lastWin != null
    ? { label: (lastWin >= 0 ? "+" + fmtMKD(lastWin) : "−" + fmtMKD(-lastWin)), color: lastWin > 0 ? T.win : T.text2 }
    : { label: "READY", color: T.text2 };

  const playing = phase === "player" && !busy;
  const actions = [
    { label: "HIT", enabled: playing, fn: hit },
    { label: "STAND", enabled: playing, fn: stand },
    { label: "DOUBLE", enabled: playing && canDouble, fn: doubleDown },
    { label: "SPLIT", enabled: playing && canSplit && !hasSplitRef.current, fn: split },
  ];

  const payRow = (k, v) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "clamp(13px, 2vh, 16px)", fontWeight: 700 }}>
      <span style={{ color: T.text2 }}>{k}</span><span style={{ color: T.gold }}>{v}</span>
    </div>
  );

  const cardRow = { display: "flex", gap: "clamp(8px, 1vw, 14px)", height: `calc(${CARD_W} * 1.4)`, flex: "none", alignItems: "center" };

  return (
    <SpaceRoot>

      {/* blackjack jackpot flash (gold wash from the table edge) */}
      <div style={{ position: "absolute", inset: 0, zIndex: 8, pointerEvents: "none", background: "radial-gradient(115% 90% at 50% 105%, rgba(240,217,154,.14), rgba(240,217,154,0) 55%)", opacity: flashOn ? 1 : 0, transition: "opacity .5s ease" }} />

      <SpaceHeader title="BLACKJACK" chip={chip} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>

        {/* ── left control panel ── */}
        <SpaceSidebar>
          <SoundButton />
          <BetStepper bet={bet} setBet={setBet} disabled={inRound} maxBet={MAX_BET} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "clamp(8px, 1.6vh, 14px)", borderRadius: 16, border: `2px solid ${T.panelBorder}`, background: "rgba(255,255,255,.02)" }}>
            <div style={{ fontSize: 12, letterSpacing: 3, color: T.muted }}>PAYS</div>
            {payRow("BLACKJACK", "3 : 2")}
            {payRow("WIN", "1 : 1")}
            {payRow("DEALER STANDS", "17")}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => { bjSfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={tileStyle({ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, minHeight: "clamp(46px, 8vh, 64px)", fontSize: "clamp(14px, 2vh, 17px)", letterSpacing: 3 })}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>LOBBY
            </button>
            <button onClick={() => { bjSfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={tileStyle({ flex: "none", width: "clamp(46px, 8vh, 64px)", minHeight: "clamp(46px, 8vh, 64px)", color: T.text2, display: "flex", alignItems: "center", justifyContent: "center" })}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" /></svg>
            </button>
          </div>
        </SpaceSidebar>

        {/* ── table column ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* the table: dealer on top, readout pill, player hands below */}
          <div style={{ position: "relative", flex: 1, minHeight: 140, margin: "6px 24px 6px 14px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(6px, 1.6vh, 16px)", overflow: "hidden", animation: shake ? "bjShake .55s ease" : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "clamp(5px, 1.2vh, 12px)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, height: "clamp(34px, 5.4vh, 44px)", flex: "none" }}>
                <span style={{ fontSize: 13, letterSpacing: 4, color: T.muted }}>DEALER</span>
                {dealerHasScore && dealerScore !== "" && (
                  <span style={{ minWidth: 52, textAlign: "center", padding: "4px 14px", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: "rgba(10,14,22,.8)", fontSize: "clamp(18px, 2.8vh, 24px)", fontWeight: 700, color: T.text }}>{dealerScore}</span>
                )}
              </div>
              <div style={cardRow}>
                {dealer.map((c, i) => <CardCell key={i} c={c} i={i} clearing={clearing} />)}
              </div>
            </div>

            <div style={{ height: "clamp(38px, 6vh, 52px)", flex: "none", display: "flex", alignItems: "center", position: "relative", zIndex: 6 }}>
              <div style={{ maxHeight: "100%", padding: "3px 22px", borderRadius: 30, background: "rgba(5,7,12,.9)", fontSize: "clamp(20px, 3.6vh, 34px)", fontWeight: 700, letterSpacing: 3, whiteSpace: "nowrap", color: readColor, textShadow: `0 0 26px ${readGlow}` }}>{readText}</div>
            </div>

            <div style={{ display: "flex", gap: "clamp(18px, 3vw, 48px)" }}>
              {handRows.map((h, hi) => (
                <div key={hi} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "clamp(5px, 1.2vh, 12px)" }}>
                  <div style={cardRow}>
                    {h.cards.map((c, ci) => <CardCell key={ci} c={c} i={ci} clearing={clearing} />)}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, height: "clamp(36px, 5.6vh, 46px)", flex: "none" }}>
                    <span style={{ minWidth: 56, textAlign: "center", padding: "5px 16px", borderRadius: 20, border: `2px solid ${h.scoreBorder}`, background: "rgba(10,14,22,.8)", fontSize: "clamp(19px, 3vh, 26px)", fontWeight: 700, color: h.scoreColor }}>{h.score}</span>
                    <span style={{ fontSize: "clamp(13px, 2vh, 16px)", fontWeight: 700, letterSpacing: 2, color: T.muted }}>{h.betText}</span>
                    <span style={{ fontSize: "clamp(14px, 2.2vh, 18px)", fontWeight: 700, letterSpacing: 2, color: h.resColor }}>{h.result}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── actions: 2×2 grid + the gold DEAL ── */}
          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", justifyContent: "center", gap: "clamp(10px, 1.2vw, 18px)", margin: "0 clamp(10px, 1.6vw, 24px) 20px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "clamp(8px, 1.2vh, 12px)", minWidth: "clamp(260px, 30vw, 460px)" }}>
              {actions.map((a) => (
                <button key={a.label} onClick={a.enabled ? a.fn : undefined} disabled={!a.enabled} className="sp-hover-gold"
                  style={{ minHeight: "clamp(48px, 8.5vh, 72px)", padding: "0 clamp(10px, 1.4vw, 26px)", borderRadius: 18, border: `2px solid ${a.enabled ? "#3a4557" : T.panelBorder}`, background: T.panelBg, color: a.enabled ? T.text : T.disabled, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 22px)", fontWeight: 700, letterSpacing: "clamp(1px, .2vw, 3px)", cursor: a.enabled ? "pointer" : "default", opacity: a.enabled ? 1 : 0.5, transition: "all .2s ease", whiteSpace: "nowrap" }}>
                  {a.label}
                </button>
              ))}
            </div>
            <GoldButton label="DEAL" sub={betLabel} onClick={deal} disabled={!canDeal}
              labelSize="clamp(21px, 2.1vw, 32px)"
              style={{ flex: "none", minWidth: "clamp(180px, 19vw, 320px)", alignSelf: "stretch", minHeight: 0, borderRadius: 22 }} />
          </div>

        </div>
      </div>

      {rules && <RulesModal onClose={() => setRules(false)} />}
    </SpaceRoot>
  );
}
