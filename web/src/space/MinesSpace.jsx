// MINES — space-theme cabinet screen, ported from the "Mines Game" design
// handoff prototype. The scattered floating asteroid field, reveal
// choreography (gem spin-in, bomb slam, distance-staggered end-of-round
// sweep), bursts/pops, flash and the synthesized sfx are all the prototype's;
// the round itself is SERVER-authoritative: mine positions, multipliers,
// payouts and the balance only ever come from api/routes/mines.js
// (start / guess / cashout / active). Layout index i ↔ server tile index i.
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { useBalance, getBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import SpaceBackground from "./SpaceBackground";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar, SectionLabel,
  GoldButton, SoundButton, BetStepper, tileStyle, pillStyle, T,
} from "./Shell";
import { beep, whoosh, sfx, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import "./space.css";
import "./mines.css";

const MAX_BET = 500; // platform max bet (МКД, integer steps of 50)
const GRIDS = [16, 25, 36];

// Scattered layout: jittered grid over ~2.2× as many cells as tiles, random
// rotation ±7°, per-tile float bob timing and scale .88–1.14 (prototype's
// makeLayout, verbatim). Index i in this array IS server tile index i.
function makeLayout(N) {
  const cols = Math.ceil(Math.sqrt(N * 2.2)), rows = Math.ceil(N / cols);
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
  for (let k = cells.length - 1; k > 0; k--) { const j = (Math.random() * (k + 1)) | 0; const t = cells[k]; cells[k] = cells[j]; cells[j] = t; }
  const cw = 100 / cols, ch = 100 / rows;
  return cells.slice(0, N).map((cell) => {
    const lx = cell[0] * cw + cw / 2 + (Math.random() - 0.5) * cw * 0.32;
    const ly = cell[1] * ch + ch / 2 + (Math.random() - 0.5) * ch * 0.24;
    return { lx, ly, left: lx.toFixed(2) + "%", top: ly.toFixed(2) + "%", rot: ((Math.random() - 0.5) * 14).toFixed(1) + "deg", dur: (4.5 + Math.random() * 3.5).toFixed(2) + "s", delay: (-(Math.random() * 6)).toFixed(2) + "s", scale: 0.88 + Math.random() * 0.26 };
  });
}

// Mines-specific sfx kinds (prototype recipes) on the shared audio engine.
const mnSfx = {
  // rising base per gem streak: 460 Hz × 1.055^(n−1)
  gem(n) {
    const base = 460 * Math.pow(1.055, (n || 1) - 1);
    whoosh(700, 2800, 0.09, 0.2);
    beep("triangle", base, base * 1.5, 0.16, 0.14, 0.02);
    beep("sine", base * 2, base * 3, 0.08, 0.14, 0.05);
  },
  bet: sfx.bet,
  cash: sfx.cash,
  click: sfx.click,
  // NOTE: the cabinet only celebrates wins — a mine hit plays nothing.
};

const GEM_SVG = (
  <svg viewBox="0 0 24 24" style={{ width: "52%", height: "52%", filter: "drop-shadow(0 2px 4px rgba(0,0,0,.4))" }}>
    <polygon points="12,2.5 21,9.5 12,22 3,9.5" fill="#eafff7" />
    <polygon points="12,2.5 12,22 21,9.5" fill="#a8eccf" />
    <polygon points="12,2.5 3,9.5 21,9.5" fill="#d6fff0" opacity=".75" />
    <polygon points="3,9.5 21,9.5 12,13.2" fill="#ffffff" opacity=".5" />
  </svg>
);
// The non-gem marker. Losses are never dramatised: a mine simply reveals as a
// dim grey disc — no red, no fuse, no spark.
const BOMB_SVG = (
  <svg viewBox="0 0 24 24" style={{ width: "50%", height: "50%", filter: "drop-shadow(0 2px 4px rgba(0,0,0,.4))" }}>
    <circle cx="12" cy="12" r="7.5" fill="#161c28" />
    <circle cx="12" cy="12" r="7.5" fill="none" stroke="#5d6a80" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="2.6" fill="#8a94a8" opacity=".7" />
  </svg>
);

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
          {row("◆", T.win, "Reveal tiles to uncover gems. Every gem raises your multiplier.")}
          {row("●", T.lose, "Hit a mine and the round is over — you lose the bet.")}
          {row("↑", T.gold, "Cash out at any time to bank your current winnings.")}
          {row("✦", T.gold, "More mines means higher risk and far bigger payouts.")}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}

export default function MinesSpace() {
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  // phase: idle → playing → over (win|lose) → idle again on next BET
  const [phase, setPhase] = useState("idle");
  const [gridN, setGridN] = useState(25);
  const [mines, setMines] = useState(3);
  const [bet, setBet] = useState(100);
  const [revealed, setRevealed] = useState([]);   // gem tiles, server-confirmed
  const [mineSet, setMineSet] = useState([]);     // full mine list — only after settle
  const [hitMine, setHitMine] = useState(-1);
  const [outcome, setOutcome] = useState(null);   // 'win' | 'lose'
  const [lastWin, setLastWin] = useState(0);      // server payout
  const [mult, setMult] = useState(1);            // server multiplier
  const [potential, setPotential] = useState(0);  // server potentialPayout
  const [layout, setLayout] = useState(() => makeLayout(25));
  const [bursts, setBursts] = useState([]);
  const [pops, setPops] = useState([]);
  const [flash, setFlash] = useState({ on: false, kind: "win" });
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");
  const [field, setField] = useState({ fw: 0, fh: 0 });

  const gridRef = useRef(null);
  const readRef = useRef(null);
  const timers = useRef([]);
  const bid = useRef(0);
  const busyRef = useRef(false);       // one request in flight at a time
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // ── suspense: freeze the credits readout until the reveal lands ───────────
  // Every hold is matched by exactly one release (error paths included), and
  // anything still outstanding is released on unmount so the readout can never
  // be stranded mid-animation.
  const holdRef = useRef(0);
  const holdCredits = () => { holdRef.current++; holdBalance(); };
  const releaseCredits = () => { if (holdRef.current > 0) { holdRef.current--; releaseBalance(); } };
  useEffect(() => () => { while (holdRef.current > 0) { holdRef.current--; releaseBalance(); } }, []);

  // ── mount: ambience + resume a live server round ──────────────────────────
  useEffect(() => {
    armAmbientOnGesture();
    startAmbient();
    let dead = false;
    apiGet("/api/games/mines/active").then(({ ok, data }) => {
      if (dead || !ok || !data.active) return;
      const g = data.gridSize ?? data.tiles ?? 25;
      setGridN(g);
      setMines(data.mines);
      setBet(Math.max(50, Math.round(Number(data.betAmount) || 50)));
      setLayout(makeLayout(g));
      setRevealed(data.picks);
      setMult(data.multiplier);
      setPotential(data.potentialPayout ?? 0);
      setMineSet([]);
      setHitMine(-1);
      setOutcome(null);
      setPhase("playing");
    });
    return () => { dead = true; };
  }, []);

  // ── measure the scatter field (prototype's ResizeObserver) ────────────────
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setField((f) => (Math.abs(r.width - f.fw) > 4 || Math.abs(r.height - f.fh) > 4 ? { fw: r.width, fh: r.height } : f));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── choreography helpers (prototype) ──────────────────────────────────────
  // green gem burst — the only burst there is; losses get no particles at all
  const burst = useCallback((i) => {
    const L = layoutRef.current[i];
    if (!L) return;
    const id = ++bid.current;
    const cnt = 7;
    const sparks = Array.from({ length: cnt }, (_, k) => ({ rot: Math.round(k * 360 / cnt + Math.random() * 34) + "deg", sc: (0.7 + Math.random() * 0.8).toFixed(2) }));
    const b = { id, left: L.left, top: L.top, sparks, ring: "#7ef0c0", spark: "#8df0c8", ringSize: 90 };
    setBursts((bs) => bs.concat(b));
    later(() => setBursts((bs) => bs.filter((x) => x.id !== id)), 950);
  }, []);

  const popMult = useCallback((i, text, color, glow) => {
    const L = layoutRef.current[i];
    if (!L) return;
    const id = ++bid.current;
    setPops((ps) => ps.concat({ id, left: L.left, top: L.top, text, color, glow }));
    later(() => setPops((ps) => ps.filter((x) => x.id !== id)), 1000);
  }, []);

  const popRead = () => {
    const el = readRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = "scale(1.22)";
    requestAnimationFrame(() => { el.style.transition = "transform .34s cubic-bezier(.2,1.5,.4,1)"; el.style.transform = "scale(1)"; });
  };

  const flashTimer = useRef(0);
  const doFlash = (kind) => {
    setFlash({ on: true, kind });
    clearTimeout(flashTimer.current);
    flashTimer.current = later(() => setFlash((f) => ({ ...f, on: false })), 420);
  };

  // ── server round flow ─────────────────────────────────────────────────────
  async function post(path, body) {
    busyRef.current = true;
    setError("");
    const { ok, data } = await apiPost(path, body);
    busyRef.current = false;
    if (!ok) { setError(data?.error || "Something went wrong"); return null; }
    return data;
  }

  async function startBet() {
    if (phase === "playing" || busyRef.current) return;
    const bal = getBalance() ?? 0;   // true credits, even mid-hold, so the cap is right
    if (bal < 50) return;
    const stake = Math.min(bet, MAX_BET, Math.floor(bal));
    const data = await post("/api/games/mines/start", { betAmount: stake, mines, gridSize: gridN });
    if (!data) return;
    setBet(stake);
    setLayout(makeLayout(gridN));
    setRevealed([]);
    setMineSet([]);
    setHitMine(-1);
    setOutcome(null);
    setLastWin(0);
    setMult(data.multiplier ?? 1);
    setPotential(0);
    setBursts([]);
    setPops([]);
    setPhase("playing");
    mnSfx.bet();
  }

  async function reveal(i) {
    if (phase !== "playing" || busyRef.current) return;
    if (revealedRef.current.includes(i)) return;
    // a guess can auto-settle the round (every gem found) — hold the credits
    // until we know, and hand the release to the settle choreography if it does
    holdCredits();
    let handoff = false;
    try {
      const data = await post("/api/games/mines/guess", { tile: i });
      if (!data) return;
      if (!data.won) {
        // round over — the response carries the full mine list for the board
        // sweep. No sound, no flash, no burst: the tiles just reveal, quietly.
        setPhase("over");
        setOutcome("lose");
        setHitMine(i);
        setMineSet(data.mines);
        setLastWin(0);
        return;
      }
      // safe pick (server multiplier drives readout, pop and potential payout)
      const next = revealedRef.current.concat(i);
      setRevealed(next);
      setMult(data.multiplier);
      if (data.potentialPayout != null) setPotential(data.potentialPayout);
      mnSfx.gem(data.picks ?? next.length);
      popRead();
      burst(i);
      popMult(i, "×" + data.multiplier.toFixed(2), "#7ef0c0", "rgba(46,230,166,.6)");
      if (data.top) {
        // every gem found — the server auto-settled as cashed_out
        handoff = true;
        later(() => {
          setPhase("over");
          setOutcome("win");
          setLastWin(data.payout);
          setMineSet(data.mines);
          mnSfx.cash();
          doFlash("win");
          releaseCredits();   // the win is on screen — let the credits catch up
        }, 350);
      }
    } finally {
      if (!handoff) releaseCredits();
    }
  }

  async function cashOut() {
    if (phase !== "playing" || busyRef.current || revealedRef.current.length === 0) return;
    holdCredits();
    try {
      const data = await post("/api/games/mines/cashout");
      if (!data) return;
      setPhase("over");
      setOutcome("win");
      setLastWin(data.payout);
      setMult(data.multiplier);
      setMineSet(data.mines);
      mnSfx.cash();
      doFlash("win");
    } finally {
      // released on the same frame the WIN readout and gold flash appear
      releaseCredits();
    }
  }

  function pickRandom() {
    if (phase !== "playing" || busyRef.current) return;
    const hidden = [];
    for (let i = 0; i < gridN; i++) if (!revealedRef.current.includes(i)) hidden.push(i);
    if (hidden.length) reveal(hidden[(Math.random() * hidden.length) | 0]);
  }

  function setGrid(n) {
    if (phase === "playing") return;
    setGridN(n);
    setMines((m) => Math.min(m, n - 1));
    setPhase("idle");
    setRevealed([]);
    setMineSet([]);
    setHitMine(-1);
    setOutcome(null);
    setLayout(makeLayout(n));
    setBursts([]);
    setPops([]);
    mnSfx.click();
  }

  // ── derived render values (prototype's renderVals) ────────────────────────
  const lock = phase === "playing";
  const over = phase === "over";
  const N = gridN;
  const revSet = new Set(revealed);
  const mSet = new Set(mineSet);

  const maxPx = N === 16 ? 104 : N === 25 ? 88 : 74;
  const gcols = Math.ceil(Math.sqrt(N * 2.2)), grows = Math.ceil(N / gcols);
  const fw = field.fw || 1500, fh = field.fh || 480;
  const cellPx = Math.min(fw / gcols, fh / grows);
  const basePx = Math.max(42, Math.min(maxPx, cellPx * 0.58));
  const overOrigin = over ? (outcome === "lose" && hitMine >= 0 ? layout[hitMine] : { lx: 50, ly: 50 }) : null;

  const tiles = Array.from({ length: N }, (_, i) => {
    const L = layout[i] || { lx: 50, ly: 50, left: "50%", top: "50%", rot: "0deg", dur: "5s", delay: "0s", scale: 1 };
    const isRev = revSet.has(i), isMine = mSet.has(i);
    let face = "hidden";
    if (lock) face = isRev ? "gem" : "hidden";
    else if (over) face = isMine ? (i === hitMine ? "mineHit" : "mine") : (isRev ? "gem" : "gemDim");
    let coverOp = 1, coverScale = 1, faceOp = 0, faceAnim = "none", gemOp = 0, bombOp = 0, revBg = "transparent", revBorder = "transparent", revGlow = "none", z = 2, wrapAnim = "none";
    const dly = overOrigin ? Math.round(Math.hypot(L.lx - overOrigin.lx, L.ly - overOrigin.ly) * 3.2) : 0;
    if (face !== "hidden") { coverOp = 0; coverScale = 1.45; faceOp = 1; z = 3; }
    if (face === "gem") { gemOp = 1; revBg = "radial-gradient(circle at 50% 32%, #1f7d5b, #0d5a3f 70%)"; revBorder = "#3fe0a0"; revGlow = "0 0 22px rgba(46,230,166,.5), inset 0 2px 0 rgba(255,255,255,.2)"; faceAnim = "mnRevealGem .55s cubic-bezier(.2,1.5,.4,1) both"; }
    else if (face === "gemDim") { gemOp = 0.5; revBg = "#10261f"; revBorder = "#1c473a"; faceAnim = `mnRevealSoft .5s ease ${dly}ms both`; }
    // a mine reveals in muted grey — the same calm sweep as the unpicked gems
    else if (face === "mine") { bombOp = 0.7; revBg = "radial-gradient(circle at 50% 35%, #1b2130, #121722 75%)"; revBorder = "#2a3345"; faceAnim = `mnRevealSoft .5s ease ${dly}ms both`; }
    else if (face === "mineHit") { bombOp = 0.95; revBg = "radial-gradient(circle at 50% 35%, #232b3c, #161c28 80%)"; revBorder = "#5d6a80"; revGlow = "0 0 20px rgba(138,148,168,.22)"; faceAnim = "mnRevealSoft .5s ease both"; z = 5; }
    const canClick = lock && !isRev;
    return { i, L, size: Math.round(basePx * L.scale), z, wrapAnim, coverOp, coverScale, faceOp, faceAnim, revBg, revBorder, revGlow, gemOp, bombOp, canClick };
  });

  // readout line — server errors take it over, in red
  let readText = "", readColor = T.muted, readGlow = "rgba(0,0,0,0)", readOpacity = 1, readSize = 26;
  if (error) { readText = error.toUpperCase(); readColor = "#ff6a5a"; readGlow = "rgba(255,90,74,.55)"; readSize = 26; }
  else if (phase === "idle") { readText = "PRESS BET TO START"; readOpacity = 0.8; }
  else if (lock) { readText = "×" + mult.toFixed(2); readColor = T.gold; readGlow = "rgba(240,217,154,.5)"; readSize = 34; }
  else if (over) {
    readSize = 34;
    if (outcome === "win") { readText = "WIN +" + fmtMKD(lastWin); readColor = T.win; readGlow = "rgba(46,230,166,.5)"; }
    else { readText = "ROUND OVER"; readColor = T.text2; readSize = 30; }
  }

  // header status chip
  const chip = lock
    ? { label: "× " + mult.toFixed(2), color: T.gold }
    : over
      ? (outcome === "win" ? { label: "× " + mult.toFixed(2), color: T.text2 } : { label: "NO WIN", color: T.text2 })
      : { label: "READY", color: T.text2 };

  // primary button
  const canBet = balance >= 50;
  let primary;
  if (lock) {
    primary = revealed.length > 0
      ? <GoldButton label="CASH OUT" sub={fmtMKD(potential)} onClick={cashOut} labelSize="clamp(21px, 2.2vw, 32px)" style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 }} />
      : <GoldButton label="PICK A TILE" disabled labelSize="clamp(21px, 2.2vw, 32px)" style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 }} />;
  } else {
    primary = <GoldButton label="BET" sub={fmtMKD(Math.min(bet, Math.max(50, Math.floor(balance) || 50)))} onClick={startBet} disabled={!canBet} labelSize="clamp(21px, 2.2vw, 32px)" style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 }} />;
  }

  const minesPct = (((mines - 1) / Math.max(1, N - 2)) * 100).toFixed(1) + "%";

  return (
    <SpaceRoot>
      <SpaceBackground variant="game" fastDur={7} />

      {/* win flash (wins only — a loss washes the screen with nothing) */}
      <div style={{ position: "absolute", inset: 0, zIndex: 8, pointerEvents: "none", background: "radial-gradient(circle at 50% 50%, rgba(46,230,166,.42), rgba(46,230,166,0) 70%)", opacity: flash.on ? 1 : 0, transition: "opacity .3s ease" }} />

      <SpaceHeader title="MINES" chip={chip} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", gap: 0 }}>

        {/* ── left control panel ── */}
        <SpaceSidebar>
          <SoundButton />
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 2.2vh, 18px)", opacity: lock ? 0.4 : 1, pointerEvents: lock ? "none" : "auto", transition: "opacity .2s ease" }}>
            <BetStepper bet={bet} setBet={setBet} disabled={lock} maxBet={MAX_BET} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SectionLabel>FIELD</SectionLabel>
              <div style={{ display: "flex", gap: 10 }}>
                {GRIDS.map((n) => (
                  <button key={n} onClick={() => setGrid(n)} style={pillStyle(N === n, { flex: 1, minHeight: "clamp(46px, 8vh, 68px)", fontSize: "clamp(16px, 2.6vh, 22px)", letterSpacing: 1 })}>{n}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <SectionLabel>MINES</SectionLabel>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, color: T.win, fontWeight: 700, fontSize: "clamp(19px, 3.1vh, 26px)" }}>
                  <svg viewBox="0 0 24 24" style={{ width: 24, height: 24 }}><polygon points="12,3 20,9.5 12,21 4,9.5" fill="#3ae0a1" /></svg>{N - mines}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, color: T.lose, fontWeight: 700, fontSize: "clamp(19px, 3.1vh, 26px)" }}>
                  <svg viewBox="0 0 24 24" style={{ width: 24, height: 24 }}><circle cx="11" cy="13.5" r="6.5" fill="#ff7a6a" /><path d="M15 8l3-3" stroke="#ff7a6a" strokeWidth="2" strokeLinecap="round" /></svg>{mines}
                </div>
              </div>
              <input type="range" className="mn" min={1} max={N - 1} value={mines}
                onChange={(e) => { if (phase !== "playing") setMines(Math.max(1, Math.min(N - 1, parseInt(e.target.value, 10) | 0))); }}
                style={{ width: "100%", background: `linear-gradient(90deg, #c79a54 0 ${minesPct}, #20283a ${minesPct} 100%)` }} />
            </div>
          </div>
        </SpaceSidebar>

        {/* ── field column ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* readout */}
          <div style={{ position: "relative", zIndex: 4, height: 46, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div ref={readRef} style={{ opacity: readOpacity, transform: "scale(1)", fontSize: readSize, fontWeight: 700, letterSpacing: 3, color: readColor, textShadow: `0 0 28px ${readGlow}`, transition: "opacity .25s ease" }}>{readText}</div>
          </div>

          {/* scattered asteroid field */}
          <div ref={gridRef} style={{ position: "relative", zIndex: 4, flex: 1, minHeight: 140, margin: "4px 34px 10px" }}>
            {tiles.map((t) => (
              <div key={t.i} style={{ position: "absolute", left: t.L.left, top: t.L.top, width: t.size, height: t.size, zIndex: t.z, transform: `translate(-50%,-50%) rotate(${t.L.rot})`, transition: "left .6s ease, top .6s ease", animation: t.wrapAnim }}>
                <button onClick={t.canClick ? () => reveal(t.i) : undefined} className={t.canClick ? "mn-tile" : undefined}
                  style={{ position: "relative", width: "100%", height: "100%", padding: 0, border: "none", background: "transparent", cursor: t.canClick ? "pointer" : "default", outline: "none", animation: `mnFloat ${t.L.dur} ease-in-out infinite`, animationDelay: t.L.delay }}>
                  {/* cover */}
                  <span style={{ position: "absolute", inset: 0, borderRadius: "18%", background: "linear-gradient(180deg,#1c2434,#111823)", border: "2px solid #26314a", boxShadow: "inset 0 2px 0 rgba(255,255,255,.05), 0 6px 16px rgba(0,0,0,.45)", opacity: t.coverOp, transform: `scale(${t.coverScale})`, transition: "opacity .28s ease, transform .3s ease" }} />
                  {/* face */}
                  <span style={{ position: "absolute", inset: 0, borderRadius: "18%", display: "flex", alignItems: "center", justifyContent: "center", background: t.revBg, border: `2px solid ${t.revBorder}`, boxShadow: t.revGlow, opacity: t.faceOp, animation: t.faceAnim }}>
                    <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: t.gemOp }}>{GEM_SVG}</span>
                    <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: t.bombOp }}>{BOMB_SVG}</span>
                  </span>
                </button>
              </div>
            ))}
            {/* reveal bursts */}
            {bursts.map((b) => (
              <div key={b.id} style={{ position: "absolute", left: b.left, top: b.top, width: 0, height: 0, zIndex: 7, pointerEvents: "none" }}>
                <span style={{ position: "absolute", left: 0, top: 0, width: b.ringSize, height: b.ringSize, borderRadius: "50%", border: `3px solid ${b.ring}`, animation: "mnRing .6s ease-out both" }} />
                {b.sparks.map((sp, k) => (
                  <span key={k} style={{ position: "absolute", left: 0, top: 0, transform: `rotate(${sp.rot}) scale(${sp.sc})` }}>
                    <span style={{ position: "absolute", left: 0, top: -2, width: 15, height: 4, borderRadius: 2, background: b.spark, animation: "mnSpark .55s ease-out both" }} />
                  </span>
                ))}
              </div>
            ))}
            {/* rising ×mult pops */}
            {pops.map((pp) => (
              <div key={pp.id} style={{ position: "absolute", left: pp.left, top: pp.top, width: 0, height: 0, zIndex: 8, pointerEvents: "none" }}>
                <span style={{ position: "absolute", left: 0, top: 0, whiteSpace: "nowrap", fontSize: 24, fontWeight: 700, letterSpacing: 2, color: pp.color, textShadow: `0 0 16px ${pp.glow}`, animation: "mnRise .95s ease-out both" }}>{pp.text}</span>
              </div>
            ))}
          </div>

          {/* ── bottom bar ── */}
          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", gap: "clamp(8px, 1vw, 14px)", margin: "0 clamp(10px, 1.6vw, 24px) 20px 10px" }}>
            <button onClick={() => { mnSfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 30px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, backdropFilter: "blur(8px)", color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>LOBBY
            </button>
            <button onClick={() => { mnSfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={{ flex: "none", width: "clamp(56px, 11vh, 88px)", minHeight: "clamp(56px, 11vh, 88px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, backdropFilter: "blur(8px)", color: T.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" /></svg>
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={pickRandom} className="sp-hover-gold"
              style={{ minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2.2vw, 34px)", borderRadius: 20, border: "3px dashed #3a4557", background: T.panelBg, backdropFilter: "blur(8px)", color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer", opacity: lock ? 1 : 0.35, pointerEvents: lock ? "auto" : "none", transition: "all .2s ease" }}>RANDOM</button>
            {primary}
          </div>

        </div>
      </div>

      {rules && <RulesModal onClose={() => setRules(false)} />}
    </SpaceRoot>
  );
}
