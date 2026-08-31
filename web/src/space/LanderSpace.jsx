// STAR LANDER — the gravity crash game, built to the design handoff
// (design_handoff_star_lander). The player bets and presses LAUNCH; the ship
// flies fully autonomously — no cashout. Gravity sinks it, gems boost it and
// grow the counter, plasma mines halve the counter and shove it down. Reach
// the docking station and the counter pays; touch the void and the bet is
// lost. THE OUTCOME IS EMERGENT FROM PHYSICS: the server draws the event map
// from the provably-fair chain and settles by running the exact simulation
// this screen replays (landerPhysics.js — the client copy of the server's
// module). Speed modes change how many fixed steps play per frame, never the
// steps themselves, so every speed shows the identical flight.
//
// Rendering follows the handoff's performance rules: every repeated visual
// is pre-rendered to an offscreen sprite at 2x and blitted — no per-frame
// gradients or shadowBlur; DPR capped at 1.5; particle cap 260.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost, apiGet } from "../api";
import { useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import { beep, whoosh, boomNoise, sfx, useVol, cycleVol, VOL_LABELS, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import { bnMusic } from "./bnMusic";
import { useMaxBet } from "./limits";
import { createSim, PHYS } from "./landerPhysics";
import { createLanderScene } from "./landerSceneGL";
import "./space.css";
import "./lander.css";

// the old top speed IS the normal pace now — the ladder only goes faster
const SPEED_FAC = [2.2, 3.2, 4.2, 5.5];
const SPEED_LABELS = ["›", "››", "›››", "››››"];
const GEM_COLOR = { "+1": "#3ae0a1", "+2": "#7fb1ff", x2: "#f0d99a", x3: "#ffb08a", x5: "#e08cff" };
const TIERS = [
  { at: 20, label: "BIG WIN", color: "#f0d99a", coins: 20 },
  { at: 40, label: "MEGA WIN", color: "#7ef0c0", coins: 30 },
  { at: 80, label: "COSMIC WIN", color: "#e08cff", coins: 44 },
];

// ── sprite factory: everything repeated is baked once at 2x ────────────────
function makeSprites() {
  const mk = (w, h, draw) => {
    const c = document.createElement("canvas");
    c.width = w * 2; c.height = h * 2;
    const g = c.getContext("2d");
    g.scale(2, 2);
    draw(g, w, h);
    return c;
  };
  const S = {};

  S.gem = {};
  for (const [t, col] of Object.entries(GEM_COLOR)) {
    S.gem[t] = mk(72, 72, (g, w, h) => {
      const cx = w / 2, cy = h / 2;
      const glow = g.createRadialGradient(cx, cy, 4, cx, cy, 34);
      glow.addColorStop(0, col + "55"); glow.addColorStop(1, col + "00");
      g.fillStyle = glow; g.fillRect(0, 0, w, h);
      g.translate(cx, cy);
      g.fillStyle = col;
      g.beginPath(); g.moveTo(0, -15); g.lineTo(13, 0); g.lineTo(0, 15); g.lineTo(-13, 0); g.closePath(); g.fill();
      g.fillStyle = "rgba(255,255,255,.5)";
      g.beginPath(); g.moveTo(0, -15); g.lineTo(13, 0); g.lineTo(0, -2); g.closePath(); g.fill();
      g.strokeStyle = "rgba(255,255,255,.75)"; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(0, -15); g.lineTo(13, 0); g.lineTo(0, 15); g.lineTo(-13, 0); g.closePath(); g.stroke();
    });
  }

  S.mine = mk(80, 80, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const warn = g.createRadialGradient(cx, cy, 6, cx, cy, 38);
    warn.addColorStop(0, "rgba(255,80,60,.4)"); warn.addColorStop(1, "rgba(255,80,60,0)");
    g.fillStyle = warn; g.fillRect(0, 0, w, h);
    g.translate(cx, cy);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const sg = g.createLinearGradient(0, 0, Math.cos(a) * 22, Math.sin(a) * 22);
      sg.addColorStop(0, "#5a3038"); sg.addColorStop(1, "#ff6a55");
      g.strokeStyle = sg; g.lineWidth = 4; g.lineCap = "round";
      g.beginPath(); g.moveTo(Math.cos(a) * 10, Math.sin(a) * 10); g.lineTo(Math.cos(a) * 21, Math.sin(a) * 21); g.stroke();
      g.fillStyle = "#ffd9a0";
      g.beginPath(); g.arc(Math.cos(a) * 21, Math.sin(a) * 21, 1.8, 0, 7); g.fill();
    }
    const body = g.createRadialGradient(-4, -5, 2, 0, 0, 14);
    body.addColorStop(0, "#7c4a52"); body.addColorStop(0.6, "#4a262e"); body.addColorStop(1, "#2c161c");
    g.fillStyle = body; g.beginPath(); g.arc(0, 0, 13, 0, 7); g.fill();
    g.strokeStyle = "rgba(0,0,0,.4)"; g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, 13, 0.3, 2.8); g.stroke();
    const core = g.createRadialGradient(0, 0, 0, 0, 0, 6);
    core.addColorStop(0, "#ff9c86"); core.addColorStop(1, "#e0301a");
    g.fillStyle = core; g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill();
  });

  S.pad = mk(200, 60, (g) => {
    const grad = g.createLinearGradient(0, 8, 0, 26);
    grad.addColorStop(0, "#3a4557"); grad.addColorStop(0.5, "#232c3d"); grad.addColorStop(1, "#12182a");
    g.fillStyle = grad; g.fillRect(0, 8, 200, 18);
    g.fillStyle = "#d9b26a"; g.fillRect(0, 8, 200, 1.5);
    const py = g.createLinearGradient(0, 26, 0, 58);
    py.addColorStop(0, "rgba(26,32,48,.9)"); py.addColorStop(1, "rgba(26,32,48,0)");
    g.fillStyle = py; g.fillRect(84, 26, 32, 32);
  });

  S.halo = mk(240, 90, (g, w, h) => {
    const e = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, 100);
    e.addColorStop(0, "rgba(122,240,192,.35)"); e.addColorStop(1, "rgba(122,240,192,0)");
    g.fillStyle = e;
    g.save(); g.translate(w / 2, h / 2); g.scale(1, 0.34); g.beginPath(); g.arc(0, 0, 100, 0, 7); g.fill(); g.restore();
  });

  S.neb = ["150,110,255", "80,150,255"].map((c) => mk(200, 200, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, 95);
    r.addColorStop(0, `rgba(${c},.16)`); r.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  }));

  S.coin = mk(18, 18, (g, w, h) => {
    const r = g.createRadialGradient(6, 6, 1, w / 2, h / 2, 8);
    r.addColorStop(0, "#fdf3d0"); r.addColorStop(0.55, "#f0d99a"); r.addColorStop(1, "#a9843e");
    g.fillStyle = r; g.beginPath(); g.arc(w / 2, h / 2, 8, 0, 7); g.fill();
    g.strokeStyle = "rgba(120,90,30,.8)"; g.lineWidth = 1; g.beginPath(); g.arc(w / 2, h / 2, 6, 0, 7); g.stroke();
  });

  S.puff = mk(24, 24, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, 11);
    r.addColorStop(0, "rgba(255,190,120,.55)"); r.addColorStop(1, "rgba(255,140,60,0)");
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });

  return S;
}

export default function LanderSpace() {
  const navigate = useNavigate();
  const balance = useBalance();
  const vol = useVol();
  const MAX_BET = useMaxBet("lander");

  const [phase, setPhase] = useState("idle");     // idle | flying | landed | crashed
  const [bet, setBet] = useState(100);
  const [speed, setSpeed] = useState(0);
  const [auto, setAuto] = useState(0);            // 0 off | 10 | Infinity
  const [autoLeft, setAutoLeft] = useState(0);
  const [stopWin, setStopWin] = useState(0);      // autoplay stop: win >= X (0 = off)
  const [stopBal, setStopBal] = useState(0);      // autoplay stop: balance < Y (0 = off)
  const [counter, setCounter] = useState(1);
  const [overlay, setOverlay] = useState(null);   // { tier, amount, mult } | { lost: true }
  const [lastWin, setLastWin] = useState(null);
  const [rules, setRules] = useState(false);
  const [shake, setShake] = useState(0);
  const [error, setError] = useState("");

  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const glRef = useRef(null);      // PixiJS scene when WebGL is available; null → Canvas2D draw()
  const spritesRef = useRef(null);
  const simRef = useRef(null);
  const serverRef = useRef(null);
  const betRef = useRef(100);
  const phaseRef = useRef("idle");
  phaseRef.current = phase;
  const speedRef = useRef(1);
  speedRef.current = speed;
  const rulesRef = useRef(false);
  rulesRef.current = rules;
  const accRef = useRef(0);
  const fxRef = useRef([]);
  const trailRef = useRef([]);
  const nebRef = useRef([]);
  const angRef = useRef(0);
  const popRef = useRef(0);
  const comboRef = useRef(0);
  const timeRef = useRef(0);
  const dprRef = useRef(1);
  const gradRef = useRef(null);
  const deadRef = useRef(false);
  const heldRef = useRef(false);
  const timers = useRef([]);
  const runRef = useRef(null);
  const autoRef = useRef({ mode: 0, left: 0 });
  const balanceRef = useRef(0);
  balanceRef.current = balance;
  const stopRef = useRef({ win: 0, bal: 0 });
  stopRef.current = { win: stopWin, bal: stopBal };

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  const hold = () => { if (!heldRef.current) { heldRef.current = true; holdBalance(); } };
  const release = () => { if (heldRef.current) { heldRef.current = false; releaseBalance(); } };

  const lnSfx = {
    click: sfx.click,
    launch() { whoosh(140, 880, 0.4, 0.7); boomNoise(0.25, 0.5, 900, 160); },
    pick() { const f = 660 * Math.pow(1.06, Math.min(comboRef.current, 14)); beep("triangle", f, f * 1.4, 0.07, 0.18); },
    boom() { boomNoise(0.4, 0.5, 1600, 140); beep("sawtooth", 320, 60, 0.2, 0.45); },
    lose() { whoosh(500, 60, 0.35, 0.9); beep("sine", 150, 45, 0.25, 0.9); },
    win(mult) {
      if (mult >= 40) { bnMusic.bigWin(); sfx.cash(); }
      else if (mult >= 20) { bnMusic.fanfare(); sfx.cash(); }
      else { sfx.cash(); beep("triangle", 520, 1100, 0.15, 0.3); }
    },
  };

  // ── the flight loop ──────────────────────────────────────────────────────
  useEffect(() => {
    deadRef.current = false;
    armAmbientOnGesture(); startAmbient();
    spritesRef.current = makeSprites();
    nebRef.current = Array.from({ length: 8 }, (_, i) => ({
      x: (i * 953) % 5000, yf: 0.08 + ((i * 37) % 60) / 100, r: 60 + ((i * 91) % 150), v: i % 2,
    }));

    const cv = canvasRef.current;
    const ctx = cv.getContext("2d");
    let raf = 0, last = performance.now(), skip = 0;

    const fit = () => {
      const r = wrapRef.current.getBoundingClientRect();
      // one dpr for everyone (7 call sites read this ref). The backing store
      // is clamped to ~2.2MP: a 4K panel would otherwise clear+paint 6.6MP a
      // frame AND cross the size at which Gecko stops accelerating a 2D
      // canvas, which drops the whole draw loop onto software Skia.
      let dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const px = r.width * r.height * dpr * dpr;
      if (px > 2.2e6) dpr *= Math.sqrt(2.2e6 / px);
      dprRef.current = dpr;
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      cv.style.width = r.width + "px";
      cv.style.height = r.height + "px";
      glRef.current?.fit();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrapRef.current);

    // WebGL scene renderer (PixiJS) with the Canvas2D draw() as fallback.
    // Init is async: `glCancelled` guards the StrictMode double-mount and
    // unmount races — a scene resolving after cleanup is destroyed on the
    // spot and never referenced.
    let glCancelled = false;
    createLanderScene({
      wrap: wrapRef.current,
      sprites: spritesRef.current,
      phys: PHYS,
      gemColor: GEM_COLOR,
      fmtMoney: fmtMKD,
      onLost() {
        // permanent runtime context loss (driver reset that never restores):
        // drop the dead scene and give the frame loop back to Canvas2D draw()
        const scene = glRef.current;
        glRef.current = null;
        scene?.destroy();
        cv.style.display = ""; // re-show the fallback surface, kept fit() all along
        window.__lnRenderer = "canvas2d";
      },
    }).then((scene) => {
      if (glCancelled || deadRef.current) { scene.destroy(); return; }
      glRef.current = scene;
      cv.style.display = "none"; // 2D canvas stays in the DOM as the fallback surface
      scene.fit(); // a wrap resize during the async init fired while glRef was null — re-read the rect
      if (simRef.current) scene.setMap(simRef.current); // round launched before init resolved
      window.__lnRenderer = "webgl";
    }).catch(() => {
      window.__lnRenderer = "canvas2d"; // no WebGL — the 2D path was never touched
    });

    // reused frame-state object: render() must see zero per-frame allocations
    const fr = { sim: null, time: 0, ang: 0, pop: 0, phase: "idle", bet: 0, fx: null, trail: null };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      timeRef.current += dt;
      step(dt);
      // nothing moves between flights (and behind the rules card) except
      // slow ambience — draw those frames at a fraction of refresh rate
      const calm = (phaseRef.current !== "flying" && fxRef.current.length === 0 && trailRef.current.length === 0) || rulesRef.current;
      skip = calm ? (skip + 1) % 4 : 0;
      if (skip === 0) {
        const gl = glRef.current;
        if (gl) {
          fr.sim = simRef.current; fr.time = timeRef.current; fr.ang = angRef.current;
          fr.pop = popRef.current; fr.phase = phaseRef.current; fr.bet = betRef.current;
          fr.fx = fxRef.current; fr.trail = trailRef.current;
          gl.render(fr);
        } else {
          draw(ctx, cv, dt);
        }
      }
    };
    raf = requestAnimationFrame(frame);

    const down = (e) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      if (!e.repeat && runRef.current) runRef.current();
    };
    window.addEventListener("keydown", down);
    apiGet("/api/games/lander/table").catch(() => {});

    return () => {
      deadRef.current = true;
      glCancelled = true;
      glRef.current?.destroy();
      glRef.current = null;
      cv.style.display = ""; // give the fallback canvas back to a future mount
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", down);
      timers.current.forEach(clearTimeout);
      release();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // fixed-step consumption: speed scales HOW MANY steps, never the step
  const step = (dt) => {
    popRef.current *= Math.exp(-4.5 * dt);
    // particles
    const fx = [];
    for (const f of fxRef.current) {
      f.t += dt;
      if (f.kind === "spark" || f.kind === "coin") { f.vy += (f.kind === "coin" ? 900 : 620) * dt; f.x += f.vx * dt; f.y += f.vy * dt; }
      if (f.t < f.life) fx.push(f);
    }
    if (fx.length > 260) fx.splice(0, fx.length - 260);
    fxRef.current = fx;
    const tr = [];
    for (const p of trailRef.current) { p.t += dt; p.x -= p.drift * dt; if (p.t < p.life) tr.push(p); }
    trailRef.current = tr;

    const sim = simRef.current;
    if (phaseRef.current !== "flying" || !sim || rulesRef.current) return;

    accRef.current += dt * SPEED_FAC[speedRef.current];
    const cv = canvasRef.current;
    const scale = cv.height / dprRef.current / PHYS.H;
    while (accRef.current >= PHYS.DT && !sim.S.over) {
      accRef.current -= PHYS.DT;
      const hit = sim.step();
      if (hit) onHit(hit, scale);
    }
    // cosmetic pitch + engine trail (real-time, not sim-time)
    const tAng = Math.atan2(sim.S.vy * 0.55, 300);
    angRef.current += (tAng - angRef.current) * Math.min(1, dt * 9);
    const w = cv.width / dprRef.current;
    if (Math.random() < 0.55) {
      trailRef.current.push({
        x: w * 0.3 - 26 * Math.cos(angRef.current),
        y: sim.S.y * scale - 26 * Math.sin(angRef.current),
        t: 0, life: 0.4 + Math.random() * 0.25,
        drift: 300 * SPEED_FAC[speedRef.current] * scale * 0.9,
        r: 3 + Math.random() * 3,
      });
    }
    if (sim.S.over) settle();
  };

  const onHit = (hit, scale) => {
    const cv = canvasRef.current;
    const w = cv.width / dprRef.current;
    const sx = w * 0.3 + (hit.e.x - simRef.current.S.wx) * scale;
    const sy = hit.ey * scale;
    setCounter(hit.counter);
    popRef.current = 1;
    if (hit.e.kind === "pick") {
      comboRef.current++;
      lnSfx.pick();
      const col = GEM_COLOR[hit.e.t];
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * 6.28, sp = 90 + Math.random() * 180;
        fxRef.current.push({ kind: "spark", x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, t: 0, life: 0.5 + Math.random() * 0.4, col });
      }
      fxRef.current.push({ kind: "pop", x: sx, y: sy - 10, t: 0, life: 0.9, text: hit.e.t.replace("x", "×"), col });
    } else {
      comboRef.current = 0;
      lnSfx.boom();
      fxRef.current.push({ kind: "ring", x: sx, y: sy, t: 0, life: 0.5 });
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * 6.28, sp = 140 + Math.random() * 260;
        fxRef.current.push({ kind: "spark", x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.5 + Math.random() * 0.5, col: i % 3 ? "#ff7a5a" : "#ffd9a0" });
      }
      fxRef.current.push({ kind: "pop", x: sx, y: sy - 14, t: 0, life: 1, text: "÷2", col: "#ff7a6a" });
      setShake(1);
      later(() => setShake(0), 500);
    }
  };

  const settle = () => {
    const sim = simRef.current, server = serverRef.current;
    // the server's settlement is authority; the sim should agree to the bit
    if (server && (sim.S.landed !== server.landed || Math.abs(sim.S.counter - server.counter) > 0.005)) {
      console.warn("lander: client sim diverged from server", sim.S, server);
      sim.S.landed = server.landed; sim.S.counter = server.counter;
    }
    const landed = server ? server.landed : sim.S.landed;
    const mult = server ? server.multiplier : (sim.S.landed ? sim.S.counter : 0);
    const payout = server ? server.payout : 0;
    const bet = betRef.current;
    const cv = canvasRef.current;
    const w = cv.width / dprRef.current;
    const scale = cv.height / dprRef.current / PHYS.H;
    const sy = sim.S.y * scale;

    if (landed) {
      setPhase("landed");
      setLastWin(payout);
      lnSfx.win(mult);
      const tier = [...TIERS].reverse().find((t) => mult >= t.at) || null;
      for (let i = 0; i < 16; i++) {
        const a = -Math.random() * 3.14, sp = 120 + Math.random() * 240;
        fxRef.current.push({ kind: "spark", x: w * 0.3, y: sy + 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.7 + Math.random() * 0.5, col: ["#f0d99a", "#7ef0c0", "#a8c8ff"][i % 3] });
      }
      if (tier) {
        setOverlay({ tier: tier.label, color: tier.color, amount: fmtMKD(payout), mult });
        setShake(2);
        later(() => setShake(0), 600);
        for (let i = 0; i < tier.coins; i++) {
          fxRef.current.push({ kind: "coin", x: w * (0.2 + Math.random() * 0.6), y: -20 - Math.random() * 160, vx: (Math.random() - 0.5) * 60, vy: 60 + Math.random() * 120, t: 0, life: 2.2 + Math.random() * 0.8 });
        }
      }
    } else {
      setPhase("crashed");
      setLastWin(0);
      lnSfx.lose();
      setOverlay({ lost: true });
      fxRef.current.push({ kind: "ring", x: w * 0.3, y: sy, t: 0, life: 0.6 });
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * 6.28, sp = 120 + Math.random() * 260;
        fxRef.current.push({ kind: "spark", x: w * 0.3, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.6 + Math.random() * 0.5, col: i % 3 ? "#ff7a5a" : "#8a94a8" });
      }
    }

    const holdMs = landed && mult >= 20 ? 3000 : 1800;
    later(() => {
      if (deadRef.current) return;
      setOverlay(null);
      setPhase("idle");
      simRef.current = null;
      glRef.current?.setMap(null);
      release();
      // autoplay: relaunch 700ms later unless a stop condition fires
      const A = autoRef.current, ST = stopRef.current;
      const stopHit =
        (ST.win > 0 && payout >= ST.win) ||
        (ST.bal > 0 && balanceRef.current < ST.bal) ||
        balanceRef.current < betRef.current;
      if (A.mode !== 0 && !stopHit) {
        if (A.mode === 10) {
          A.left -= 1;
          setAutoLeft(A.left);
          if (A.left <= 0) { A.mode = 0; setAuto(0); return; }
        }
        later(() => { if (!deadRef.current && phaseRef.current === "idle") run(); }, 700);
      } else if (A.mode !== 0 && stopHit) {
        A.mode = 0; A.left = 0; setAuto(0); setAutoLeft(0);
      }
    }, holdMs);
  };

  const run = async () => {
    if (phaseRef.current !== "idle") return;
    const lineBet = Math.max(50, Math.min(bet, MAX_BET));
    if (balanceRef.current < lineBet) { setError("NOT ENOUGH CREDITS"); return; }
    setError(""); setOverlay(null); setCounter(1);
    betRef.current = lineBet;
    comboRef.current = 0;
    hold(); lnSfx.launch();
    setPhase("flying");

    const { ok, data } = await apiPost("/api/games/lander/spin", { betAmount: lineBet });
    if (deadRef.current) return;
    if (!ok) {
      setError((data?.error || "Launch failed").toUpperCase());
      setPhase("idle"); release();
      return;
    }
    serverRef.current = data;
    simRef.current = createSim(data.map);
    glRef.current?.setMap(simRef.current);
    accRef.current = 0;
  };

  runRef.current = () => {
    if (rules) return;
    if (phaseRef.current === "idle") run();
  };

  // ── drawing ──────────────────────────────────────────────────────────────
  const draw = (ctx, cv, dt) => {
    const dpr = dprRef.current;
    const w = cv.width / dpr, h = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const SP = spritesRef.current;
    if (!SP) return;
    const sim = simRef.current;
    const scale = h / PHYS.H;
    const wx = sim ? sim.S.wx : 0;
    const shipX = w * 0.3;
    const off = shipX - wx * scale;
    const T = timeRef.current;

    // nebulae, 0.45x parallax
    const nebs = nebRef.current;
    for (let i = 0; i < nebs.length; i++) {
      const n = nebs[i];
      const sxp = shipX + (n.x - wx * 0.45 * scale) % (w + 600) - 300;
      const x = ((sxp % (w + 600)) + (w + 600)) % (w + 600) - 300;
      ctx.globalAlpha = 0.8;
      ctx.drawImage(SP.neb[n.v], x - n.r, n.yf * h - n.r, n.r * 2, n.r * 2);
    }
    ctx.globalAlpha = 1;

    // the void band — the gradient object is cached per canvas height
    const vy = PHYS.VOID_Y * scale;
    let gc = gradRef.current;
    if (!gc || gc.h !== h) {
      const grad = ctx.createLinearGradient(0, vy - 30 * scale, 0, h);
      grad.addColorStop(0, "rgba(32,14,64,0)");
      grad.addColorStop(0.25, "rgba(32,14,64,.55)");
      grad.addColorStop(1, "rgba(6,2,14,.96)");
      gc = gradRef.current = { h, grad };
    }
    ctx.fillStyle = gc.grad;
    ctx.fillRect(0, vy - 30 * scale, w, h - vy + 30 * scale);
    const waveStep = 26;
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(150,90,220,${[0.16, 0.115, 0.07][i]})`;
      ctx.lineWidth = [7, 5, 3][i] * scale;
      ctx.beginPath();
      for (let x = 0; x <= w; x += waveStep) {
        const yy = vy + (10 + i * 14) * scale + Math.sin(x * 0.014 + T * (1.1 + i * 0.4) + i * 2 - wx * 0.004) * 7 * scale;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    if (sim) {
      const map = sim.map;
      // launch pad behind, dock ahead
      const padW = 200 * scale;
      const drawPad = (worldX, label, halo) => {
        const x = worldX * scale + off;
        if (x < -padW || x > w + padW) return;
        if (halo) {
          const pulse = 0.75 + Math.sin(T * 2.4) * 0.25;
          ctx.globalAlpha = pulse;
          ctx.drawImage(SP.halo, x - 120 * scale, PHYS.PAD_Y * scale - 42 * scale, 240 * scale, 90 * scale);
          ctx.globalAlpha = 1;
        }
        ctx.drawImage(SP.pad, x - padW / 2, PHYS.PAD_Y * scale - 8 * scale, padW, 60 * scale);
        for (let b = 0; b < 5; b++) {
          const on = Math.floor(T * 3 + b) % 2 === 0;
          ctx.fillStyle = on ? "#f0d99a" : "#6b5a2e";
          ctx.beginPath();
          ctx.arc(x - padW / 2 + (b + 0.5) * (padW / 5), PHYS.PAD_Y * scale - 3 * scale, 2.4 * scale, 0, 7);
          ctx.fill();
        }
        ctx.fillStyle = "#5d6a80";
        ctx.font = `${Math.max(9, 11 * scale)}px 'DM Sans'`;
        ctx.textAlign = "center";
        ctx.fillText(label, x, PHYS.PAD_Y * scale + 24 * scale);
      };
      drawPad(60, "LAUNCH", false);
      drawPad(map.len, "DOCK", true);

      // events
      for (let i = 0; i < map.ev.length; i++) {
        if (sim.done[i]) continue;
        const e = map.ev[i];
        const x = e.x * scale + off;
        if (x < -60 || x > w + 60) continue;
        const bob = Math.sin(T * 2 + e.x * 0.01) * 5 * scale;
        const y = e.yf * PHYS.H * scale + bob;
        if (e.kind === "pick") {
          const sz = 62 * scale;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.sin(T * 1.6 + e.x) * 0.12);
          ctx.drawImage(SP.gem[e.t], -sz / 2, -sz / 2, sz, sz);
          ctx.restore();
          ctx.fillStyle = GEM_COLOR[e.t];
          ctx.font = `700 ${Math.max(10, 13 * scale)}px 'DM Sans'`;
          ctx.textAlign = "center";
          ctx.fillText(e.t.replace("x", "×"), x, y + 30 * scale);
        } else {
          const sz = 74 * scale;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(T * 0.45);
          ctx.drawImage(SP.mine, -sz / 2, -sz / 2, sz, sz);
          ctx.restore();
        }
      }

      // engine trail
      for (const p of trailRef.current) {
        const a = 1 - p.t / p.life;
        ctx.globalAlpha = a * 0.8;
        const r = p.r * (1 + p.t * 2.4) * scale;
        ctx.drawImage(SP.puff, p.x - r, p.y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;

      // the ship (our generated shuttle sprite, pitched by velocity)
      const shipImg = shipSprite();
      if (shipImg) {
        const sw = 96 * scale, sh = 96 * scale * (shipImg.height / shipImg.width);
        ctx.save();
        ctx.translate(shipX, sim.S.y * scale);
        ctx.rotate(angRef.current);
        ctx.drawImage(shipImg, -sw * 0.55, -sh * 0.5, sw, sh);
        ctx.restore();
      }

      // money above the ship — the excitement driver
      if (phaseRef.current === "flying" || phaseRef.current === "landed") {
        const pop = popRef.current;
        const fs = (26 + pop * 8) * Math.max(0.8, scale);
        ctx.font = `700 ${fs}px 'DM Sans'`;
        ctx.textAlign = "center";
        ctx.fillStyle = pop > 0.4 ? "#fdf3d0" : "#f0d99a";
        ctx.fillText(fmtMKD(Math.round(betRef.current * sim.S.counter * 100) / 100), shipX, sim.S.y * scale - 46 * scale);
        ctx.font = `700 ${Math.max(11, 14 * scale)}px 'DM Sans'`;
        ctx.fillStyle = "#9fe8c8";
        ctx.fillText("×" + sim.S.counter.toFixed(2), shipX, sim.S.y * scale - 28 * scale);
      }
    }

    // particles above everything
    for (const f of fxRef.current) {
      const a = 1 - f.t / f.life;
      if (f.kind === "spark") {
        ctx.globalAlpha = a;
        ctx.fillStyle = f.col;
        ctx.beginPath(); ctx.arc(f.x, f.y, 2.4, 0, 7); ctx.fill();
      } else if (f.kind === "coin") {
        ctx.globalAlpha = Math.min(1, a * 2);
        ctx.drawImage(spritesRef.current.coin, f.x - 9, f.y - 9, 18, 18);
      } else if (f.kind === "ring") {
        ctx.globalAlpha = a;
        ctx.strokeStyle = "#ff9c86";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.x, f.y, 8 + f.t * 160, 0, 7); ctx.stroke();
      } else if (f.kind === "pop") {
        ctx.globalAlpha = Math.min(1, a * 1.6);
        ctx.fillStyle = f.col;
        ctx.font = "700 20px 'DM Sans'";
        ctx.textAlign = "center";
        ctx.fillText(f.text, f.x, f.y - f.t * 34);
      }
    }
    ctx.globalAlpha = 1;
  };

  const shipSpriteRef = useRef(null);
  const shipSprite = () => {
    if (!shipSpriteRef.current) {
      const img = new Image();
      img.src = "/space/gems/shuttle.png";
      shipSpriteRef.current = img;
    }
    return shipSpriteRef.current.complete ? shipSpriteRef.current : null;
  };

  // ── chrome ──────────────────────────────────────────────────────────────
  const lineBet = Math.max(50, Math.min(bet, MAX_BET));
  const idle = phase === "idle";
  const statusText = phase === "flying" ? `IN FLIGHT ×${counter.toFixed(2)}`
    : phase === "landed" ? `DOCKED — ${fmtMKD(lastWin ?? 0)}`
      : phase === "crashed" ? "LOST IN THE VOID"
        : lastWin != null ? (lastWin > 0 ? `LAST WIN ${fmtMKD(lastWin)}` : "READY") : "READY";

  const setAutoMode = (m) => {
    if (!idle) return;
    lnSfx.click();
    setAuto(m);
    setAutoLeft(m === 10 ? 10 : 0);
    autoRef.current = { mode: m, left: m === 10 ? 10 : 0 };
  };

  return (
    <div className="ln-root">
      <header className="ln-head">
        <div className="ln-brand">
          <b>STAR LANDER</b>
          <span>M-TECH ORIGINALS</span>
        </div>
        <div className="ln-head-r">
          <div className={"ln-chip-status" + (phase === "crashed" ? " bad" : phase === "landed" ? " good" : "")}>{statusText}</div>
          <div className="ln-credits"><span>CREDITS</span><b>{fmtMKD(balance)}</b></div>
        </div>
      </header>

      <div className="ln-main">
        <aside className={"ln-panel" + (idle ? "" : " locked")}>
          <div className="ln-group">
            <span className="ln-glabel">VOLUME</span>
            <button type="button" className="ln-wide" onClick={() => { cycleVol(); lnSfx.click(); }}>
              {VOL_LABELS[vol]}
            </button>
          </div>
          <div className="ln-group">
            <span className="ln-glabel">BET</span>
            <div className="ln-betrow">
              <button type="button" disabled={!idle || lineBet <= 50} onClick={() => { lnSfx.click(); setBet((b) => Math.max(50, b - 50)); }}>−</button>
              <b>{fmtMKD(lineBet)}</b>
              <button type="button" disabled={!idle || lineBet >= MAX_BET} onClick={() => { lnSfx.click(); setBet((b) => Math.min(MAX_BET, b + 50)); }}>+</button>
            </div>
            <button type="button" className="ln-wide dim" disabled={!idle} onClick={() => { lnSfx.click(); setBet(Math.min(MAX_BET, Math.floor(balance / 50) * 50)); }}>MAX BET</button>
          </div>
          <div className="ln-group live">
            <span className="ln-glabel">FLIGHT SPEED</span>
            <div className="ln-pills">
              {SPEED_LABELS.map((l, i) => (
                <button type="button" key={i} className={speed === i ? "on" : ""} onClick={() => { lnSfx.click(); setSpeed(i); }}>{l}</button>
              ))}
            </div>
          </div>
          <div className="ln-group">
            <span className="ln-glabel">AUTOPLAY{auto === 10 && autoLeft > 0 ? ` · ${autoLeft}` : ""}</span>
            <div className="ln-pills">
              <button type="button" className={auto === 0 ? "on" : ""} disabled={!idle} onClick={() => setAutoMode(0)}>OFF</button>
              <button type="button" className={auto === 10 ? "on" : ""} disabled={!idle} onClick={() => setAutoMode(10)}>10</button>
              <button type="button" className={auto === Infinity ? "on" : ""} disabled={!idle} onClick={() => setAutoMode(Infinity)}>∞</button>
            </div>
            <div className="ln-stoprow">
              <span>STOP IF WIN ≥</span>
              <button type="button" disabled={!idle} onClick={() => { lnSfx.click(); setStopWin((v) => Math.max(0, v - 500)); }}>−</button>
              <b>{stopWin > 0 ? fmtMKD(stopWin) : "OFF"}</b>
              <button type="button" disabled={!idle} onClick={() => { lnSfx.click(); setStopWin((v) => v + 500); }}>+</button>
            </div>
            <div className="ln-stoprow">
              <span>STOP IF CREDIT &lt;</span>
              <button type="button" disabled={!idle} onClick={() => { lnSfx.click(); setStopBal((v) => Math.max(0, v - 500)); }}>−</button>
              <b>{stopBal > 0 ? fmtMKD(stopBal) : "OFF"}</b>
              <button type="button" disabled={!idle} onClick={() => { lnSfx.click(); setStopBal((v) => v + 500); }}>+</button>
            </div>
          </div>
        </aside>

        <div ref={wrapRef} className={"ln-scene" + (shake === 1 ? " ln-shake" : shake === 2 ? " ln-shake-big" : "")}>
          <canvas ref={canvasRef} />
          {overlay && !overlay.lost && (
            <div className="ln-winpop" style={{ "--tier": overlay.color }}>
              <b>{overlay.tier}</b>
              <span className="ln-winpop-amt">{overlay.amount}</span>
              <span className="ln-winpop-mult">×{overlay.mult.toFixed(2)}</span>
            </div>
          )}
          {overlay && overlay.lost && (
            <div className="ln-losspop"><b>LOST IN THE VOID</b></div>
          )}
          {error && <div className="ln-error">{error}</div>}
        </div>
      </div>

      <footer className="ln-console">
        <button type="button" className="ln-flat" onClick={() => { lnSfx.click(); navigate("/"); }}>LOBBY</button>
        <button type="button" className="ln-flat" onClick={() => { lnSfx.click(); setRules(true); }} aria-label="Rules">ⓘ</button>
        <div className="ln-spacer" />
        <div className="ln-multread">
          <span>MULTIPLIER</span>
          <b className={phase === "flying" ? "gold" : ""}>×{counter.toFixed(2)}</b>
        </div>
        <button type="button" className="ln-launch"
          disabled={!idle || balance < lineBet}
          onClick={() => runRef.current && runRef.current()}>
          <b>{phase === "flying" ? "IN FLIGHT" : phase === "landed" ? "DOCKED" : phase === "crashed" ? "CRASHED" : "LAUNCH"}</b>
          <span>{phase === "flying" ? "×" + counter.toFixed(2) : fmtMKD(lineBet)}</span>
        </button>
      </footer>

      {rules && (
        <div className="ln-modal" onClick={() => setRules(false)}>
          <div className="ln-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="ln-modal-title">STAR LANDER</div>
            <div className="ln-rule">THE SHIP FLIES ITSELF — THERE IS NOTHING TO PRESS AND NOTHING TO TIME. GRAVITY PULLS IT DOWN; <b>GEMS</b> BOOST IT UP AND GROW THE COUNTER (+1 +2 ×2 ×3 ×5); <b>PLASMA MINES</b> HALVE THE COUNTER AND SHOVE IT TOWARD THE VOID.</div>
            <div className="ln-rule">REACH THE <b>DOCKING STATION</b> AND THE COUNTER PAYS, UP TO <b>×500</b>. TOUCH THE VOID FIRST AND THE BET IS LOST. MIND THE MINEFIELD GUARDING THE PAD — EVERY MINE HIT HALVES THE COUNTER. THE FLIGHT PAUSES WHILE THIS CARD IS OPEN.</div>
            <div className="ln-rule">SPEED CHANGES THE PICTURE, NEVER THE FLIGHT — EVERY SPEED REPLAYS THE SAME OUTCOME. PROVABLY FAIR, LIKE EVERY GAME ON THIS MACHINE.</div>
            <button type="button" className="ln-gotit" onClick={() => setRules(false)}>GOT IT</button>
          </div>
        </div>
      )}
    </div>
  );
}
