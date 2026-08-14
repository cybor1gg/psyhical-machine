// BACCARAT — "ORBITAL BACCARAT", space-theme cabinet screen. Two hand zones
// side by side (PLAYER left, BANKER right) with round gold score orbs and a
// TIE marker between them; three big glowing bet pads along the bottom
// (PLAYER 1:1 / TIE 8:1 / BANKER 0.95:1) that take the current CHIP step per
// tap. Card rendering + fly-in/flip choreography replicated from the
// blackjack screen (bcDealIn family in baccarat.css). INSTANT family: DEAL
// POSTs the whole layout once and the server resolves the coup — cards,
// totals, winner, payouts and the balance are all api/routes/baccarat.js's;
// the client only paces the reveal. Third-card tableau runs server-side.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api";
import { useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar,
  GoldButton, SoundButton, BetStepper, tileStyle, T,
} from "./Shell";
import { beep, whoosh, sfx, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import { useMaxBet } from "./limits";
import "./space.css";
import "./baccarat.css";

const CARD_W = "clamp(60px, 11vh, 136px)";

// Server card model: index 0..51, rank = index % 13 (0=Two…12=Ace),
// suit = floor(index / 13) → ♣ ♦ ♥ ♠ (api/lib/games/hilo.js).
const RANK_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = [
  { glyph: "♣", color: "#232c42" },
  { glyph: "♦", color: "#d64545" },
  { glyph: "♥", color: "#d64545" },
  { glyph: "♠", color: "#232c42" },
];

// Display-only baccarat totals for the orbs mid-choreography (A=1, 2..9 pip,
// tens/faces 0, sum mod 10) — the settled values come from the server.
const baccVal = (rank) => (rank === 12 ? 1 : rank >= 8 ? 0 : rank + 2);
const totalOf = (cards) => cards.reduce((t, c) => t + (c && c.index != null ? baccVal(c.index % 13) : 0), 0) % 10;

// The three bet spots, table order. Payout language mirrors the route:
// player 1:1, banker 0.95:1 (5% commission), tie 8:1; a tie pushes staked
// player/banker spots.
const SPOTS = [
  { key: "player", label: "PLAYER", pays: "1 : 1", hue: "#8cbeff", edge: "#4d7fb5", glow: "rgba(120,180,255,.35)", tint: "rgba(90,160,230,.08)" },
  { key: "tie", label: "TIE", pays: "8 : 1", hue: T.gold, edge: T.accent, glow: "rgba(240,217,154,.35)", tint: "rgba(217,178,106,.08)" },
  { key: "banker", label: "BANKER", pays: "0.95 : 1", hue: "#ff9a8a", edge: "#b05a48", glow: "rgba(255,140,110,.32)", tint: "rgba(230,110,90,.08)" },
];

// Baccarat sfx kinds on the shared audio engine (deal/flip are the blackjack
// recipes; chip is the gold chip-pop click; huge is the tie jackpot fanfare).
const bcSfx = {
  deal: () => { whoosh(1400, 3600, 0.09, 0.14); beep("triangle", 640, 480, 0.06, 0.08, 0.03); },
  flip: () => { whoosh(900, 2600, 0.1, 0.18); beep("sine", 880, 1100, 0.07, 0.12, 0.04); },
  chip: () => { sfx.click(); beep("triangle", 980, 1460, 0.09, 0.11, 0.01); },
  click: sfx.click,
  bet: sfx.bet,
  win: sfx.win,
  // NOTE: there is deliberately no lose sfx — a losing coup settles silently.
  // tie jackpot fanfare (blackjack's 'huge')
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

// One playing card, replicated from the blackjack screen's cardView: 5/7
// aspect, corner ranks, centre pip, the space-themed back with the gold "M"
// orb, and the bcDealIn flight + delayed bcFlipIn (all cards land face-up
// in baccarat — nobody holds a hole card).
function CardCell({ c, i, clearing }) {
  const suit = c.index != null ? SUITS[Math.floor(c.index / 13)] : null;
  const rank = c.index != null ? RANK_LABELS[c.index % 13] : "";
  const color = suit ? suit.color : "#232c42";
  let dealAnim = "none", flipAnim = "none";
  if (clearing) {
    dealAnim = `bcClearOut .45s ease ${(i * 0.06).toFixed(2)}s both`;
  } else if (c.anim === "deal") {
    dealAnim = "bcDealIn .5s ease both" + (i > 0 ? ", bcMakeRoom .45s cubic-bezier(.25,.8,.35,1) both" : "");
    flipAnim = "bcFlipIn .65s cubic-bezier(.3,.9,.3,1) .34s both";
  }
  return (
    <div style={{ width: CARD_W, aspectRatio: "5 / 7", perspective: 900, animation: dealAnim }}>
      {/* fill-mode "both" holds the back (180°) through the flight delay, then flips */}
      <div style={{ position: "relative", width: "100%", height: "100%", transformStyle: "preserve-3d", transform: "rotateY(0deg)", animation: flipAnim }}>
        {/* face */}
        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", borderRadius: 12, background: "linear-gradient(160deg, #fdfdf8, #eef0ee 60%, #dde2e2)", boxShadow: "0 10px 26px rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ position: "absolute", top: 6, left: 10, fontSize: "clamp(22px, 3.8vh, 36px)", fontWeight: 700, lineHeight: 1, color }}>{rank}</span>
          <span style={{ position: "absolute", top: "clamp(26px, 4.6vh, 40px)", left: 11, fontSize: "clamp(13px, 2vh, 18px)", lineHeight: 1, color }}>{suit ? suit.glyph : ""}</span>
          <span style={{ fontSize: "clamp(34px, 6vh, 58px)", color }}>{suit ? suit.glyph : ""}</span>
          <span style={{ position: "absolute", bottom: 6, right: 10, fontSize: "clamp(22px, 3.8vh, 36px)", fontWeight: 700, lineHeight: 1, color, transform: "rotate(180deg)" }}>{rank}</span>
        </div>
        {/* back: deep-space blue, star specks, gold inner frame, "M" orb */}
        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)", borderRadius: 12, background: "radial-gradient(130% 120% at 30% 20%, #1c2740, #0d1322 70%)", boxShadow: "0 10px 26px rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <span style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 22% 28%, rgba(255,255,255,.8) 1px, transparent 1.6px), radial-gradient(circle at 68% 16%, rgba(240,217,154,.7) 1px, transparent 1.6px), radial-gradient(circle at 80% 70%, rgba(255,255,255,.6) 1px, transparent 1.6px), radial-gradient(circle at 36% 78%, rgba(140,190,255,.6) 1px, transparent 1.6px), radial-gradient(circle at 55% 48%, rgba(255,255,255,.5) 1px, transparent 1.6px)" }} />
          <span style={{ position: "absolute", inset: 8, borderRadius: 8, border: "1px solid rgba(217,178,106,.5)" }} />
          <span style={{ width: "46%", aspectRatio: "1", borderRadius: "50%", background: "radial-gradient(circle at 36% 32%, #f6e3ac, #d9b26a 55%, #97742f)", boxShadow: "0 0 22px rgba(240,217,154,.5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "clamp(15px, 2.4vh, 22px)", fontWeight: 700, color: "#1a1408" }}>M</span>
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
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,6,10,.72)", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, padding: "38px 42px", borderRadius: 24, border: `2px solid ${T.ctlBorder}`, background: "linear-gradient(180deg,#111826,#0a0d14)", boxShadow: "0 34px 90px rgba(0,0,0,.65)" }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>HOW TO PLAY</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 15, margin: "26px 0 30px", fontSize: 17, lineHeight: 1.5, color: "#b7c0d1" }}>
          {row("◆", T.gold, "Stake PLAYER, BANKER or TIE — the hand closest to 9 wins. Tens and faces count 0, aces 1; totals wrap past 9.")}
          {row("♠", T.win, "Cards deal themselves: third cards follow the fixed tableau, decided by the server — no choices to make.")}
          {row("✦", T.gold, "PLAYER pays 1:1. BANKER pays 0.95:1 (the 5% commission). TIE pays 8:1.")}
          {row("↺", T.text2, "On a tie, PLAYER and BANKER stakes push — the chips come straight back.")}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}

export default function BaccaratSpace() {
  // the backoffice owns this; the screen used to hardcode it
  const MAX_BET = useMaxBet("baccarat");
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  // phase: idle (betting) → clearing (old coup sweeps off) → dealing → over
  const [phase, setPhase] = useState("idle");
  const [chipVal, setChipVal] = useState(50);              // per-tap CHIP step
  const [bets, setBets] = useState({ player: 0, tie: 0, banker: 0 });
  const [pCards, setPCards] = useState([]);                // player zone cards
  const [bCards, setBCards] = useState([]);                // banker zone cards
  // settled coup: { winner, pv, bv, payout, net, res: {spot: win|push|lose} }
  const [outcome, setOutcome] = useState(null);
  const [lastWin, setLastWin] = useState(null);            // net of last coup
  const [pops, setPops] = useState([]);                    // chip pops per pad
  const [shake, setShake] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const timers = useRef([]);
  const busyRef = useRef(false);
  const readRef = useRef(null);
  const popId = useRef(0);
  const pRef = useRef(pCards); pRef.current = pCards;
  const bRef = useRef(bCards); bRef.current = bCards;

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };

  // ── SUSPENSE: the credits freeze from DEAL until both hands (thirds and
  // all) are face-up and the winner is called. Error paths and unmount
  // always hand the hold back.
  const holdsRef = useRef(0);
  const takeHold = () => { holdsRef.current++; holdBalance(); };
  const dropHold = () => { if (holdsRef.current > 0) { holdsRef.current--; releaseBalance(); } };
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    while (holdsRef.current > 0) { holdsRef.current--; releaseBalance(); }
  }, []);

  useEffect(() => { armAmbientOnGesture(); startAmbient(); }, []);

  const setBusyBoth = (v) => { busyRef.current = v; setBusy(v); };
  const showError = (m) => { setError(m || "SOMETHING WENT WRONG"); later(() => setError(""), 2600); };

  const popRead = () => {
    const el = readRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = "scale(1.22)";
    requestAnimationFrame(() => { el.style.transition = "transform .34s cubic-bezier(.2,1.5,.4,1)"; el.style.transform = "scale(1)"; });
  };

  const total = bets.player + bets.tie + bets.banker;
  const locked = busy || phase === "clearing" || phase === "dealing";

  // ── betting: a tap drops the current CHIP on that pad ─────────────────────
  function addChip(key) {
    if (locked) return;
    if (phase === "over") { setPhase("idle"); setOutcome(null); } // pads wake up, cards stay
    const cap = Math.min(MAX_BET, Math.floor(balance));
    if (total + chipVal > cap) {
      bcSfx.click();
      showError(cap >= MAX_BET ? "MAX BET REACHED" : "INSUFFICIENT CREDITS");
      return;
    }
    setBets((b) => ({ ...b, [key]: b[key] + chipVal }));
    const id = ++popId.current;
    setPops((ps) => ps.concat({ id, key, amt: chipVal }));
    later(() => setPops((ps) => ps.filter((p) => p.id !== id)), 780);
    bcSfx.chip();
    popRead();
  }

  function clearBets() {
    if (locked || total <= 0) return;
    setBets({ player: 0, tie: 0, banker: 0 });
    if (phase === "over") { setPhase("idle"); setOutcome(null); }
    bcSfx.click();
  }

  // ── the coup: one POST, then the blackjack deal choreography ──────────────
  // Base four fly in 400ms apart (P B P B); third cards arrive with a beat of
  // delay when the tableau drew them, player's first.
  function beginChoreo(data) {
    setPhase("dealing");
    setOutcome(null);
    setLastWin(null);
    setPCards([]);
    setBCards([]);
    const p = data.playerCards, b = data.bankerCards;
    const give = (setC, card) => setC((prev) => prev.concat({ index: card.index, anim: "deal" }));
    const slot = (setC, card, at) => later(() => { bcSfx.deal(); later(bcSfx.flip, 380); give(setC, card); }, at);
    slot(setPCards, p[0], 60);
    slot(setBCards, b[0], 460);
    slot(setPCards, p[1], 860);
    slot(setBCards, b[1], 1260);
    // thirds: a beat after the base four settle
    let at = 2150, lastAt = 1260;
    if (p[2]) { slot(setPCards, p[2], at); lastAt = at; at += 800; }
    if (b[2]) { slot(setBCards, b[2], at); lastAt = at; }
    later(() => settle(data), lastAt + 1100);
  }

  function settle(data) {
    const staked = Number(data.totalStaked) || 0;
    const payout = Number(data.payout) || 0;
    const net = Math.round((payout - staked) * 100) / 100;
    // per-spot result from the server's bets array: win beats the stake,
    // push returns it (tie), zero loses. Spots without a stake stay neutral.
    const res = {};
    for (const r of data.bets || []) res[r.type] = r.win > r.stake ? "win" : r.win > 0 ? "push" : "lose";
    setOutcome({ winner: data.winner, pv: data.playerValue, bv: data.bankerValue, payout, net, res });
    setLastWin(net);
    setPhase("over");
    setBusyBoth(false);
    const tieHit = data.winner === "tie" && res.tie === "win";
    if (tieHit) {
      bcSfx.huge(); // 8:1 — the jackpot-ish chord + gold wash + table shake
      setFlashOn(true);
      setShake(true);
      later(() => { setFlashOn(false); setShake(false); }, 900);
    } else if (net > 0) bcSfx.win();
    else if (net === 0 && payout > 0) bcSfx.click(); // full push
    // a losing coup makes no sound at all
    dropHold(); // both hands are up and the winner is called — credits may move
  }

  async function deal() {
    if (busyRef.current || locked || total <= 0) return;
    if (total > Math.floor(balance)) { showError("INSUFFICIENT CREDITS"); return; }
    setBusyBoth(true);
    setError("");
    // exact server shape: bets ARRAY of { type: player|banker|tie, stake }
    const payload = SPOTS.filter((s) => bets[s.key] > 0).map((s) => ({ type: s.key, stake: bets[s.key] }));
    const hadCards = pRef.current.length > 0 || bRef.current.length > 0;
    const t0 = performance.now();
    if (hadCards) {
      // sweep the old coup off first (blackjack's clear-out, 60ms stagger)
      setPhase("clearing");
      setOutcome(null);
      setLastWin(null);
      bcSfx.flip();
    }
    bcSfx.bet();
    takeHold(); // the coup resolves on this response — freeze the credits
    const { ok, data } = await apiPost("/api/games/baccarat/start", { bets: payload });
    if (!ok) {
      dropHold();
      setBusyBoth(false);
      setPCards([]);
      setBCards([]);
      setPhase("idle");
      showError(data && data.error);
      return;
    }
    const wait = hadCards ? Math.max(0, 480 - (performance.now() - t0)) : 0;
    later(() => beginChoreo(data), wait);
  }

  // ── derived render values ─────────────────────────────────────────────────
  const clearing = phase === "clearing";
  const over = phase === "over" && outcome;
  const winner = over ? outcome.winner : null;

  // score orbs: visible-card totals mid-choreography, server values settled
  const pShow = pCards.length > 0;
  const bShow = bCards.length > 0;
  const pv = over ? outcome.pv : totalOf(pCards);
  const bv = over ? outcome.bv : totalOf(bCards);

  const orbStyle = (side) => {
    const isWin = winner === side;
    const isTie = winner === "tie";
    return {
      width: "clamp(44px, 7vh, 64px)", height: "clamp(44px, 7vh, 64px)", borderRadius: "50%",
      display: "flex", alignItems: "center", justifyContent: "center", flex: "none",
      border: `2px solid ${isWin ? T.win : isTie ? T.accent : T.goldDeep}`,
      background: "radial-gradient(circle at 42% 32%, #18202f, #0a0e16 78%)",
      fontSize: "clamp(20px, 3.4vh, 30px)", fontWeight: 700,
      color: isWin ? T.win : isTie ? T.gold : T.gold,
      boxShadow: isWin ? "0 0 26px rgba(58,224,161,.45)" : "inset 0 2px 0 rgba(255,255,255,.05)",
      animation: isWin ? "bcOrbWin 1s ease 2" : isTie ? "bcOrbTie 1.1s ease 2" : "none",
      transition: "border-color .3s ease, color .3s ease",
    };
  };

  const cardRow = {
    display: "flex", gap: "clamp(8px, 1vw, 14px)", height: `calc(${CARD_W} * 1.5)`,
    minWidth: `calc(${CARD_W} * 3 + clamp(8px, 1vw, 14px) * 2)`,
    alignItems: "center", justifyContent: "center", flex: "none",
  };

  // readout line — errors take it over in red; otherwise it tracks the coup
  let readText = "", readColor = T.muted, readGlow = "rgba(0,0,0,0)", readOpacity = 1, readSize = 26;
  if (error) { readText = String(error).toUpperCase(); readColor = "#ff6a5a"; readGlow = "rgba(255,90,74,.55)"; }
  else if (clearing || phase === "dealing") { readText = "DEALING…"; readColor = T.text2; }
  else if (over) {
    readSize = 34;
    if (outcome.net > 0) { readText = "WIN +" + fmtMKD(outcome.net); readColor = winner === "tie" ? T.gold : T.win; readGlow = winner === "tie" ? "rgba(240,217,154,.55)" : "rgba(46,230,166,.5)"; }
    else if (outcome.net === 0 && outcome.payout > 0) { readText = "PUSH"; readColor = T.text2; }
    // a losing coup still names the winner — in neutral grey, unglowing
    else { readText = winner === "tie" ? "TIE" : (winner === "player" ? "PLAYER WINS" : "BANKER WINS"); readColor = T.text2; }
  }
  else if (total > 0) { readText = "TOTAL " + fmtMKD(total); readColor = T.gold; readGlow = "rgba(240,217,154,.4)"; }
  else { readText = "PLACE YOUR BETS"; readOpacity = 0.8; }

  // header status chip: last win (net), blackjack-style
  const chip = lastWin != null
    ? { label: (lastWin >= 0 ? "+" + fmtMKD(lastWin) : "−" + fmtMKD(-lastWin)), color: lastWin > 0 ? T.win : T.text2 }
    : { label: "READY", color: T.text2 };

  const canDeal = !locked && total > 0 && total <= Math.floor(balance);

  const payRow = (k, v) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "clamp(13px, 2vh, 16px)", fontWeight: 700 }}>
      <span style={{ color: T.text2 }}>{k}</span><span style={{ color: T.gold }}>{v}</span>
    </div>
  );

  return (
    <SpaceRoot>

      {/* tie jackpot flash (gold wash from the table edge) */}
      <div style={{ position: "absolute", inset: 0, zIndex: 8, pointerEvents: "none", background: "radial-gradient(115% 90% at 50% 105%, rgba(240,217,154,.16), rgba(240,217,154,0) 55%)", opacity: flashOn ? 1 : 0, transition: "opacity .5s ease" }} />

      <SpaceHeader title="BACCARAT" chip={chip} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>

        {/* ── left control panel ── */}
        <SpaceSidebar>
          <SoundButton />
          {/* shared stepper drives the per-tap CHIP (relabeled in baccarat.css) */}
          <div className="bc-chip-stepper">
            <BetStepper bet={chipVal} setBet={setChipVal} disabled={locked} maxBet={MAX_BET} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "clamp(8px, 1.6vh, 14px)", borderRadius: 16, border: `2px solid ${T.panelBorder}`, background: "rgba(255,255,255,.02)" }}>
            <div style={{ fontSize: 12, letterSpacing: 3, color: T.muted }}>PAYS</div>
            {payRow("PLAYER", "1 : 1")}
            {payRow("BANKER", "0.95 : 1")}
            {payRow("TIE", "8 : 1")}
            {payRow("TIE → SIDES", "PUSH")}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => { bcSfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={tileStyle({ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, minHeight: "clamp(46px, 8vh, 64px)", fontSize: "clamp(14px, 2vh, 17px)", letterSpacing: 3 })}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>LOBBY
            </button>
            <button onClick={() => { bcSfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={tileStyle({ flex: "none", width: "clamp(46px, 8vh, 64px)", minHeight: "clamp(46px, 8vh, 64px)", color: T.text2, display: "flex", alignItems: "center", justifyContent: "center" })}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" /></svg>
            </button>
          </div>
        </SpaceSidebar>

        {/* ── table column ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* readout */}
          <div style={{ position: "relative", zIndex: 4, height: 46, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div ref={readRef} style={{ opacity: readOpacity, transform: "scale(1)", fontSize: readSize, fontWeight: 700, letterSpacing: 3, color: readColor, textShadow: `0 0 28px ${readGlow}`, transition: "opacity .25s ease", whiteSpace: "nowrap" }}>{readText}</div>
          </div>

          {/* the two hand zones with the TIE marker between them */}
          <div style={{ position: "relative", flex: 1, minHeight: 120, margin: "4px 24px 6px 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(14px, 2.4vw, 44px)", overflow: "hidden", animation: shake ? "bcShake .55s ease" : "none" }}>

            {/* PLAYER zone */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "clamp(6px, 1.4vh, 14px)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, height: "clamp(48px, 7.4vh, 68px)", flex: "none" }}>
                <span style={{ fontSize: "clamp(13px, 2vh, 17px)", letterSpacing: 4, fontWeight: 700, color: winner === "player" ? T.win : "#8cbeff" }}>PLAYER</span>
                <div style={orbStyle("player")}>{pShow ? pv : "–"}</div>
              </div>
              <div style={cardRow}>
                {pCards.map((c, i) => <CardCell key={i} c={c} i={i} clearing={clearing} />)}
              </div>
            </div>

            {/* TIE marker */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: "none" }}>
              <div style={{ width: "clamp(52px, 8vh, 74px)", height: "clamp(52px, 8vh, 74px)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: winner === "tie" ? `2px solid ${T.gold}` : "2px dashed #3a4557", background: winner === "tie" ? "rgba(217,178,106,.16)" : "rgba(10,14,22,.6)", color: winner === "tie" ? T.gold : T.muted, fontSize: "clamp(12px, 1.9vh, 16px)", fontWeight: 700, letterSpacing: 3, animation: winner === "tie" ? "bcOrbTie 1.1s ease 3" : "none", transition: "all .3s ease" }}>TIE</div>
            </div>

            {/* BANKER zone */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "clamp(6px, 1.4vh, 14px)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, height: "clamp(48px, 7.4vh, 68px)", flex: "none" }}>
                <div style={orbStyle("banker")}>{bShow ? bv : "–"}</div>
                <span style={{ fontSize: "clamp(13px, 2vh, 17px)", letterSpacing: 4, fontWeight: 700, color: winner === "banker" ? T.win : "#ff9a8a" }}>BANKER</span>
              </div>
              <div style={cardRow}>
                {bCards.map((c, i) => <CardCell key={i} c={c} i={i} clearing={clearing} />)}
              </div>
            </div>
          </div>

          {/* ── bet pads + CLEAR + DEAL ── */}
          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", gap: "clamp(8px, 1vw, 14px)", margin: "0 clamp(10px, 1.6vw, 24px) 20px 14px" }}>
            <button onClick={clearBets} className="sp-hover-gold"
              style={tileStyle({ flex: "none", width: "clamp(74px, 8vw, 130px)", minHeight: "clamp(72px, 12vh, 110px)", borderRadius: 20, background: T.panelBg, fontSize: "clamp(13px, 1.2vw, 18px)", letterSpacing: 3, color: total > 0 && !locked ? T.text : T.disabled, opacity: total > 0 && !locked ? 1 : 0.55, transition: "all .2s ease" })}>
              CLEAR
            </button>

            {SPOTS.map((s) => {
              const amt = bets[s.key];
              const res = over ? outcome.res[s.key] : undefined;
              const won = res === "win";
              const dim = res === "lose";
              return (
                <button key={s.key} onClick={() => addChip(s.key)} className={locked ? undefined : "sp-hover-gold"}
                  style={{
                    position: "relative", flex: 1, minWidth: 0, minHeight: "clamp(72px, 12vh, 110px)",
                    borderRadius: 20, cursor: locked ? "default" : "pointer",
                    border: `2px solid ${won ? T.gold : amt > 0 ? s.edge : T.ctlBorder}`,
                    // was backdrop-filter: blur(8px). The scene behind these
                    // spots now animates, so that re-blurred every frame; a dark
                    // base under the tint gives the same read for free.
                    background: `linear-gradient(180deg, ${s.tint}, rgba(11,16,26,.94)), rgba(11,16,26,.6)`,
                    boxShadow: won ? "0 0 34px rgba(240,217,154,.45)" : amt > 0 ? `0 0 24px ${s.glow}` : "none",
                    opacity: dim ? 0.45 : locked && !over ? 0.75 : 1,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(2px, .6vh, 6px)",
                    fontFamily: "'DM Sans', Helvetica, sans-serif", transition: "all .25s ease", overflow: "visible",
                  }}>
                  {/* winner: expanding gold ring pulses */}
                  {won && [0, 0.5, 1].map((d) => (
                    <span key={d} style={{ position: "absolute", inset: -4, borderRadius: 24, border: "3px solid #f0d99a", pointerEvents: "none", animation: `bcWinRing 1.6s ease-out ${d}s infinite` }} />
                  ))}
                  <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontSize: "clamp(15px, 1.4vw, 22px)", fontWeight: 700, letterSpacing: 4, color: won ? T.gold : s.hue }}>{s.label}</span>
                    <span style={{ fontSize: "clamp(11px, 1vw, 15px)", fontWeight: 700, letterSpacing: 1, color: T.muted }}>{s.pays}</span>
                  </span>
                  <span style={{ fontSize: "clamp(17px, 1.7vw, 27px)", fontWeight: 700, letterSpacing: 1, color: amt > 0 ? T.gold : T.disabled }}>
                    {amt > 0 ? fmtMKD(amt) : "—"}
                  </span>
                  {res === "push" && <span style={{ position: "absolute", top: 6, right: 12, fontSize: "clamp(10px, .9vw, 13px)", fontWeight: 700, letterSpacing: 2, color: T.text2 }}>PUSH</span>}
                  {/* gold chip pops */}
                  {pops.filter((p) => p.key === s.key).map((p) => (
                    <span key={p.id} style={{ position: "absolute", left: "50%", top: "26%", width: 44, height: 44, borderRadius: "50%", pointerEvents: "none", background: "radial-gradient(circle at 36% 32%, #f6e3ac, #d9b26a 55%, #97742f)", border: "2px dashed rgba(26,20,8,.5)", boxShadow: "0 0 18px rgba(240,217,154,.55)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#1a1408", animation: "bcChipPop .72s ease-out both" }}>+{p.amt}</span>
                  ))}
                </button>
              );
            })}

            <GoldButton label="DEAL" sub={total > 0 ? fmtMKD(total) : "PLACE A BET"} onClick={deal} disabled={!canDeal}
              labelSize="clamp(21px, 2.1vw, 32px)"
              style={{ flex: "none", minWidth: "clamp(180px, 18vw, 300px)", alignSelf: "stretch", minHeight: 0, borderRadius: 22 }} />
          </div>

        </div>
      </div>

      {rules && <RulesModal onClose={() => setRules(false)} />}
    </SpaceRoot>
  );
}
