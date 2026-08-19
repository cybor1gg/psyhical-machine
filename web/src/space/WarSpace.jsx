// CARD WAR — space-theme cabinet screen. Two big card slots face off
// center-screen (YOURS left, HOUSE right) across a gold lightning VS orb.
// Card rendering and choreography replicate the blackjack screen exactly —
// same faces/backs, back-first flight + delayed 3D flip (bjFlipIn), clear-out
// sweep (bjClearOut) and win shake (bjShake) come straight from blackjack.css;
// only the flight direction is war's own (wrDealInL/R — the slots face off
// from the screen edges). Every card, outcome, streak and payout is SERVER-
// authoritative (api/routes/war.js: start / war / surrender / active):
//   · start deals one card each; higher rank wins 1:1, Ace high.
//   · a TIE opens the WAR? decision — GO TO WAR raises the original bet and
//     deals one more card each (player wins war ties), or SURRENDER for half.
//   · side bets ride the first deal: TIE pays 10:1, COLOUR TIE 20:1, both
//     climbing a consecutive-tie ladder (30/60/300 and 125/400/1000); four
//     ties in a row pay a 10:1 bonus on the main bet (result "bonus").
// The consecutive-tie streak lives on the server (warTieStreak) and arrives
// in every response. Balance comes from useBalance only (the api layer syncs
// the store from every balance-carrying response; a lost war carries none, so
// we refresh via /api/me).
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar, SectionLabel,
  GoldButton, SoundButton, BetStepper, tileStyle, T,
} from "./Shell";
import { beep, whoosh, boomNoise, sfx, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import { useMaxBet } from "./limits";
import "./space.css";
import "./blackjack.css"; // bjFlipIn / bjClearOut / bjShake keyframes
import "./war.css";

const CARD_W = "clamp(96px, 23vh, 200px)"; // duel cards run bigger than blackjack's

// Server card model shared with blackjack/hilo: index 0..51, rank = index %
// 13 (0=Two…12=Ace — ace high for war by construction), suit = floor(i/13).
const RANK_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = [
  { glyph: "♣", color: "#232c42" },
  { glyph: "♦", color: "#d64545" },
  { glyph: "♥", color: "#d64545" },
  { glyph: "♠", color: "#232c42" },
];

// War sfx kinds on the shared audio engine. Deal/flip are blackjack's
// recipes (the choreography should SOUND identical); the rest is war's own.
const wrSfx = {
  deal: () => { whoosh(1400, 3600, 0.09, 0.14); beep("triangle", 640, 480, 0.06, 0.08, 0.03); },
  flip: () => { whoosh(900, 2600, 0.1, 0.18); beep("sine", 880, 1100, 0.07, 0.12, 0.04); },
  // war cards land with weight: the deal whoosh over a low boom
  warDeal: () => { boomNoise(0.3, 0.35, 1100, 180); whoosh(1400, 3600, 0.09, 0.14); beep("triangle", 480, 360, 0.07, 0.1, 0.03); },
  click: sfx.click,
  win: sfx.win, // rising 4-note win chord
  // war won: the chord over a boom, plus a top sparkle — the "bigger burst"
  bigWin: () => { boomNoise(0.4, 0.5, 1400, 220); sfx.win(); beep("sine", 1568, 0, 0.1, 0.3, 0.32); beep("sine", 2093, 0, 0.08, 0.34, 0.4); },
  // NOTE: a lost duel makes NO sound — the cabinet only celebrates wins.
  // tie sting: two low war drums + a rising tension sweep
  tie: () => {
    boomNoise(0.32, 0.4, 900, 160);
    beep("sine", 130, 60, 0.2, 0.4);
    boomNoise(0.26, 0.35, 800, 150);
    beep("sine", 110, 55, 0.16, 0.35, 0.22);
    whoosh(220, 1100, 0.07, 0.55, 0.1);
  },
  surrender: () => { beep("sine", 660, 440, 0.08, 0.25); beep("sine", 440, 330, 0.07, 0.3, 0.14); },
  // 4-tie bonus fanfare (blackjack's jackpot recipe)
  bonus: () => {
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

const mkCard = (apiCard, anim = "deal") => ({ index: apiCard.index, faceDown: false, anim });

// Gold lightning bolt (the VS glyph and the empty-slot watermark).
function Bolt({ style }) {
  return (
    <svg viewBox="0 0 24 24" style={style}>
      <defs>
        <linearGradient id="wrBoltG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6e3ac" /><stop offset=".55" stopColor="#d9b26a" /><stop offset="1" stopColor="#a9843e" />
        </linearGradient>
      </defs>
      <path d="M13.4 1.6 4.8 13.3h4.7L8.2 22.4 19.2 9.7h-5.3l-.5-8.1Z" fill="url(#wrBoltG)" />
    </svg>
  );
}

// One playing card — face/back markup replicated from the blackjack screen
// (corner ranks, centre pip, space back with the gold "M" orb), font clamps
// re-tuned for war's larger card. fx: null | 'winner' | 'quiet' | 'tie' |
// 'loser' | 'faded'. `second` is the war card: it lands overlapping the
// first, tilted toward the centre line.
function WarCard({ c, dir, second, clearing, fx, burst }) {
  const suit = c.index != null ? SUITS[Math.floor(c.index / 13)] : null;
  const rank = c.index != null ? RANK_LABELS[c.index % 13] : "";
  const color = suit ? suit.color : "#232c42";
  let dealAnim = "none", flipAnim = "none";
  if (clearing) {
    dealAnim = `bjClearOut .45s ease ${second ? "0.06s" : "0s"} both`;
  } else if (c.anim === "deal") {
    dealAnim = `${dir === "L" ? "wrDealInL" : "wrDealInR"} .55s cubic-bezier(.25,.9,.3,1) both`;
    if (!c.faceDown) flipAnim = "bjFlipIn .65s cubic-bezier(.3,.9,.3,1) .34s both";
  }
  const cls = "wr-card" + (fx === "loser" ? " wr-dim" : fx === "faded" ? " wr-faded" : "");
  return (
    // static offset/tilt lives on this wrapper — the fly-in animates the
    // inner div's transform, so the two must not share an element
    <div style={{ position: "relative", zIndex: second ? 2 : 1, ...(second ? { marginLeft: `calc(${CARD_W} * -0.34)`, transform: `rotate(${dir === "L" ? 7 : -7}deg) translateY(-6px)` } : {}) }}>
      <div className={cls} style={{ position: "relative", width: CARD_W, aspectRatio: "5 / 7", perspective: 900, animation: dealAnim }}>
        <div style={{ position: "relative", width: "100%", height: "100%", transformStyle: "preserve-3d", transform: `rotateY(${c.faceDown ? "180deg" : "0deg"})`, transition: "transform .65s cubic-bezier(.3,.9,.3,1)", animation: flipAnim }}>
          {/* face */}
          <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", borderRadius: 12, background: "linear-gradient(160deg, #fdfdf8, #eef0ee 60%, #dde2e2)", boxShadow: "0 10px 26px rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ position: "absolute", top: 8, left: 13, fontSize: "clamp(30px, 5.4vh, 52px)", fontWeight: 700, lineHeight: 1, color }}>{rank}</span>
            <span style={{ position: "absolute", top: "clamp(38px, 6.6vh, 60px)", left: 14, fontSize: "clamp(17px, 2.8vh, 26px)", lineHeight: 1, color }}>{suit ? suit.glyph : ""}</span>
            <span style={{ fontSize: "clamp(46px, 8.6vh, 88px)", color }}>{suit ? suit.glyph : ""}</span>
            <span style={{ position: "absolute", bottom: 8, right: 13, fontSize: "clamp(30px, 5.4vh, 52px)", fontWeight: 700, lineHeight: 1, color, transform: "rotate(180deg)" }}>{rank}</span>
          </div>
          {/* back: deep-space blue, star specks, gold inner frame, "M" orb */}
          <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)", borderRadius: 12, background: "radial-gradient(130% 120% at 30% 20%, #1c2740, #0d1322 70%)", boxShadow: "0 10px 26px rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <span style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 22% 28%, rgba(255,255,255,.8) 1px, transparent 1.6px), radial-gradient(circle at 68% 16%, rgba(240,217,154,.7) 1px, transparent 1.6px), radial-gradient(circle at 80% 70%, rgba(255,255,255,.6) 1px, transparent 1.6px), radial-gradient(circle at 36% 78%, rgba(140,190,255,.6) 1px, transparent 1.6px), radial-gradient(circle at 55% 48%, rgba(255,255,255,.5) 1px, transparent 1.6px)" }} />
            <span style={{ position: "absolute", inset: 8, borderRadius: 8, border: "1px solid rgba(217,178,106,.5)" }} />
            <span style={{ width: "46%", aspectRatio: "1", borderRadius: "50%", background: "radial-gradient(circle at 36% 32%, #f6e3ac, #d9b26a 55%, #97742f)", boxShadow: "0 0 22px rgba(240,217,154,.5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "clamp(20px, 3.4vh, 32px)", fontWeight: 700, color: "#1a1408" }}>M</span>
          </div>
        </div>
        {fx === "winner" && <span className="wr-ring" />}
        {fx === "quiet" && <span className="wr-ring wr-quiet" />}
        {fx === "tie" && <span className="wr-tie" />}
        {burst && <Burst big={burst === "big"} />}
      </div>
    </div>
  );
}

// Win burst (mines idiom): expanding gold ring + radial sparks, centered on
// the deciding card. Deterministic spark angles — no jitter across renders.
function Burst({ big }) {
  const n = big ? 14 : 10;
  const size = big ? 240 : 160;
  return (
    <div style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, zIndex: 7, pointerEvents: "none" }}>
      <span style={{ position: "absolute", left: 0, top: 0, width: size, height: size, borderRadius: "50%", border: "3px solid #f0d99a", animation: "wrBurstRing .7s ease-out both" }} />
      {Array.from({ length: n }, (_, k) => (
        <span key={k} style={{ position: "absolute", left: 0, top: 0, transform: `rotate(${Math.round(k * 360 / n + (k * 37) % 24)}deg) scale(${(0.75 + ((k * 29) % 40) / 100).toFixed(2)})` }}>
          <span style={{ position: "absolute", left: 0, top: -2, width: 17, height: 4, borderRadius: 2, background: "#f0d99a", animation: "wrBurstSpark .6s ease-out both" }} />
        </span>
      ))}
    </div>
  );
}

// The VS divider: gold lightning orb + letterspaced VS, running hot (red-gold
// strobe + swell) while the WAR? decision is open and during the war deal.
function VsBadge({ hot }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, flex: "none" }}>
      <div className={"wr-vs" + (hot ? " wr-vs-hot" : "")} style={{ width: "clamp(64px, 12vh, 104px)", aspectRatio: "1", borderRadius: "50%", border: "3px solid #d9b26a", background: "radial-gradient(circle at 38% 30%, #1a2334, #0a0e18 75%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Bolt style={{ width: "56%", height: "56%", filter: "drop-shadow(0 2px 6px rgba(0,0,0,.5))" }} />
      </div>
      <div style={{ fontSize: "clamp(15px, 2.4vh, 22px)", fontWeight: 700, letterSpacing: 7, color: hot ? "#ff7a6a" : T.muted, transition: "color .3s ease" }}>VS</div>
    </div>
  );
}

// Side-bet stepper (sidebar): 0 = OFF, then МКД steps of 50 up to the max.
function SideBetRow({ label, pays, value, setValue, disabled }) {
  const step = (d) => { wrSfx.click(); setValue(Math.max(0, Math.min(MAX_BET, value + d * 50))); };
  const sq = { flex: "none", width: "clamp(38px, 6.5vh, 56px)", minHeight: "clamp(38px, 6.5vh, 56px)", fontSize: "clamp(20px, 3.4vh, 30px)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? "none" : "auto", transition: "opacity .2s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 13, letterSpacing: 3, color: T.muted }}>{label}</span>
        <span style={{ fontSize: 13, letterSpacing: 2, fontWeight: 700, color: T.accent }}>{pays}</span>
      </div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
        <button onClick={() => step(-1)} className="sp-hover-gold" style={tileStyle(sq)}>−</button>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "clamp(38px, 6.5vh, 56px)", border: `2px solid ${T.ctlBorder}`, borderRadius: 16, background: "rgba(255,255,255,.03)", fontSize: "clamp(14px, 2.4vh, 20px)", fontWeight: 700, color: value > 0 ? T.gold : T.muted, whiteSpace: "nowrap" }}>
          {value > 0 ? fmtMKD(value) : "OFF"}
        </div>
        <button onClick={() => step(1)} className="sp-hover-gold" style={tileStyle(sq)}>+</button>
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
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, padding: "38px 42px", borderRadius: 24, border: `2px solid ${T.ctlBorder}`, background: "linear-gradient(180deg,#111826,#0a0d14)", boxShadow: "0 34px 90px rgba(0,0,0,.65)" }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>HOW TO PLAY</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 15, margin: "26px 0 30px", fontSize: 17, lineHeight: 1.5, color: "#b7c0d1" }}>
          {row("⚡", T.gold, "One card each — highest card wins, Ace high. A win pays 1:1.")}
          {/* the ⚔ carries the WAR theme's hot red — a tie is not a loss */}
          {row("⚔", "#ff7a6a", "Tie? GO TO WAR: match your bet for one more card each. Win the war and the raise pays 1:1 (your original pushes). A tie in war goes to you.")}
          {row("⚑", T.text2, "Or SURRENDER the tie and take half your bet back.")}
          {row("◆", T.gold, "TIE side bet pays 10:1, COLOUR TIE (same colour) 20:1 — climbing to 300:1 and 1000:1 on consecutive ties.")}
          {row("✦", T.gold, "Four ties in a row pay a 10:1 BONUS on your main bet.")}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}

export default function WarSpace() {
  // the backoffice owns this; the screen used to hardcode it
  const MAX_BET = useMaxBet("war");
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  // phase: idle → (clearing) → dealing → over, or dealing → war (tie
  // decision) → warDeal → over; "war" is the only phase the server persists.
  const [phase, setPhase] = useState("idle");
  const [bet, setBet] = useState(100);
  const [tieBet, setTieBet] = useState(0);
  const [ctieBet, setCtieBet] = useState(0);
  const [pCards, setPCards] = useState([]); // [{ index, faceDown, anim }]
  const [dCards, setDCards] = useState([]);
  const [warInfo, setWarInfo] = useState(null); // { warCost, surrenderReturns }
  const [streak, setStreak] = useState(0);      // server warTieStreak
  const [result, setResult] = useState(null);   // win|lose|war-win|war-lose|surrender|bonus
  const [lastNet, setLastNet] = useState(null); // payout − totalStaked of the settled round
  const [payout, setPayout] = useState(0);
  const [tieWin, setTieWin] = useState(0);
  const [ctieWin, setCtieWin] = useState(0);
  const [burstOn, setBurstOn] = useState(null); // null | 'small' | 'big'
  const [shake, setShake] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const timers = useRef([]);
  const busyRef = useRef(false);
  const pRef = useRef(pCards); pRef.current = pCards;
  const dRef = useRef(dCards); dRef.current = dCards;

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // ── SUSPENSE: the credits stay frozen from the request until the cards
  // have flipped and the verdict is on screen. Every early return gives the
  // hold back, and unmounting mid-flight releases whatever is outstanding.
  const holdsRef = useRef(0);
  const takeHold = () => { holdsRef.current++; holdBalance(); };
  const dropHold = () => { if (holdsRef.current > 0) { holdsRef.current--; releaseBalance(); } };
  useEffect(() => () => {
    clearTimers();
    while (holdsRef.current > 0) { holdsRef.current--; releaseBalance(); }
  }, []);

  const setBusyBoth = (v) => { busyRef.current = v; setBusy(v); };
  const showError = (m) => { setError(m || "SOMETHING WENT WRONG"); later(() => setError(""), 2600); };

  // ── resume: only a pending tie decision persists on the server ────────────
  async function resumeActive() {
    const { ok, data } = await apiGet("/api/games/war/active");
    if (!ok || !data.active) return false;
    clearTimers();
    setBet(Math.max(50, Math.min(MAX_BET, Math.round((Number(data.betAmount) || 50) / 50) * 50)));
    setTieBet(Math.max(0, Math.min(MAX_BET, Math.round(Number(data.tieBet) || 0))));
    setCtieBet(Math.max(0, Math.min(MAX_BET, Math.round(Number(data.ctieBet) || 0))));
    setPCards([{ index: data.playerCards[0].index, faceDown: false, anim: "none" }]);
    setDCards([{ index: data.dealerCards[0].index, faceDown: false, anim: "none" }]);
    setWarInfo({ warCost: data.warCost, surrenderReturns: data.surrenderReturns });
    setStreak(data.streak || 0);
    setTieWin(data.tieWin || 0);
    setCtieWin(data.ctieWin || 0);
    setResult(null);
    setLastNet(null);
    setBurstOn(null);
    setPhase("war");
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

  // ── settlement fx (both showdowns land here) ──────────────────────────────
  function applyOutcome(data) {
    const net = Math.round(((Number(data.payout) || 0) - (Number(data.totalStaked) || 0)) * 100) / 100;
    setResult(data.result);
    setPayout(Number(data.payout) || 0);
    setLastNet(net);
    setTieWin(data.tieWin || 0);
    setCtieWin(data.ctieWin || 0);
    setStreak(data.streak || 0);
    setPhase("over");
    if (data.result === "bonus") {
      wrSfx.bonus();
      setBurstOn("big");
      setShake(true);
      setFlashOn(true);
      later(() => { setShake(false); setFlashOn(false); }, 900);
    } else if (data.result === "war-win") {
      wrSfx.bigWin(); // heavier chord + boom — the war round hits harder
      setBurstOn("big");
      setShake(true);
      later(() => setShake(false), 700);
    } else if (data.result === "win") {
      wrSfx.win();
      setBurstOn("small");
    } else if (data.result === "surrender") {
      wrSfx.surrender();
    }
    // lose / war-lose: the cards simply dim — no sound, no red, no shake.
    later(() => setBurstOn(null), 1100);
    // A lost war is the one settlement whose response carries no balance
    // (nothing was credited) — refresh the store so credits stay honest. The
    // hold is still up, so that refresh is staged too: release only once it
    // has landed, i.e. strictly after this reveal.
    if (typeof data.balance !== "number") apiGet("/api/me").then(dropHold, dropHold);
    else dropHold();
  }

  // ── DEAL: sweep old cards, POST start, choreograph the response ───────────
  const inRound = ["clearing", "dealing", "war", "warDeal"].includes(phase);

  async function deal() {
    if (busyRef.current || inRound) return;
    const wallet = Math.floor(balance);
    if (wallet < 50) return;
    const stake = Math.max(50, Math.min(bet, MAX_BET, wallet));
    if (stake + tieBet + ctieBet > wallet) { showError("INSUFFICIENT CREDITS"); return; }
    setBusyBoth(true);
    setError("");
    const hadCards = pRef.current.length > 0 || dRef.current.length > 0;
    const t0 = performance.now();
    if (hadCards) {
      // sweep the old duel off first (blackjack's clear-out)
      setPhase("clearing");
      setResult(null);
      setLastNet(null);
      setBurstOn(null);
      wrSfx.flip();
    }
    takeHold(); // the duel settles on this response — freeze the credits
    // the server takes main + BOTH side bets in one debit — deduct the whole
    // amount at the press, not just the main bet
    const { ok, status, data } = await apiPost("/api/games/war/start", { betAmount: stake, tieBet, ctieBet }, { stake: stake + tieBet + ctieBet });
    setBusyBoth(false);
    if (!ok) {
      dropHold();
      setPhase("idle");
      setPCards([]);
      setDCards([]);
      if (status === 409 && (await resumeActive())) return; // tie already live → pick it up
      showError(data && data.error);
      return;
    }
    setBet(stake);
    const wait = hadCards ? Math.max(0, 480 - (performance.now() - t0)) : 0;
    later(() => {
      // fresh duel: both cards fly in back-first and flip (YOURS from the
      // left, HOUSE from the right), 460ms apart like the blackjack deal
      setPhase("dealing");
      setResult(null);
      setLastNet(null);
      setTieWin(0);
      setCtieWin(0);
      setBurstOn(null);
      setWarInfo(null);
      setPCards([]);
      setDCards([]);
      later(() => { wrSfx.deal(); later(wrSfx.flip, 400); setPCards([mkCard(data.playerCards[0])]); }, 60);
      later(() => { wrSfx.deal(); later(wrSfx.flip, 400); setDCards([mkCard(data.dealerCards[0])]); }, 520);
      later(() => {
        if (data.stage === "settled") {
          applyOutcome(data); // releases the hold once the verdict is up
        } else {
          // TIE — the streak just grew; open the WAR? decision
          setStreak(data.streak || 0);
          setTieWin(data.tieWin || 0);
          setCtieWin(data.ctieWin || 0);
          setWarInfo({ warCost: data.warCost, surrenderReturns: data.surrenderReturns });
          setPhase("war");
          wrSfx.tie();
          dropHold(); // the tie IS the reveal — credits may move now
        }
      }, 1900);
    }, wait);
  }

  // ── GO TO WAR: raise, second pair flies in with weight ────────────────────
  async function goToWar() {
    if (busyRef.current || phase !== "war") return;
    setBusyBoth(true);
    takeHold(); // the raise settles the war on this response
    // the raise is a second debit equal to the main bet — take it at the press
    const { ok, data } = await apiPost("/api/games/war/war", null, { stake: warInfo ? warInfo.warCost : bet });
    setBusyBoth(false);
    if (!ok) {
      dropHold();
      showError(data && data.error);
      if (!(await resumeActive())) { setPhase("idle"); setPCards([]); setDCards([]); }
      return;
    }
    setWarInfo(null);
    setPhase("warDeal");
    later(() => { wrSfx.warDeal(); later(wrSfx.flip, 400); setPCards((c) => [...c, mkCard(data.playerCards[1])]); }, 80);
    later(() => { wrSfx.warDeal(); later(wrSfx.flip, 400); setDCards((c) => [...c, mkCard(data.dealerCards[1])]); }, 540);
    later(() => applyOutcome(data), 1950);
  }

  // ── SURRENDER: half the bet back, streak breaks ───────────────────────────
  async function surrender() {
    if (busyRef.current || phase !== "war") return;
    wrSfx.click();
    setBusyBoth(true);
    takeHold(); // half the bet comes back — hold until the readout says so
    const { ok, data } = await apiPost("/api/games/war/surrender");
    setBusyBoth(false);
    if (!ok) {
      dropHold();
      showError(data && data.error);
      if (!(await resumeActive())) { setPhase("idle"); setPCards([]); setDCards([]); }
      return;
    }
    setWarInfo(null);
    later(() => applyOutcome(data), 280);
  }

  // ── derived render values ─────────────────────────────────────────────────
  const clearing = phase === "clearing";
  const canDeal = !inRound && !busy && Math.floor(balance) >= 50;
  const totalStake = Math.max(50, Math.min(bet, MAX_BET, Math.max(50, Math.floor(balance) || 50))) + tieBet + ctieBet;
  const won = ["win", "war-win", "bonus"].includes(result);

  // card fx: the DECIDING pair carries the verdict; a tied first pair fades
  // behind the war cards; both cards pulse red-gold while WAR? is open.
  const fxFor = (side, pairIdx, count) => {
    if (phase === "war") return pairIdx === 0 ? "tie" : null;
    if (phase !== "over") return null;
    if (pairIdx < count - 1) return "faded";
    if (result === "bonus") return "winner"; // 4 ties — both cards struck gold
    if (won) return side === "p" ? "winner" : "loser";
    if (result === "surrender") return side === "p" ? "winner" : null;
    // the house taking the pot: a QUIET grey ring, never a red one
    return side === "p" ? "loser" : "quiet";
  };
  const burstFor = (side, pairIdx, count) => {
    if (!burstOn || phase !== "over" || pairIdx !== count - 1) return null;
    if (side === "d" && result !== "bonus") return null;
    return burstOn;
  };

  // side labels re-badge on settle (the old client's idiom)
  const pLabel = phase !== "over" ? "YOURS"
    : result === "surrender" ? "SURRENDER"
    : result === "bonus" ? "4-TIE BONUS" : won ? "WIN" : "LOSE";
  const pLabelColor = phase !== "over" ? T.muted
    : result === "surrender" || result === "bonus" ? T.gold
    : won ? T.win : T.text2; // a lost duel labels in neutral grey

  // centre readout (+ booked side-bet line once a tie lands)
  let readText = "", readColor = T.muted, readGlow = "rgba(0,0,0,0)", readOpacity = 1, readSize = 26, readHot = false;
  if (error) { readText = String(error).toUpperCase(); readColor = T.lose; readGlow = "rgba(255,90,74,.55)"; }
  else if (phase === "idle") { readText = "PRESS DEAL TO START"; readOpacity = 0.8; }
  else if (phase === "clearing" || phase === "dealing") { readText = "DEALING…"; readColor = T.text2; }
  else if (phase === "war") { readText = "WAR?"; readSize = 40; readHot = true; }
  else if (phase === "warDeal") { readText = "WAR!"; readSize = 40; readColor = T.gold; readGlow = "rgba(240,217,154,.55)"; }
  else if (phase === "over") {
    readSize = 34;
    if (result === "bonus") { readText = "4-TIE BONUS +" + fmtMKD(lastNet); readColor = T.gold; readGlow = "rgba(240,217,154,.6)"; }
    else if (won) { readText = lastNet > 0 ? "WIN +" + fmtMKD(lastNet) : "WIN"; readColor = T.win; readGlow = "rgba(46,230,166,.5)"; }
    else if (result === "surrender") { readText = "SURRENDER +" + fmtMKD(payout); readColor = T.gold; readGlow = "rgba(240,217,154,.4)"; }
    else { readText = "HOUSE WINS"; readColor = T.text2; } // readable, unglowing, never red
  }
  const sideLine = (tieWin > 0 || ctieWin > 0) && ["war", "warDeal", "over"].includes(phase)
    ? [tieWin > 0 && "TIE +" + fmtMKD(tieWin), ctieWin > 0 && "COLOUR +" + fmtMKD(ctieWin)].filter(Boolean).join("  ·  ")
    : "";

  // header status chip: live war > last net > standing tie streak > ready
  const chip = (phase === "war" || phase === "warDeal")
    ? { label: "TIE ×" + Math.max(1, streak), color: T.gold }
    : phase === "over" && lastNet != null
      ? { label: (lastNet >= 0 ? "+" + fmtMKD(lastNet) : "−" + fmtMKD(-lastNet)), color: lastNet > 0 ? T.win : T.text2 }
      : streak > 0
        ? { label: "TIE STREAK ×" + streak, color: T.gold }
        : { label: "READY", color: T.text2 };

  // primary button
  let primary;
  const goldStyle = { flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 };
  if (phase === "war") {
    primary = <GoldButton label="GO TO WAR" sub={"+" + fmtMKD(warInfo ? warInfo.warCost : bet)} onClick={goToWar} disabled={busy} labelSize="clamp(20px, 2.1vw, 30px)" style={goldStyle} />;
  } else if (inRound) {
    primary = <GoldButton label={phase === "warDeal" ? "AT WAR…" : "DEALING…"} disabled labelSize="clamp(20px, 2.1vw, 30px)" style={goldStyle} />;
  } else {
    primary = <GoldButton label="DEAL" sub={fmtMKD(totalStake)} onClick={deal} disabled={!canDeal} labelSize="clamp(21px, 2.2vw, 32px)" style={goldStyle} />;
  }

  const cardBox = { position: "relative", width: `calc(${CARD_W} * 1.7)`, height: `calc(${CARD_W} * 1.48)`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" };
  const ghost = (
    <div style={{ width: CARD_W, aspectRatio: "5 / 7", borderRadius: 14, border: "2px dashed #26314a", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Bolt style={{ width: "38%", height: "38%", opacity: 0.13 }} />
    </div>
  );

  const sideCol = (side, label, labelColor, cards, dir) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "clamp(8px, 1.8vh, 18px)" }}>
      <div style={{ height: "clamp(26px, 4.2vh, 36px)", display: "flex", alignItems: "center", fontSize: "clamp(14px, 2.2vh, 19px)", fontWeight: 700, letterSpacing: 6, color: labelColor, transition: "color .3s ease" }}>{label}</div>
      <div style={cardBox}>
        {cards.length === 0 ? ghost : cards.map((c, i) => (
          <WarCard key={i} c={c} dir={dir} second={i === 1} clearing={clearing}
            fx={fxFor(side, i, cards.length)} burst={burstFor(side, i, cards.length)} />
        ))}
      </div>
    </div>
  );

  return (
    <SpaceRoot>

      {/* 4-tie bonus flash (gold wash from the table edge) */}
      <div style={{ position: "absolute", inset: 0, zIndex: 8, pointerEvents: "none", background: "radial-gradient(115% 90% at 50% 105%, rgba(240,217,154,.16), rgba(240,217,154,0) 55%)", opacity: flashOn ? 1 : 0, transition: "opacity .5s ease" }} />

      <SpaceHeader title="CARD WAR" chip={chip} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>

        {/* ── left control panel ── */}
        <SpaceSidebar>
          <SoundButton />
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 2.2vh, 18px)", opacity: inRound ? 0.4 : 1, pointerEvents: inRound ? "none" : "auto", transition: "opacity .2s ease" }}>
            <BetStepper bet={bet} setBet={setBet} disabled={inRound} maxBet={MAX_BET} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SectionLabel>SIDE BETS</SectionLabel>
              <SideBetRow label="TIE" pays="10:1" value={tieBet} setValue={setTieBet} disabled={inRound} />
              <SideBetRow label="COLOUR TIE" pays="20:1" value={ctieBet} setValue={setCtieBet} disabled={inRound} />
            </div>
          </div>
        </SpaceSidebar>

        {/* ── duel column ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* readout + booked side-bet line */}
          <div style={{ position: "relative", zIndex: 4, height: 64, flex: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
            <div className={readHot ? "wr-hot-text" : undefined} style={{ opacity: readOpacity, fontSize: readSize, fontWeight: 700, letterSpacing: 4, color: readColor, textShadow: `0 0 28px ${readGlow}`, transition: "opacity .25s ease", whiteSpace: "nowrap" }}>{readText}</div>
            {sideLine && <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 2, color: T.gold, textShadow: "0 0 18px rgba(240,217,154,.4)" }}>{sideLine}</div>}
          </div>

          {/* the face-off: YOURS · VS · HOUSE */}
          <div style={{ position: "relative", zIndex: 4, flex: 1, minHeight: 140, margin: "0 24px 6px 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(18px, 3.4vw, 64px)", overflow: "hidden", animation: shake ? "bjShake .55s ease" : "none" }}>
            {sideCol("p", pLabel, pLabelColor, pCards, "L")}
            <VsBadge hot={phase === "war" || phase === "warDeal"} />
            {sideCol("d", "HOUSE", T.muted, dCards, "R")}
          </div>

          {/* ── bottom bar (mines idiom): LOBBY · ? ─ SURRENDER? · primary ── */}
          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", gap: "clamp(8px, 1vw, 14px)", margin: "0 clamp(10px, 1.6vw, 24px) 20px 10px" }}>
            <button onClick={() => { wrSfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 30px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>LOBBY
            </button>
            <button onClick={() => { wrSfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={{ flex: "none", width: "clamp(56px, 11vh, 88px)", minHeight: "clamp(56px, 11vh, 88px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" /></svg>
            </button>
            <div style={{ flex: 1 }} />
            {phase === "war" && warInfo && (
              <button onClick={surrender} disabled={busy} className="sp-hover-gold"
                style={tileStyle({ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(16px, 2.2vw, 34px)", borderRadius: 20, background: T.panelBg, animation: "wrPromptIn .3s cubic-bezier(.2,1.4,.4,1) both" })}>
                <span style={{ fontSize: "clamp(15px, 1.5vw, 22px)", letterSpacing: 4 }}>SURRENDER</span>
                <span style={{ fontSize: "clamp(11px, 1.8vh, 15px)", letterSpacing: 2, color: T.gold }}>TAKE {fmtMKD(warInfo.surrenderReturns)}</span>
              </button>
            )}
            {primary}
          </div>

        </div>
      </div>

      {rules && <RulesModal onClose={() => setRules(false)} />}
    </SpaceRoot>
  );
}
