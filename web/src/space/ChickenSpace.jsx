// CHICKEN CROSS — space-theme cabinet screen ("Asteroid Run" reskin of the
// lane-crossing game). The road becomes a horizontal run of vertical asteroid
// lanes; a little gold rocket hops one lane right per GO press, each lane's
// ×multiplier tag hangs at the top of its lane and the camera pans after the
// rocket. Asteroids drifting through the lanes are pure decoration — the round
// is SERVER-authoritative: lane outcomes, the multiplier ladder, payouts and
// the balance only ever come from api/routes/chicken.js
// (start / step / cashout / active). Lane position p ↔ server lane cursor p.
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { useBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import SpaceBackground from "./SpaceBackground";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar, SectionLabel,
  GoldButton, SoundButton, BetStepper, pillStyle, T,
} from "./Shell";
import { beep, whoosh, sfx, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import "./space.css";
import "./chicken.css";

const MAX_BET = 500; // platform max bet (МКД, integer steps of 50)

// Display copy of the server's difficulty table (api/lib/games/chicken.js) —
// only used to preview the idle ladder; the server's ladder (operator RTP,
// liability cap) replaces it the moment a round starts.
const DIFFS = {
  easy:      { lanes: 24, death: 0.05, label: "EASY" },
  medium:    { lanes: 22, death: 0.12, label: "MEDIUM" },
  hard:      { lanes: 18, death: 0.24, label: "HARD" },
  daredevil: { lanes: 13, death: 0.45, label: "DAREDEVIL" },
};
const DIFF_KEYS = Object.keys(DIFFS);

function previewLadder(difficulty) {
  const { lanes, death } = DIFFS[difficulty];
  const out = [];
  for (let n = 1; n <= lanes; n++) out.push(Math.floor((0.99 / Math.pow(1 - death, n)) * 100) / 100);
  return out;
}

// Decorative asteroid belt: 2–4 spheres per lane, varied size 18–40px,
// each drifting vertically at its own speed/direction/phase (pure CSS,
// transform-only). Regenerated per round so every run looks fresh.
function makeBelt(N) {
  return Array.from({ length: N }, () => {
    const cnt = 2 + ((Math.random() * 3) | 0);
    return Array.from({ length: cnt }, () => ({
      left: (6 + Math.random() * 68).toFixed(1) + "%",
      size: Math.round(18 + Math.random() * 22),
      dur: (5.5 + Math.random() * 7.5).toFixed(2) + "s",
      delay: (-(Math.random() * 12)).toFixed(2) + "s",
      down: Math.random() < 0.55,
      op: (0.5 + Math.random() * 0.4).toFixed(2),
    }));
  });
}

// Chicken-specific sfx kinds on the shared audio engine.
const chSfx = {
  hop: () => whoosh(500, 2200, 0.09, 0.22),
  // rising landing ping: 430 Hz × 1.05^(lane−1)
  land(p) {
    const base = 430 * Math.pow(1.05, (p || 1) - 1);
    beep("triangle", base, base * 1.5, 0.15, 0.14, 0.02);
    beep("sine", base * 2, base * 3, 0.07, 0.14, 0.05);
  },
  slam: () => whoosh(2600, 300, 0.12, 0.3),
  bet: sfx.bet,
  cash: sfx.cash,
  boom: sfx.boom,
  click: sfx.click,
};

// Little gold rocket, nose right, flickering exhaust (all SVG, ~48px).
function Rocket({ size }) {
  return (
    <svg viewBox="0 0 66 44" style={{ width: size, height: size * 0.68, overflow: "visible", filter: "drop-shadow(0 3px 8px rgba(0,0,0,.5))" }}>
      <defs>
        <linearGradient id="chGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6ecc9" /><stop offset=".55" stopColor="#d9b26a" /><stop offset="1" stopColor="#a9843e" />
        </linearGradient>
      </defs>
      <g className="ch-flame">
        <path d="M14 16 Q-6 22 14 28 Z" fill="#ff9a4a" opacity=".9" />
        <path d="M14 18.5 Q2 22 14 25.5 Z" fill="#ffd36b" />
      </g>
      <rect x="12" y="15" width="5" height="14" rx="2" fill="#7a5e2c" />
      <path d="M20 12 L9 3 L26 9.5 Z" fill="#a9843e" stroke="#7a5e2c" strokeWidth="1" />
      <path d="M20 32 L9 41 L26 34.5 Z" fill="#a9843e" stroke="#7a5e2c" strokeWidth="1" />
      <path d="M16 12.5 Q31 5 44 9.5 Q57 14 63 22 Q57 30 44 34.5 Q31 39 16 31.5 Q19 22 16 12.5 Z" fill="url(#chGold)" stroke="#f6f1e6" strokeWidth="1.6" />
      <circle cx="40" cy="22" r="5.6" fill="#0d1626" stroke="#f6f1e6" strokeWidth="1.6" />
      <circle cx="38.2" cy="20.2" r="1.9" fill="#8cbeff" opacity=".85" />
    </svg>
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
          {row("▸", T.win, "Press GO to hop your rocket one asteroid lane to the right. Every lane cleared raises your multiplier.")}
          {row("●", T.lose, "Any lane can hide a rogue asteroid — get hit and the run is over, the bet is lost.")}
          {row("↑", T.gold, "Cash out any time after the first lane to bank your winnings. Reach the far side and the full ladder pays automatically.")}
          {row("✦", T.gold, "Higher difficulty means deadlier lanes — and a far steeper multiplier ladder.")}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}

export default function ChickenSpace() {
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  // phase: idle → playing → over (win|lose) → idle again on next BET
  const [phase, setPhase] = useState("idle");
  const [difficulty, setDifficulty] = useState("medium");
  const [bet, setBet] = useState(100);
  const [ladder, setLadder] = useState(() => previewLadder("medium")); // display; server's replaces it at start
  const [pos, setPos] = useState(0);              // rocket position: 0 = START pad, p = lane p (server lane cursor)
  const [hopKey, setHopKey] = useState(0);        // retriggers the 300ms hop arc
  const [mult, setMult] = useState(1);            // server multiplier
  const [potential, setPotential] = useState(0);  // server potentialPayout
  const [outcome, setOutcome] = useState(null);   // 'win' | 'lose'
  const [lastWin, setLastWin] = useState(0);      // server payout
  const [road, setRoad] = useState(null);         // full-road deadly flags — only after settle
  const [crashPos, setCrashPos] = useState(-1);   // lane the killer asteroid slams into
  const [crashed, setCrashed] = useState(false);  // rocket spin-out armed
  const [belt, setBelt] = useState(() => makeBelt(DIFFS.medium.lanes));
  const [bursts, setBursts] = useState([]);
  const [pops, setPops] = useState([]);
  const [flash, setFlash] = useState({ on: false, kind: "win" });
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");
  const [field, setField] = useState({ fw: 0, fh: 0 });

  const viewRef = useRef(null);
  const readRef = useRef(null);
  const timers = useRef([]);
  const bid = useRef(0);
  const busyRef = useRef(false);   // one request in flight at a time
  const animRef = useRef(false);   // hop/landing choreography in progress

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // ── mount: ambience + resume a live server round ──────────────────────────
  useEffect(() => {
    armAmbientOnGesture();
    startAmbient();
    let dead = false;
    apiGet("/api/games/chicken/active").then(({ ok, data }) => {
      if (dead || !ok || !data.active) return;
      setDifficulty(data.difficulty);
      setLadder(data.ladder || []);
      setBet(Math.max(50, Math.round(Number(data.betAmount) || 50)));
      setBelt(makeBelt((data.ladder || []).length));
      setPos(data.lane);
      setMult(data.multiplier);
      setPotential(data.potentialPayout ?? 0);
      setRoad(null);
      setCrashPos(-1);
      setCrashed(false);
      setOutcome(null);
      setPhase("playing");
    });
    return () => { dead = true; };
  }, []);

  // ── measure the belt viewport (mines' ResizeObserver idiom) ───────────────
  useEffect(() => {
    const el = viewRef.current;
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

  // ── track geometry (px, from the measured field) ──────────────────────────
  const N = ladder.length;
  const fw = field.fw || 1200, fh = field.fh || 480;
  const laneW = Math.max(88, Math.min(160, Math.round(fh * 0.24)));
  const startW = Math.round(laneW * 1.2);
  const trackW = startW + N * laneW;
  const rocketSize = Math.round(laneW * 0.52);
  const posX = useCallback((p) => (p === 0 ? startW * 0.5 : startW + (p - 1) * laneW + laneW / 2), [startW, laneW]);
  const rocketX = posX(pos);
  // camera: keep the rocket ~40% in; center the whole track when it fits
  const camera = trackW <= fw ? (trackW - fw) / 2 : Math.max(0, Math.min(rocketX - fw * 0.4, trackW - fw));

  // ── choreography helpers ──────────────────────────────────────────────────
  const burst = useCallback((x, kind) => {
    const id = ++bid.current;
    const cnt = kind === "boom" ? 10 : 7;
    const sparks = Array.from({ length: cnt }, (_, k) => ({ rot: Math.round(k * 360 / cnt + Math.random() * 34) + "deg", sc: (0.7 + Math.random() * 0.8).toFixed(2) }));
    const b = { id, x, sparks, ring: kind === "boom" ? "#ff8a6a" : "#7ef0c0", spark: kind === "boom" ? "#ffb08a" : "#8df0c8", ringSize: kind === "boom" ? 140 : 96 };
    setBursts((bs) => bs.concat(b));
    later(() => setBursts((bs) => bs.filter((v) => v.id !== id)), 950);
  }, []);

  const popMult = useCallback((x, text, color, glow) => {
    const id = ++bid.current;
    setPops((ps) => ps.concat({ id, x, text, color, glow }));
    later(() => setPops((ps) => ps.filter((v) => v.id !== id)), 1000);
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
    if (balance < 50) return;
    const stake = Math.min(bet, MAX_BET, Math.floor(balance));
    const data = await post("/api/games/chicken/start", { betAmount: stake, difficulty });
    if (!data) return;
    setBet(stake);
    setLadder(data.ladder);
    setBelt(makeBelt(data.ladder.length));
    setPos(0);
    setMult(1);
    setPotential(0);
    setOutcome(null);
    setLastWin(0);
    setRoad(null);
    setCrashPos(-1);
    setCrashed(false);
    setBursts([]);
    setPops([]);
    setPhase("playing");
    chSfx.bet();
  }

  async function go() {
    if (phase !== "playing" || busyRef.current || animRef.current) return;
    const data = await post("/api/games/chicken/step");
    if (!data) return;
    animRef.current = true;
    const target = data.lane; // lane position hopped into (server lane cursor)
    const tx = posX(target);
    setPos(target);
    setHopKey((k) => k + 1);
    chSfx.hop();

    if (!data.won) {
      // bust — the rocket lands in the deadly lane, then the asteroid slams it
      later(() => { setCrashPos(target); chSfx.slam(); }, 300);
      later(() => {
        animRef.current = false;
        setCrashed(true);
        setPhase("over");
        setOutcome("lose");
        setLastWin(0);
        setRoad(data.lanes.map((l) => l.deadly)); // full-road reveal from the response
        chSfx.boom();
        doFlash("lose");
        burst(tx, "boom");
      }, 620);
      return;
    }

    // safe landing (server multiplier drives readout, pop, potential payout)
    later(() => {
      animRef.current = false;
      setMult(data.multiplier);
      if (data.potentialPayout != null) setPotential(data.potentialPayout);
      chSfx.land(target);
      popRead();
      burst(tx, "safe");
      popMult(tx, "×" + data.multiplier.toFixed(2), "#7ef0c0", "rgba(46,230,166,.6)");
    }, 300);
    if (data.top) {
      // far side of the belt — the server auto-settled as cashed_out
      later(() => {
        setPhase("over");
        setOutcome("win");
        setLastWin(data.payout);
        setRoad(data.lanes.map((l) => l.deadly));
        chSfx.cash();
        doFlash("win");
      }, 900);
    }
  }

  async function cashOut() {
    if (phase !== "playing" || busyRef.current || animRef.current || pos < 1) return;
    const data = await post("/api/games/chicken/cashout");
    if (!data) return;
    setPhase("over");
    setOutcome("win");
    setLastWin(data.payout);
    setMult(data.multiplier);
    setRoad(data.lanes.map((l) => l.deadly));
    chSfx.cash();
    doFlash("win");
  }

  function pickDifficulty(d) {
    if (phase === "playing" || d === difficulty) return;
    setDifficulty(d);
    setLadder(previewLadder(d));
    setBelt(makeBelt(DIFFS[d].lanes));
    setPos(0);
    setOutcome(null);
    setRoad(null);
    setCrashPos(-1);
    setCrashed(false);
    setPhase("idle");
    chSfx.click();
  }

  // ── derived render values ─────────────────────────────────────────────────
  const lock = phase === "playing";
  const over = phase === "over";
  const nextMult = pos < N ? ladder[pos] : null;

  // readout line — server errors take it over, in red
  let readText = "", readColor = T.muted, readGlow = "rgba(0,0,0,0)", readOpacity = 1, readSize = 26;
  if (error) { readText = error.toUpperCase(); readColor = "#ff6a5a"; readGlow = "rgba(255,90,74,.55)"; }
  else if (phase === "idle") { readText = "PRESS BET TO START"; readOpacity = 0.8; }
  else if (lock) { readText = "×" + mult.toFixed(2); readColor = T.gold; readGlow = "rgba(240,217,154,.5)"; readSize = 34; }
  else if (over) {
    readSize = 34;
    if (outcome === "win") { readText = "WIN +" + fmtMKD(lastWin); readColor = T.win; readGlow = "rgba(46,230,166,.5)"; }
    else { readText = "SMASHED"; readColor = "#ff6a5a"; readGlow = "rgba(255,90,74,.55)"; }
  }

  // header status chip
  const chip = lock
    ? { label: "× " + mult.toFixed(2), color: T.gold }
    : over
      ? (outcome === "win" ? { label: "WIN " + fmtMKD(lastWin), color: T.win } : { label: "BUST", color: "#ff6a5a" })
      : { label: "READY", color: T.text2 };

  // primary buttons — dual-primary while running (CASH OUT + GO)
  const canBet = balance >= 50;
  const primary = lock ? (
    <>
      <GoldButton label="CASH OUT" sub={pos >= 1 ? fmtMKD(potential) : "CROSS 1 LANE"} onClick={cashOut} disabled={pos < 1}
        labelSize="clamp(18px, 1.8vw, 27px)" style={{ flex: "none", minWidth: "clamp(170px, 18vw, 280px)", borderRadius: 22 }} />
      <GoldButton label="GO" sub={nextMult != null ? "NEXT ×" + nextMult.toFixed(2) : ""} onClick={go}
        labelSize="clamp(24px, 2.5vw, 36px)" style={{ flex: "none", minWidth: "clamp(180px, 20vw, 300px)", borderRadius: 22 }} />
    </>
  ) : (
    <GoldButton label="BET" sub={fmtMKD(Math.min(bet, Math.max(50, Math.floor(balance) || 50)))} onClick={startBet} disabled={!canBet}
      labelSize="clamp(21px, 2.2vw, 32px)" style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 }} />
  );

  return (
    <SpaceRoot>
      <SpaceBackground variant="game" fastDur={7} />

      {/* win/lose flash */}
      <div style={{ position: "absolute", inset: 0, zIndex: 8, pointerEvents: "none", background: flash.kind === "lose" ? "radial-gradient(circle at 50% 50%, rgba(255,60,50,.5), rgba(255,60,50,0) 70%)" : "radial-gradient(circle at 50% 50%, rgba(46,230,166,.42), rgba(46,230,166,0) 70%)", opacity: flash.on ? 1 : 0, transition: "opacity .3s ease" }} />

      <SpaceHeader title="CHICKEN CROSS" chip={chip} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", gap: 0 }}>

        {/* ── left control panel ── */}
        <SpaceSidebar>
          <SoundButton />
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 2.2vh, 18px)", opacity: lock ? 0.4 : 1, pointerEvents: lock ? "none" : "auto", transition: "opacity .2s ease" }}>
            <BetStepper bet={bet} setBet={setBet} disabled={lock} maxBet={MAX_BET} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SectionLabel>DIFFICULTY</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {DIFF_KEYS.map((d) => (
                  <button key={d} onClick={() => pickDifficulty(d)}
                    style={pillStyle(difficulty === d, { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minHeight: "clamp(46px, 8vh, 68px)", padding: "4px 2px", fontSize: "clamp(12px, 2vh, 16px)", letterSpacing: 1 })}>
                    <span>{DIFFS[d].label}</span>
                    <span style={{ fontSize: "clamp(9px, 1.5vh, 12px)", letterSpacing: 1, opacity: 0.7 }}>{DIFFS[d].lanes} LANES · {Math.round(DIFFS[d].death * 100)}%</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SpaceSidebar>

        {/* ── field column ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* readout */}
          <div style={{ position: "relative", zIndex: 4, height: 46, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div ref={readRef} style={{ opacity: readOpacity, transform: "scale(1)", fontSize: readSize, fontWeight: 700, letterSpacing: 3, color: readColor, textShadow: `0 0 28px ${readGlow}`, transition: "opacity .25s ease" }}>{readText}</div>
          </div>

          {/* asteroid-belt viewport (camera pans the track after the rocket) */}
          <div ref={viewRef} style={{ position: "relative", zIndex: 4, flex: 1, minHeight: 140, margin: "4px 24px 10px 10px", overflow: "hidden", WebkitMaskImage: "linear-gradient(90deg, transparent 0, #000 22px, #000 calc(100% - 22px), transparent)", maskImage: "linear-gradient(90deg, transparent 0, #000 22px, #000 calc(100% - 22px), transparent)", animation: over && outcome === "lose" ? "chQuake .55s ease" : "none" }}>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: trackW, transform: `translateX(${-camera}px)`, transition: "transform .45s cubic-bezier(.25,.8,.3,1)" }}>

              {/* START pad */}
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: startW }}>
                <span style={{ position: "absolute", left: "50%", top: "50%", width: laneW * 0.78, height: laneW * 0.78, borderRadius: "50%", border: "2px dashed rgba(240,217,154,.4)", animation: "chPadSpin 24s linear infinite" }} />
                <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%) translateY(" + Math.round(laneW * 0.34) + "px)", width: laneW * 0.62, height: laneW * 0.15, borderRadius: "50%", background: "radial-gradient(ellipse at 50% 40%, rgba(240,217,154,.28), rgba(169,132,62,.1) 70%, transparent)", border: "1px solid rgba(217,178,106,.35)" }} />
                <span style={{ position: "absolute", left: "50%", bottom: 12, transform: "translateX(-50%)", fontSize: "clamp(10px, 1.7vh, 13px)", fontWeight: 700, letterSpacing: 4, color: T.muted }}>START</span>
              </div>

              {/* lanes */}
              {ladder.map((m, i) => {
                const p = i + 1; // lane position
                const passed = p <= pos;
                const target = lock && p === pos + 1;
                const deadly = road ? road[i] : false;
                const dist = Math.abs(p - pos);
                let tagColor = T.muted, tagBorder = "rgba(93,106,128,.35)", tagBg = "rgba(10,14,22,.6)", tagAnim = "none", tagShadow = "none";
                if (passed) { tagColor = T.gold; tagBorder = "rgba(217,178,106,.55)"; tagBg = "rgba(217,178,106,.14)"; }
                if (target) { tagColor = "#ffe9ad"; tagBorder = T.accent; tagBg = "rgba(217,178,106,.22)"; tagAnim = "chPulse 1.4s ease-in-out infinite"; tagShadow = "0 0 18px rgba(240,217,154,.35)"; }
                if (over && deadly) { tagColor = T.lose; tagBorder = "rgba(255,122,106,.5)"; tagBg = "rgba(255,90,74,.12)"; }
                return (
                  <div key={i} style={{ position: "absolute", left: startW + i * laneW, top: 0, bottom: 0, width: laneW, overflow: "hidden", borderLeft: "1px dashed rgba(138,148,168,.16)", borderRight: i === N - 1 ? "1px dashed rgba(138,148,168,.16)" : "none", background: over && deadly ? "linear-gradient(180deg, rgba(255,90,74,.07), rgba(255,90,74,.03) 50%, rgba(255,90,74,.07))" : target ? "linear-gradient(180deg, rgba(240,217,154,.06), rgba(240,217,154,.02) 50%, rgba(240,217,154,.06))" : "linear-gradient(180deg, rgba(255,255,255,.028), rgba(255,255,255,.012) 50%, rgba(255,255,255,.028))", transition: "background .3s ease" }}>
                    {/* drifting decorative asteroids */}
                    {(belt[i] || []).map((a, k) => (
                      <span key={k} className="ch-ast" style={{ left: a.left, top: -48, width: a.size, height: a.size, opacity: a.op, animation: `${a.down ? "chDriftDown" : "chDriftUp"} ${a.dur} linear infinite`, animationDelay: a.delay }} />
                    ))}
                    {/* ×multiplier tag */}
                    <span style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", padding: "5px clamp(6px, .7vw, 12px)", borderRadius: 20, border: `2px solid ${tagBorder}`, background: tagBg, fontSize: "clamp(11px, 1.9vh, 16px)", fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap", color: tagColor, boxShadow: tagShadow, animation: tagAnim, transition: "color .3s ease, border-color .3s ease, background .3s ease", zIndex: 4 }}>×{m.toFixed(2)}</span>
                    {/* end-of-round road reveal (distance-staggered) */}
                    {over && road && deadly && p !== crashPos && (
                      <span className="ch-ast ch-ast-killer" style={{ left: "50%", top: "50%", width: laneW * 0.34, height: laneW * 0.34, transform: "translate(-50%,-50%)", animation: `chReveal .45s ease ${dist * 55}ms both` }} />
                    )}
                    {over && road && !deadly && p > pos && (
                      <span style={{ position: "absolute", left: "50%", top: "50%", width: 10, height: 10, borderRadius: "50%", background: "rgba(58,224,161,.5)", boxShadow: "0 0 10px rgba(58,224,161,.4)", animation: `chReveal .45s ease ${dist * 55}ms both` }} />
                    )}
                  </div>
                );
              })}

              {/* killer asteroid slams the rocket's lane */}
              {crashPos > 0 && (
                <span className="ch-ast ch-ast-killer" style={{ left: posX(crashPos), top: "50%", width: Math.round(laneW * 0.56), height: Math.round(laneW * 0.56), zIndex: 6, animation: "chSlam .3s cubic-bezier(.5,0,.9,.4) both" }} />
              )}

              {/* the rocket (hop arc keyed per lane; spin-out on crash) */}
              <div style={{ position: "absolute", left: rocketX, top: "50%", width: 0, height: 0, zIndex: 5, transition: "left .3s cubic-bezier(.3,.9,.4,1)" }}>
                <div key={hopKey} style={{ position: "absolute", left: 0, top: 0, transform: "translate(-50%,-50%)", animation: hopKey > 0 ? "chHop .3s ease both" : "none" }}>
                  <div style={{ animation: crashed ? "chSpinOut .9s ease-in both" : "chFloat 3s ease-in-out infinite" }}>
                    <Rocket size={rocketSize} />
                  </div>
                </div>
              </div>

              {/* landing / crash bursts */}
              {bursts.map((b) => (
                <div key={b.id} style={{ position: "absolute", left: b.x, top: "50%", width: 0, height: 0, zIndex: 7, pointerEvents: "none" }}>
                  <span style={{ position: "absolute", left: 0, top: 0, width: b.ringSize, height: b.ringSize, borderRadius: "50%", border: `3px solid ${b.ring}`, animation: "chRing .6s ease-out both" }} />
                  {b.sparks.map((sp, k) => (
                    <span key={k} style={{ position: "absolute", left: 0, top: 0, transform: `rotate(${sp.rot}) scale(${sp.sc})` }}>
                      <span style={{ position: "absolute", left: 0, top: -2, width: 15, height: 4, borderRadius: 2, background: b.spark, animation: "chSpark .55s ease-out both" }} />
                    </span>
                  ))}
                </div>
              ))}
              {/* rising ×mult pops */}
              {pops.map((pp) => (
                <div key={pp.id} style={{ position: "absolute", left: pp.x, top: "38%", width: 0, height: 0, zIndex: 8, pointerEvents: "none" }}>
                  <span style={{ position: "absolute", left: 0, top: 0, whiteSpace: "nowrap", fontSize: 24, fontWeight: 700, letterSpacing: 2, color: pp.color, textShadow: `0 0 16px ${pp.glow}`, animation: "chRise .95s ease-out both" }}>{pp.text}</span>
                </div>
              ))}

            </div>
          </div>

          {/* ── bottom bar ── */}
          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", gap: "clamp(8px, 1vw, 14px)", margin: "0 clamp(10px, 1.6vw, 24px) 20px 10px" }}>
            <button onClick={() => { chSfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 30px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, backdropFilter: "blur(8px)", color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>LOBBY
            </button>
            <button onClick={() => { chSfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={{ flex: "none", width: "clamp(56px, 11vh, 88px)", minHeight: "clamp(56px, 11vh, 88px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, backdropFilter: "blur(8px)", color: T.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
