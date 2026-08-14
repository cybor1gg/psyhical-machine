// HI·LO — "STARWAY HI·LO", space-theme cabinet screen designed in the
// established space language (Mines shell idioms + the Blackjack card kit).
// The table card sits large on a gold pedestal glow with the face-down next
// card to its right; HIGHER / LOWER are two big gold arrow tiles above the
// cards, each showing the server's payout multiplier for that call, with a
// free SKIP tile between them and the cards. A correct call flips the deck
// card (blackjack flip + whoosh), slides it left onto the pedestal with a
// green ring pulse and rising STREAK / ×mult pops; a wrong call simply
// finishes its flip and the run ends — silently, in neutral grey, with no
// sting, quake or red wash. Past cards of the run collect as thumbnails in a
// rail across the top.
//
// Everything money-shaped is SERVER-authoritative (api/routes/games.js hilo
// router: table / start / guess / skip / cashout / active). The server deals
// every card, decides the two calls offered per card ([high-side, low-side],
// "Higher/Lower or Same" on normal cards, strict + "Same" on A/K because Ace
// plays low and King high), compounds the multiplier and pays out; the
// balance only ever arrives via useBalance (api.js feeds the store from any
// response carrying `balance`).
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar, SectionLabel,
  GoldButton, SoundButton, BetStepper, T,
} from "./Shell";
import { beep, whoosh, sfx, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import { useMaxBet } from "./limits";
import "./space.css";
import "./hilo.css";


// Card geometry — hlSlideIn in hilo.css slides exactly CARD_W + CARD_GAP,
// keep the three in sync.
const CARD_W = "clamp(104px, 20vh, 210px)";
const CARD_GAP = "clamp(18px, 3vw, 46px)";
const THUMB_W = "clamp(36px, 6vh, 56px)";

// Server card model: index 0..51, rank = index % 13 (0=Two…12=Ace),
// suit = floor(index / 13) → ♣ ♦ ♥ ♠ (api/lib/games/hilo.js). Ace LOW.
const RANK_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = [
  { glyph: "♣", color: "#232c42" },
  { glyph: "♦", color: "#d64545" },
  { glyph: "♥", color: "#d64545" },
  { glyph: "♠", color: "#232c42" },
];

const trunc2 = (v) => Math.floor(v * 100 + 1e-9) / 100; // matches server truncate()
const dirGlyph = (choice) => (choice === "higher" ? "▲" : choice === "lower" ? "▼" : "●");

// Hi·Lo sfx kinds on the shared audio engine — deal/flip are the blackjack
// recipes, step(n) is mines' rising gem base (460 Hz × 1.055^(n−1)).
const hlSfx = {
  deal: () => { whoosh(1400, 3600, 0.09, 0.14); beep("triangle", 640, 480, 0.06, 0.08, 0.03); },
  flip: () => { whoosh(900, 2600, 0.1, 0.18); beep("sine", 880, 1100, 0.07, 0.12, 0.04); },
  step(n) {
    const base = 460 * Math.pow(1.055, (n || 1) - 1);
    whoosh(700, 2800, 0.09, 0.2);
    beep("triangle", base, base * 1.5, 0.16, 0.14, 0.02);
    beep("sine", base * 2, base * 3, 0.08, 0.14, 0.05);
  },
  bet: sfx.bet,
  cash: sfx.cash,
  click: sfx.click,
  // NOTE: no bust sting — a wrong call ends the run in silence.
};

// One big playing card, per the blackjack prototype's cardView: 5/7 aspect,
// corner ranks, centre pip, and the space-themed back with the gold "M" orb.
// The reveal flip is the rotateY change — the .65s transform transition flips
// it in place (hole-card pattern). `ring` = green win ring on the face's
// shadow. A wrong call gets NO ring at all: the card just flips, silently.
function BigCard({ index, faceDown, ring }) {
  const suit = index != null ? SUITS[Math.floor(index / 13)] : null;
  const rank = index != null ? RANK_LABELS[index % 13] : "";
  const color = suit ? suit.color : "#232c42";
  const faceShadow = ring
    ? "0 0 0 3px rgba(58,224,161,.85), 0 0 34px rgba(46,230,166,.45), 0 10px 26px rgba(0,0,0,.55)"
    : "0 10px 26px rgba(0,0,0,.55)";
  return (
    <div style={{ width: "100%", aspectRatio: "5 / 7", perspective: 900 }}>
      <div style={{ position: "relative", width: "100%", height: "100%", transformStyle: "preserve-3d", transform: `rotateY(${faceDown ? "180deg" : "0deg"})`, transition: "transform .65s cubic-bezier(.3,.9,.3,1)" }}>
        {/* face */}
        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", borderRadius: 12, background: "linear-gradient(160deg, #fdfdf8, #eef0ee 60%, #dde2e2)", boxShadow: faceShadow, display: "flex", alignItems: "center", justifyContent: "center", transition: "box-shadow .25s ease" }}>
          <span style={{ position: "absolute", top: 8, left: 12, fontSize: "clamp(28px, 5vh, 52px)", fontWeight: 700, lineHeight: 1, color }}>{rank}</span>
          <span style={{ position: "absolute", top: "clamp(36px, 6vh, 62px)", left: 13, fontSize: "clamp(16px, 2.6vh, 26px)", lineHeight: 1, color }}>{suit ? suit.glyph : ""}</span>
          <span style={{ fontSize: "clamp(44px, 7.6vh, 84px)", color }}>{suit ? suit.glyph : ""}</span>
          <span style={{ position: "absolute", bottom: 8, right: 12, fontSize: "clamp(28px, 5vh, 52px)", fontWeight: 700, lineHeight: 1, color, transform: "rotate(180deg)" }}>{rank}</span>
        </div>
        {/* back: deep-space blue, star specks, gold inner frame, "M" orb */}
        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)", borderRadius: 12, background: "radial-gradient(130% 120% at 30% 20%, #1c2740, #0d1322 70%)", boxShadow: "0 10px 26px rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <span style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 22% 28%, rgba(255,255,255,.8) 1px, transparent 1.6px), radial-gradient(circle at 68% 16%, rgba(240,217,154,.7) 1px, transparent 1.6px), radial-gradient(circle at 80% 70%, rgba(255,255,255,.6) 1px, transparent 1.6px), radial-gradient(circle at 36% 78%, rgba(140,190,255,.6) 1px, transparent 1.6px), radial-gradient(circle at 55% 48%, rgba(255,255,255,.5) 1px, transparent 1.6px)" }} />
          <span style={{ position: "absolute", inset: 8, borderRadius: 8, border: "1px solid rgba(217,178,106,.5)" }} />
          <span style={{ width: "46%", aspectRatio: "1", borderRadius: "50%", background: "radial-gradient(circle at 36% 32%, #f6e3ac, #d9b26a 55%, #97742f)", boxShadow: "0 0 22px rgba(240,217,154,.5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "clamp(19px, 3vh, 30px)", fontWeight: 700, color: "#1a1408" }}>M</span>
        </div>
      </div>
    </div>
  );
}

// Small card thumbnail for the history rail; the ring colour reads the
// card's fate (green = correct call, neutral grey = skipped OR bust — a
// bust is never singled out in red).
function ThumbCard({ index, kind }) {
  const suit = SUITS[Math.floor(index / 13)];
  const rank = RANK_LABELS[index % 13];
  const ringColor = kind === "win" ? "#2b6e55" : "#3a4557";
  const ringGlow = kind === "win" ? "0 0 12px rgba(46,230,166,.35)" : "none";
  return (
    <div style={{ width: THUMB_W, aspectRatio: "5 / 7", borderRadius: 7, background: "linear-gradient(160deg, #fdfdf8, #e7eae8)", border: `2px solid ${ringColor}`, boxShadow: `${ringGlow === "none" ? "" : ringGlow + ", "}0 4px 12px rgba(0,0,0,.45)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1, animation: "hlThumbIn .4s cubic-bezier(.2,1.4,.4,1) both", opacity: kind === "skip" ? 0.6 : 1 }}>
      <span style={{ fontSize: "clamp(13px, 2.2vh, 20px)", fontWeight: 700, color: suit.color }}>{rank}</span>
      <span style={{ fontSize: "clamp(11px, 1.9vh, 17px)", color: suit.color }}>{suit.glyph}</span>
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
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540, padding: "38px 42px", borderRadius: 24, border: `2px solid ${T.ctlBorder}`, background: "linear-gradient(180deg,#111826,#0a0d14)", boxShadow: "0 34px 90px rgba(0,0,0,.65)" }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>HOW TO PLAY</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 15, margin: "26px 0 30px", fontSize: 17, lineHeight: 1.5, color: "#b7c0d1" }}>
          {row("▲", T.gold, "Call HIGHER or LOWER on the table card. Each arrow shows exactly what that call pays.")}
          {row("◆", T.win, "Every correct call multiplies your bet — chain calls to grow the run.")}
          {row("●", T.text2, "One wrong call ends the round and the bet is lost.")}
          {row("⇄", T.gold, "SKIP swaps the table card for free. Ace plays low, King high — on those the safe side becomes SAME.")}
          {row("↑", T.gold, "CASH OUT after any correct call to bank the whole run.")}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}

export default function HiloSpace() {
  // the backoffice owns this; the screen used to hardcode it
  const MAX_BET = useMaxBet("hilo");
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  // phase: idle (pre-bet table card up) → playing → over (win|lose) → idle
  // again on the next BET. The table card NEVER leaves between rounds — the
  // server carries it over (pendingHilo), only SKIP swaps it.
  const [phase, setPhase] = useState("idle");
  const [outcome, setOutcome] = useState(null); // 'win' | 'lose'
  const [bet, setBet] = useState(100);
  const [cur, setCur] = useState(null);         // { id, index, anim: none|deal|slide }
  const [deck, setDeck] = useState({ id: 1, index: null, faceDown: true, anim: "none" });
  const [hist, setHist] = useState([]);         // [{ id, index, kind, tag }]
  const [calls, setCalls] = useState(null);     // server's [high-side, low-side]
  const [mult, setMult] = useState(1);          // server multiplier (compounds)
  const [potential, setPotential] = useState(0);// server potentialPayout
  const [streak, setStreak] = useState(0);      // correct calls this run
  const [lastWin, setLastWin] = useState(0);
  const [pops, setPops] = useState([]);
  const [ring, setRing] = useState(0);          // green ring pulse id
  const [flash, setFlash] = useState(false);    // gold/green WIN wash only
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");

  const readRef = useRef(null);
  const timers = useRef([]);
  const idRef = useRef(1);
  const busyRef = useRef(false); // one request/choreography at a time
  const curRef = useRef(cur);
  curRef.current = cur;

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };

  // ── SUSPENSE: freeze the credits between a run-ending request and the
  // moment the card flip resolves. holdsRef counts our own holds so error
  // paths and unmount can always give them back.
  const holdsRef = useRef(0);
  const takeHold = () => { holdsRef.current++; holdBalance(); };
  const dropHold = () => { if (holdsRef.current > 0) { holdsRef.current--; releaseBalance(); } };
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    while (holdsRef.current > 0) { holdsRef.current--; releaseBalance(); }
  }, []);

  const popRead = () => {
    const el = readRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = "scale(1.22)";
    requestAnimationFrame(() => { el.style.transition = "transform .34s cubic-bezier(.2,1.5,.4,1)"; el.style.transform = "scale(1)"; });
  };

  // Only a WIN washes the stage — there is no lose flash any more.
  const flashTimer = useRef(0);
  const doFlash = () => {
    setFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = later(() => setFlash(false), 420);
  };

  const popStage = (text, color, glow, delay = 0, top = 0) => {
    const id = ++idRef.current;
    setPops((ps) => ps.concat({ id, text, color, glow, delay, top }));
    later(() => setPops((ps) => ps.filter((p) => p.id !== id)), 1250 + delay);
  };

  // ── resume a live server round (mount / 409 on start) — no deal anims ─────
  function resumeFrom(data) {
    const cards = data.cards || [];
    const gs = data.guesses || [];
    // Rail = every card that already left the table, tagged by what happened
    // ON it: guesses[i] is the call made on cards[i].
    const entries = [];
    for (let i = 0; i < cards.length - 1; i++) {
      const g = gs[i] || {};
      if (g.choice === "skip") entries.push({ id: ++idRef.current, index: cards[i].index, kind: "skip", tag: "SKIP" });
      else entries.push({ id: ++idRef.current, index: cards[i].index, kind: "win", tag: dirGlyph(g.choice) + " ×" + Number(g.stepTotal ?? data.multiplier).toFixed(2) });
    }
    setHist(entries);
    setCur({ id: ++idRef.current, index: cards[cards.length - 1].index, anim: "none" });
    setDeck({ id: ++idRef.current, index: null, faceDown: true, anim: "none" });
    setCalls(data.calls);
    setMult(data.multiplier);
    setStreak(gs.filter((g) => g.won === true).length);
    setPotential(trunc2((Number(data.betAmount) || 0) * data.multiplier));
    setBet(Math.max(50, Math.min(MAX_BET, Math.round((Number(data.betAmount) || 50) / 50) * 50)));
    setOutcome(null);
    setLastWin(0);
    setPhase("playing");
  }

  // ── mount: ambience + resume, else fetch the pre-bet table card ───────────
  useEffect(() => {
    armAmbientOnGesture();
    startAmbient();
    let dead = false;
    (async () => {
      const { ok, data } = await apiGet("/api/games/hilo/active");
      if (dead) return;
      if (ok && data.active) { resumeFrom(data); return; }
      const t = await apiGet("/api/games/hilo/table");
      if (dead || !t.ok || t.data.active) return;
      setCur({ id: ++idRef.current, index: t.data.card.index, anim: "deal" });
      setCalls(t.data.calls);
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── server round flow ─────────────────────────────────────────────────────
  async function startBet() {
    if (phase === "playing" || busyRef.current) return;
    if (balance < 50) return;
    busyRef.current = true;
    setError("");
    const stake = Math.max(50, Math.min(bet, MAX_BET, Math.floor(balance)));
    const { ok, status, data } = await apiPost("/api/games/hilo/start", { betAmount: stake });
    if (!ok) {
      busyRef.current = false;
      if (status === 409) { // round already live → pick it up
        const r = await apiGet("/api/games/hilo/active");
        if (r.ok && r.data.active) { resumeFrom(r.data); return; }
      }
      setError(data?.error || "Something went wrong");
      return;
    }
    setBet(stake);
    setHist([]);
    setOutcome(null);
    setLastWin(0);
    setStreak(0);
    setMult(1);
    setPotential(0);
    setPops([]);
    setCalls(data.calls);
    // v3 invariant: betting keeps the exact card on the table — only re-deal
    // if the server (edge case: no pending card) started on a different one.
    setCur((c) => (c && c.index === data.card.index ? c : { id: ++idRef.current, index: data.card.index, anim: "deal" }));
    setDeck({ id: ++idRef.current, index: null, faceDown: true, anim: "deal" });
    setPhase("playing");
    hlSfx.bet();
    busyRef.current = false;
  }

  async function makeCall(choice) {
    if (phase !== "playing" || busyRef.current || !calls) return;
    busyRef.current = true;
    setError("");
    hlSfx.flip(); // feedback belongs to the tap; the response drives the reveal
    takeHold(); // this call can end the run — hold the credits until the flip
    const { ok, data } = await apiPost("/api/games/hilo/guess", { choice });
    if (!ok) { dropHold(); busyRef.current = false; setError(data?.error || "Something went wrong"); return; }
    const glyph = dirGlyph(choice);

    // The face-down deck card flips in place (blackjack hole-card reveal).
    setDeck((d) => ({ ...d, index: data.card.index, faceDown: false }));

    if (data.won) {
      // correct → after the flip, the card slides left onto the pedestal
      later(() => {
        const prev = curRef.current;
        if (prev) setHist((h) => h.concat({ id: ++idRef.current, index: prev.index, kind: "win", tag: glyph + " ×" + data.multiplier.toFixed(2) }));
        setCur({ id: ++idRef.current, index: data.card.index, anim: "slide" });
        setDeck({ id: ++idRef.current, index: null, faceDown: true, anim: "deal" });
        setMult(data.multiplier);
        setPotential(data.potentialPayout ?? 0);
        setCalls(data.calls);
        setRing(++idRef.current);
        later(() => setRing(0), 800);
        setStreak((s) => {
          const n = s + 1;
          hlSfx.step(n);
          popStage("STREAK " + n, T.gold, "rgba(240,217,154,.55)", 0, 0);
          popStage("×" + data.multiplier.toFixed(2), "#7ef0c0", "rgba(46,230,166,.6)", 150, 30);
          return n;
        });
        popRead();
        dropHold(); // the flip resolved into a win — credits may move
        busyRef.current = false;
      }, 700);
      return;
    }

    // wrong → the card simply finishes its flip and the run ends: no sting,
    // no quake, no red wash, just a neutral BUST readout.
    later(() => {
      setPhase("over");
      setOutcome("lose");
      setLastWin(0);
    }, 300);
    later(() => {
      const prev = curRef.current;
      if (prev) setHist((h) => h.concat({ id: ++idRef.current, index: prev.index, kind: "bust", tag: glyph + " BUST" }));
      // The bust card stays on the table as the next round's start card
      // (server holds it in pendingHilo) — slide it onto the pedestal.
      setCur({ id: ++idRef.current, index: data.card.index, anim: "slide" });
      setDeck({ id: ++idRef.current, index: null, faceDown: true, anim: "deal" });
      setCalls(data.calls);
      setStreak(0);
      setMult(1);
      setPotential(0);
      dropHold(); // the flip has fully resolved — credits may move
      busyRef.current = false;
    }, 1100);
  }

  async function doSkip() {
    if (busyRef.current || !cur) return;
    busyRef.current = true;
    setError("");
    hlSfx.deal();
    const { ok, data } = await apiPost("/api/games/hilo/skip");
    busyRef.current = false;
    if (!ok) { setError(data?.error || "Something went wrong"); return; }
    if (!data.preBet && phase === "playing") {
      const prev = curRef.current;
      if (prev) setHist((h) => h.concat({ id: ++idRef.current, index: prev.index, kind: "skip", tag: "SKIP" }));
    } else {
      setPhase("idle"); // pre-bet reroll also clears a lingering WIN/BUST readout
      setOutcome(null);
    }
    setCur({ id: ++idRef.current, index: data.card.index, anim: "deal" });
    setCalls(data.calls);
  }

  async function cashOut() {
    if (phase !== "playing" || busyRef.current || streak === 0) return;
    busyRef.current = true;
    setError("");
    takeHold(); // the payout must not land before the WIN readout does
    const { ok, data } = await apiPost("/api/games/hilo/cashout");
    busyRef.current = false;
    if (!ok) { dropHold(); setError(data?.error || "Something went wrong"); return; }
    setPhase("over");
    setOutcome("win");
    setLastWin(data.payout);
    setCalls(data.calls); // the cashed-out card stays as the next start card
    setPotential(0);
    hlSfx.cash();
    doFlash();
    popRead();
    dropHold(); // the win is on screen — credits may move
  }

  // ── derived render values ─────────────────────────────────────────────────
  const playing = phase === "playing";
  const over = phase === "over";
  const canBet = balance >= 50;

  // readout line — server errors take it over, in red
  let readText = "", readColor = T.muted, readGlow = "rgba(0,0,0,0)", readOpacity = 1, readSize = 26;
  if (error) { readText = error.toUpperCase(); readColor = "#ff6a5a"; readGlow = "rgba(255,90,74,.55)"; }
  else if (phase === "idle") { readText = "PRESS BET TO START"; readOpacity = 0.8; }
  else if (playing && streak === 0) { readText = "HIGHER OR LOWER?"; readColor = T.text2; }
  else if (playing) { readText = "×" + mult.toFixed(2); readColor = T.gold; readGlow = "rgba(240,217,154,.5)"; readSize = 34; }
  else if (over) {
    readSize = 34;
    if (outcome === "win") { readText = "WIN +" + fmtMKD(lastWin); readColor = T.win; readGlow = "rgba(46,230,166,.5)"; }
    else { readText = "BUST"; readColor = T.text2; } // readable, never punishing
  }

  // header status chip: current ×mult while live, last result after
  const chip = playing
    ? { label: "× " + mult.toFixed(2), color: T.gold }
    : over
      ? (outcome === "win" ? { label: "+" + fmtMKD(lastWin), color: T.win } : { label: "BUST", color: T.text2 })
      : { label: "READY", color: T.text2 };

  // primary button — mines' dual-mode: BET ↔ CASH OUT (gold, sub = payout)
  let primary;
  if (playing) {
    primary = streak > 0
      ? <GoldButton label="CASH OUT" sub={fmtMKD(potential)} onClick={cashOut} labelSize="clamp(21px, 2.2vw, 32px)" style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 }} />
      : <GoldButton label="MAKE A CALL" disabled labelSize="clamp(21px, 2.2vw, 32px)" style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 }} />;
  } else {
    primary = <GoldButton label="BET" sub={fmtMKD(Math.min(bet, Math.max(50, Math.floor(balance) || 50)))} onClick={startBet} disabled={!canBet} labelSize="clamp(21px, 2.2vw, 32px)" style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 }} />;
  }

  // HIGHER / LOWER arrow tiles: server order is [high-side, low-side]; on A/K
  // one side becomes SAME — the label always comes from the server's call.
  const choiceTile = (call, side) => {
    const enabled = playing && !!call;
    const chev = side === "hi"
      ? <path d="M6 15l6-6 6 6" />
      : <path d="M6 9l6 6 6-6" />;
    return (
      <button key={side} onClick={enabled ? () => makeCall(call.choice) : undefined} disabled={!enabled} className="sp-hover-gold"
        style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "clamp(10px, 1.2vw, 20px)", minHeight: "clamp(56px, 9vh, 76px)", minWidth: "clamp(180px, 21vw, 330px)", padding: "0 clamp(14px, 1.8vw, 30px)", borderRadius: 18, border: `2px solid ${enabled ? "#3a4557" : T.panelBorder}`, background: T.panelBg, cursor: enabled ? "pointer" : "default", opacity: enabled ? 1 : 0.45, transition: "all .2s ease" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke={T.gold} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: "clamp(26px, 4.4vh, 38px)", height: "clamp(26px, 4.4vh, 38px)", filter: "drop-shadow(0 0 8px rgba(240,217,154,.45))", flex: "none" }}>{chev}</svg>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: "clamp(20px, 3.2vh, 28px)", fontWeight: 700, letterSpacing: 1, color: T.gold, lineHeight: 1 }}>
            {call ? "×" + call.multiplier.toFixed(2) : "—"}
          </span>
          <span style={{ fontSize: "clamp(11px, 1.7vh, 14px)", letterSpacing: 2, color: T.text2, whiteSpace: "nowrap" }}>
            {call ? call.label.toUpperCase() + " · " + (call.probability * 100).toFixed(1) + "%" : ""}
          </span>
        </span>
      </button>
    );
  };

  const railTagColor = (kind) => (kind === "win" ? T.win : T.muted); // BUST tags read muted, not red

  const payRow = (k, v, color = T.gold) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "clamp(13px, 2vh, 16px)", fontWeight: 700 }}>
      <span style={{ color: T.text2 }}>{k}</span><span style={{ color }}>{v}</span>
    </div>
  );

  return (
    <SpaceRoot>

      {/* WIN flash (there is no lose wash — a bust never paints the stage) */}
      <div style={{ position: "absolute", inset: 0, zIndex: 8, pointerEvents: "none", background: "radial-gradient(circle at 50% 50%, rgba(46,230,166,.42), rgba(46,230,166,0) 70%)", opacity: flash ? 1 : 0, transition: "opacity .3s ease" }} />

      <SpaceHeader title="HI·LO" chip={chip} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>

        {/* ── left control panel ── */}
        <SpaceSidebar>
          <SoundButton />
          <BetStepper bet={bet} setBet={setBet} disabled={playing} maxBet={MAX_BET} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "clamp(8px, 1.6vh, 14px)", borderRadius: 16, border: `2px solid ${T.panelBorder}`, background: "rgba(255,255,255,.02)" }}>
            <SectionLabel>RUN</SectionLabel>
            {payRow("STREAK", String(streak), streak > 0 ? T.win : T.text2)}
            {payRow("MULTIPLIER", "×" + mult.toFixed(2))}
            {payRow("POTENTIAL", fmtMKD(potential), potential > 0 ? T.gold : T.text2)}
          </div>
        </SpaceSidebar>

        {/* ── stage column ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* history rail: the run's past cards as thumbnails across the top */}
          <div style={{ position: "relative", zIndex: 4, flex: "none", height: "clamp(64px, 11vh, 104px)", margin: "6px 24px 0 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(8px, 1vw, 14px)", overflow: "hidden" }}>
            {hist.slice(-12).map((e) => (
              <div key={e.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: "none" }}>
                <ThumbCard index={e.index} kind={e.kind} />
                <span style={{ fontSize: "clamp(9px, 1.5vh, 12px)", fontWeight: 700, letterSpacing: 1, color: railTagColor(e.kind), whiteSpace: "nowrap" }}>{e.tag}</span>
              </div>
            ))}
          </div>

          {/* readout */}
          <div style={{ position: "relative", zIndex: 4, height: 46, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div ref={readRef} style={{ opacity: readOpacity, transform: "scale(1)", fontSize: readSize, fontWeight: 700, letterSpacing: 3, color: readColor, textShadow: `0 0 28px ${readGlow}`, transition: "opacity .25s ease" }}>{readText}</div>
          </div>

          {/* stage: choice tiles → skip → table card + deck card */}
          <div style={{ position: "relative", zIndex: 4, flex: 1, minHeight: 140, margin: "0 24px 8px 14px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(8px, 1.8vh, 18px)" }}>

            {/* HIGHER / LOWER arrow tiles (server's [high-side, low-side]) */}
            <div style={{ display: "flex", gap: "clamp(12px, 2vw, 30px)" }}>
              {choiceTile(calls ? calls[0] : null, "hi")}
              {choiceTile(calls ? calls[1] : null, "lo")}
            </div>

            {/* SKIP: swaps the table card, free — pre-bet and pre-guess */}
            <button onClick={doSkip} className="sp-hover-gold"
              style={{ display: "flex", alignItems: "center", gap: 10, minHeight: "clamp(42px, 7vh, 58px)", padding: "0 clamp(18px, 2.4vw, 36px)", borderRadius: 16, border: "3px dashed #3a4557", background: T.panelBg, color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(14px, 1.3vw, 19px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer", opacity: cur ? 1 : 0.35, transition: "all .2s ease" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h12l-3.5-3.5M20 17H8l3.5 3.5" /></svg>
              SKIP CARD
            </button>

            {/* the table card on its pedestal + the face-down deck card */}
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: CARD_GAP, paddingBottom: "clamp(14px, 2.6vh, 26px)" }}>
              {/* current card slot */}
              <div style={{ position: "relative", width: CARD_W, flex: "none" }}>
                {/* gold pedestal glow */}
                <div style={{ position: "absolute", left: "50%", bottom: "clamp(-24px, -2.6vh, -12px)", width: "150%", height: "clamp(16px, 3.2vh, 32px)", transform: "translateX(-50%)", borderRadius: "50%", background: "radial-gradient(50% 50% at 50% 50%, rgba(240,217,154,.5), rgba(240,217,154,.14) 55%, transparent 78%)", filter: "blur(6px)", animation: "hlPedestal 4.2s ease-in-out infinite", pointerEvents: "none" }} />
                {cur && (
                  <div key={cur.id} style={{ animation: cur.anim === "deal" ? "hlDealIn .5s ease both" : cur.anim === "slide" ? "hlSlideIn .38s cubic-bezier(.25,.9,.35,1) both" : "none" }}>
                    <BigCard index={cur.index} faceDown={false} ring={ring > 0} />
                  </div>
                )}
                {/* green ring pulse on a correct call */}
                {ring > 0 && (
                  <span key={ring} style={{ position: "absolute", left: "50%", top: "50%", width: "130%", aspectRatio: "1", borderRadius: "50%", border: "3px solid #3ae0a1", animation: "hlRing .7s ease-out both", pointerEvents: "none", zIndex: 7 }} />
                )}
                {/* rising STREAK / ×mult pops */}
                {pops.map((p) => (
                  <span key={p.id} style={{ position: "absolute", left: "50%", top: p.top, zIndex: 8, whiteSpace: "nowrap", fontSize: "clamp(18px, 3vh, 26px)", fontWeight: 700, letterSpacing: 2, color: p.color, textShadow: `0 0 16px ${p.glow}`, animation: `hlRise 1.05s ease-out ${p.delay}ms both`, pointerEvents: "none" }}>{p.text}</span>
                ))}
              </div>
              {/* deck slot: the face-down next card (space back, gold M orb) */}
              <div style={{ position: "relative", width: CARD_W, flex: "none", opacity: playing ? 1 : 0.55, transition: "opacity .3s ease" }}>
                {/* underlay card — reads as the rest of the deck */}
                <div style={{ position: "absolute", left: 7, top: 7, right: -7, bottom: -7, borderRadius: 12, background: "#0c1120", border: "1px solid rgba(217,178,106,.22)", opacity: 0.65, pointerEvents: "none" }} />
                <div key={deck.id} style={{ position: "relative", animation: deck.anim === "deal" ? "hlDealIn .5s ease both" : "none" }}>
                  <BigCard index={deck.index} faceDown={deck.faceDown} />
                </div>
              </div>
            </div>
          </div>

          {/* ── bottom bar: LOBBY / ⓘ / spacer / primary ── */}
          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", gap: "clamp(8px, 1vw, 14px)", margin: "0 clamp(10px, 1.6vw, 24px) 20px 10px" }}>
            <button onClick={() => { hlSfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 30px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>LOBBY
            </button>
            <button onClick={() => { hlSfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={{ flex: "none", width: "clamp(56px, 11vh, 88px)", minHeight: "clamp(56px, 11vh, 88px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" /></svg>
            </button>
            <div style={{ flex: 1 }} />
            {primary}
          </div>

        </div>
      </div>

      {rules && <RulesModal onClose={() => setRules(false)} />}
    </SpaceRoot>
  );
}
