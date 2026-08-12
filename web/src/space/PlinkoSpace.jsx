// PLINKO — space-theme port of "Plinko Game.dc.html". The canvas renderer
// (moon-grey mini-world pegs, gradient slot row, gold orb, spark/pop fx,
// shakes, sfx) is the prototype's, but every outcome is SERVER-drawn:
// POST /plinko/start settles the round and returns the per-row left/right
// chain from the provably-fair seed — the physics here is GUIDED, steering
// each peg bounce to follow that chain so the ball visibly arrives in the
// server's bucket. Jitter survives in magnitude only, never in sign.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { getBalance, useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import SpaceBackground from "./SpaceBackground";
import {
  T, SpaceRoot, SpaceHeader, SpaceSidebar, SectionLabel,
  tileStyle, pillStyle, GoldButton, SoundButton, BetStepper,
} from "./Shell";
import { beep, ctx as audioCtx, vg, sfx, armAmbientOnGesture } from "./spaceAudio";
import "./space.css";
import "./plinko.css";

const MIN_BET = 50, MAX_BET = 500; // BetStepper itself steps by 50

const RISKS = [
  { v: "low", label: "LOW" },
  { v: "medium", label: "MED" },
  { v: "high", label: "HIGH" },
];
const ROWS = [8, 12, 16];

// Multipliers are read at a glance on a cabinet screen, so they carry as few
// decimals as the value allows: ≥100 → whole ("1000", "130"); ≥10 → whole
// unless there really is a fraction ("26", "18.5"); below 10 → up to 2dp with
// trailing zeros stripped ("1.5", "0.2", "2").
const trimNum = (m) => {
  const v = Number(m);
  if (!Number.isFinite(v)) return "0";
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) {
    const r = Math.round(v * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }
  return String(parseFloat((Math.round(v * 100) / 100).toFixed(2)));
};
// Slot label — always ×'d ("1000x" … "1.5x").
const slotLabel = (m) => trimNum(m) + "x";

// ── plinko-specific sfx, composed from the shared WebAudio primitives ──────
let lastTickAt = 0;
const psfx = {
  tick() { // peg hit — throttled 36ms like the prototype
    const now = performance.now();
    if (now - lastTickAt < 36) return;
    lastTickAt = now;
    beep("sine", 900 + Math.random() * 700, 500, 0.045, 0.05);
  },
  drop() { beep("triangle", 300, 700, 0.12, 0.14); },
  win() { beep("sine", 660, 0, 0.12, 0.2); beep("sine", 990, 0, 0.09, 0.24, 0.06); },
  big() { [523, 659, 784, 1047].forEach((f, i) => beep("sine", f, 0, 0.13, 0.3, i * 0.07)); },
  // (no lose sound — this cabinet only ever celebrates, it never punishes)
  huge() { // jackpot fanfare — full port of the prototype's 'huge'
    beep("sawtooth", 180, 1400, 0.1, 0.5); // rising sweep
    // fast ascending arpeggio, two octaves
    [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => {
      beep("square", f, 0, 0.07, 0.16, 0.12 + i * 0.055);
      beep("sine", f, 0, 0.12, 0.22, 0.12 + i * 0.055);
    });
    // triumphant chord stabs
    [0, 0.18, 0.36].forEach((at, k) => [523, 659, 784, 1047].forEach((f) => beep("triangle", f * (k === 2 ? 1.5 : 1), 0, 0.09, 0.5, 0.55 + at)));
    // shimmer tail + sub impact
    beep("sine", 3136, 1568, 0.05, 1.1, 0.6);
    beep("sine", 65, 45, 0.3, 0.6, 0.05);
    // sparkle noise burst
    const VG = vg();
    if (VG === 0) return;
    try {
      const C = audioCtx(), t = C.currentTime;
      const len = Math.floor(C.sampleRate * 0.7), buf = C.createBuffer(1, len, C.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = C.createBufferSource(); src.buffer = buf;
      const f2 = C.createBiquadFilter(); f2.type = "highpass"; f2.frequency.value = 5200;
      const g2 = C.createGain(); g2.gain.setValueAtTime(0.12 * VG, t + 0.1); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      src.connect(f2); f2.connect(g2); g2.connect(C.destination); src.start(t + 0.1); src.stop(t + 0.8);
    } catch { /* audio unavailable */ }
  },
};

export default function PlinkoSpace() {
  const navigate = useNavigate();
  const balance = useBalance();

  const [bet, setBet] = useState(100);
  const [risk, setRisk] = useState("medium");
  const [rows, setRows] = useState(12);
  const [table, setTable] = useState([]);   // SERVER-scaled payout table
  const [flying, setFlying] = useState(0);  // balls in flight (incl. pending POSTs)
  const [lastWin, setLastWin] = useState(null); // { mult, win } — server values
  const [shake, setShake] = useState(0);    // 0 | 1 | 2 → none/plShake/plShakeBig
  const [flashOn, setFlashOn] = useState(false);
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");

  const boardRef = useRef(null);
  const canvasRef = useRef(null);
  // Physics world — mutated by the rAF loop, never through React state.
  const world = useRef({
    balls: [], fx: [], pegRows: [], slots: [], slotKick: [],
    sx: 20, sy: 30, slotY: 0, slotH: 40, ballR: 6, w: 0, h: 0, dpr: 1, table: [],
  }).current;
  const rowsRef = useRef(rows);
  const fitRef = useRef(null);
  const shakeTimer = useRef(0);
  const chainTimer = useRef(0);
  const chainAbort = useRef(false);
  const deadRef = useRef(false);

  // ── suspense: the credits must not move before a ball lands ───────────────
  // One hold per ball (taken before its POST, dropped when THAT ball settles
  // in its slot). Holds nest, so with several balls in the air the readout
  // only unfreezes once the last one has landed — which is what we want.
  const holdsRef = useRef(new Set());
  const takeHold = () => {
    const token = { done: false };
    holdsRef.current.add(token);
    holdBalance();
    return token;
  };
  const dropHold = (token) => {
    if (!token || token.done) return;
    token.done = true;
    holdsRef.current.delete(token);
    releaseBalance();
  };

  useEffect(() => { armAmbientOnGesture(); }, []);

  // ── payout table: always the server's (it carries the operator's RTP) ────
  useEffect(() => {
    let dead = false;
    apiGet(`/api/games/plinko/table?rows=${rows}&risk=${risk}`).then(({ ok, data }) => {
      if (!dead && ok && Array.isArray(data.table)) { setTable(data.table); world.table = data.table; }
    });
    return () => { dead = true; };
  }, [rows, risk]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { world.table = table; }, [table]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── geometry (verbatim from the prototype's geom()) ──────────────────────
  const geom = () => {
    const R = rowsRef.current, w = world.w || 800, h = world.h || 500;
    const slotH = Math.max(34, Math.min(56, h * 0.09));
    const topPad = 26, botPad = slotH + 14;
    const cols = R + 2;
    const sx = Math.min(w / cols, (h - topPad - botPad) / R * 1.15);
    const sy = (h - topPad - botPad) / R;
    const pegRows = [];
    for (let r = 0; r < R; r++) {
      const n = r + 3, rowW = sx * (n - 1), rx0 = (w - rowW) / 2, row = [];
      for (let i = 0; i < n; i++) {
        const seed = ((r * 31 + i * 17) % 100) / 100;
        const kind = seed < 0.16 ? "sun" : seed < 0.42 ? "ring" : "planet";
        const hues = [[168, 176, 190], [148, 155, 170], [185, 190, 200], [132, 139, 155], [158, 163, 175]];
        row.push({ x: rx0 + i * sx, y: topPad + (r + 0.7) * sy, r: Math.max(3.5, sx * 0.09), hit: 0, kind, hue: hues[(r * 7 + i * 13) % hues.length], tilt: (seed - 0.5) * 1.2, spin: seed * 6.28 });
      }
      pegRows.push(row);
    }
    world.pegRows = pegRows;
    world.sx = sx; world.sy = sy; world.slotH = slotH;
    world.slotY = topPad + (R - 0.3) * sy + sy * 0.6;
    const n = R + 1, rowW = sx * n, rx0 = (w - rowW) / 2;
    world.slots = Array.from({ length: n }, (_, i) => ({ x: rx0 + i * sx, w: sx }));
    world.ballR = Math.max(5, sx * 0.16);
    world.slotKick = new Array(n).fill(0);
  };

  // Rows switch: rebuild the field, drop any (impossible while locked) balls.
  useEffect(() => {
    rowsRef.current = rows;
    world.balls = [];
    if (fitRef.current) fitRef.current();
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── a ball reaches the slot row — settle ITS server round's visuals ──────
  const land = (b) => {
    dropHold(b.hold); // the reveal — this ball's credits may now be published
    const slots = world.slots, idx = Math.min(b.bucket, slots.length - 1);
    const mult = b.mult, win = b.payout;
    world.slotKick[idx] = 1;
    const cx = slots[idx].x + slots[idx].w / 2;
    world.fx.push({ kind: "pop", x: cx, y: world.slotY - 8, t: 0, life: 1, text: "×" + trimNum(mult), good: mult >= 1 });
    if (mult >= 2) {
      const cnt = mult >= 10 ? 34 : 16;
      for (let i = 0; i < cnt; i++) {
        const a = Math.random() * 6.28, sp = 120 + Math.random() * (mult >= 10 ? 340 : 200);
        world.fx.push({ kind: "spark", x: cx, y: world.slotY, vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a)) * sp - 80, t: 0, life: 0.8 + Math.random() * 0.5, col: ["#f0d99a", "#7ef0c0", "#ffb08a", "#a8c8ff"][i % 4] });
      }
    }
    setLastWin({ mult, win });
    setFlying((f) => Math.max(0, f - 1));
    if (mult >= 10) psfx.huge();
    else if (mult >= 2) psfx.big();
    else if (mult >= 1) psfx.win();
    // below ×1: silence — no fizz, no shake, no red
    if (mult >= 2) {
      setShake(mult >= 10 ? 2 : 1);
      setFlashOn(mult >= 10);
      clearTimeout(shakeTimer.current);
      shakeTimer.current = setTimeout(() => { if (!deadRef.current) { setShake(0); setFlashOn(false); } }, 650);
    }
  };

  // ── GUIDED physics step: prototype gravity/feel, server-decided path ─────
  // At each peg row the ball collides with exactly the peg its history says
  // it reaches (peg index = 1 + rights-so-far). On impact the bounce-up
  // magnitude is random (the jitter), but vx is solved from projectile time
  // so the ball arrives at the NEXT waypoint — whose side is the server's
  // direction for that row. Signs come from the seed chain, never Math.random.
  const step = (dt) => {
    const g = (world.h || 500) * 2.4;
    for (const row of world.pegRows) for (const p of row) p.hit = Math.max(0, p.hit - dt * 4);
    for (let i = 0; i < world.slotKick.length; i++) world.slotKick[i] = Math.max(0, world.slotKick[i] - dt * 5);
    const alive = [];
    for (const b of world.balls) {
      b.vy += g * dt; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.row < b.dirs.length) {
        const pr = world.pegRows[b.row];
        const tp = pr && pr[Math.min(b.S + 1, pr.length - 1)];
        if (tp) {
          const rr = world.ballR + tp.r;
          if (b.y >= tp.y - rr) {
            const d = b.dirs[b.row] ? 1 : -1; // server's call for this row
            b.x = tp.x + d * rr * 0.55;       // contact point on the exit side
            b.y = tp.y - rr * 0.85;
            tp.hit = 1;
            psfx.tick();
            b.S += b.dirs[b.row]; b.row += 1;
            // next waypoint: the following row's peg, or the server bucket
            let nx, ny;
            if (b.row < b.dirs.length) {
              const npr = world.pegRows[b.row], np = npr[Math.min(b.S + 1, npr.length - 1)];
              nx = np.x; ny = np.y - rr;
            } else {
              const slot = world.slots[Math.min(b.bucket, world.slots.length - 1)];
              nx = slot.x + slot.w / 2; ny = world.slotY;
            }
            // random-magnitude restitution kick (jitter lives HERE only)
            const up = (0.14 + Math.random() * 0.26) * Math.sqrt(2 * g * world.sy);
            b.vy = -up;
            const dropH = Math.max(4, ny - b.y);
            const tFly = (up + Math.sqrt(up * up + 2 * g * dropH)) / g;
            b.vx = (nx - b.x) / tFly; // sign == server direction by geometry
          }
        }
      }
      // side walls (safety net — a guided ball stays inside the field)
      const m = world.sx * 0.6;
      if (b.x < m) { b.x = m; b.vx = Math.abs(b.vx) * 0.7; }
      if (b.x > world.w - m) { b.x = world.w - m; b.vx = -Math.abs(b.vx) * 0.7; }
      if (b.row >= b.dirs.length && b.y >= world.slotY) land(b);
      else if (b.y < (world.h || 500) + 80) alive.push(b);
    }
    world.balls = alive;
    const fx = [];
    for (const f of world.fx) {
      f.t += dt;
      if (f.kind === "spark") { f.vy += 620 * dt; f.x += f.vx * dt; f.y += f.vy * dt; }
      if (f.t < f.life) fx.push(f);
    }
    world.fx = fx;
  };

  // ── canvas renderer (verbatim port of the prototype's draw()) ────────────
  const slotColor = (i, n) => {
    const d = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    let c1, c2, t;
    if (d < 0.5) { t = d / 0.5; c1 = [63, 127, 174]; c2 = [199, 154, 84]; }
    else { t = (d - 0.5) / 0.5; c1 = [199, 154, 84]; c2 = [255, 90, 74]; }
    return `rgb(${lerp(c1[0], c2[0], t)},${lerp(c1[1], c2[1], t)},${lerp(c1[2], c2[2], t)})`;
  };

  const draw = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d"), dpr = world.dpr || 1, w = world.w || 0, h = world.h || 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const tnow = performance.now() / 1000;
    for (const row of world.pegRows) for (const p of row) {
      const r = p.r + p.hit * 2.2, [cr, cg, cb] = p.hue;
      if (p.kind === "sun") {
        const pulse = 0.5 + 0.5 * Math.sin(tnow * 1.6 + p.spin);
        ctx.shadowColor = "rgba(220,222,232,.5)"; ctx.shadowBlur = 3 + 3 * pulse + 16 * p.hit;
        const gr = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, r * 0.12, p.x, p.y, r);
        gr.addColorStop(0, "#f2f3f6"); gr.addColorStop(0.6, "#c9cdd8"); gr.addColorStop(1, "#8f95a6");
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fillStyle = gr; ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        const gr = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.15, p.x, p.y, r);
        gr.addColorStop(0, `rgba(${Math.min(255, cr + 55)},${Math.min(255, cg + 55)},${Math.min(255, cb + 55)},1)`);
        gr.addColorStop(0.65, `rgb(${cr},${cg},${cb})`);
        gr.addColorStop(1, `rgb(${cr >> 1},${cg >> 1},${cb >> 1})`);
        if (p.hit > 0) { ctx.shadowColor = "#f0d99a"; ctx.shadowBlur = 16 * p.hit; }
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fillStyle = gr; ctx.fill();
        ctx.shadowBlur = 0;
        if (p.kind === "ring") {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.tilt);
          ctx.beginPath(); ctx.ellipse(0, 0, r * 1.9, r * 0.55, 0, 0, 7);
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.4 + p.hit * 0.6})`; ctx.lineWidth = Math.max(1, r * 0.2); ctx.stroke();
          ctx.restore();
        }
      }
      if (p.hit > 0) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 5 * p.hit, 0, 7); ctx.strokeStyle = `rgba(240,217,154,${p.hit * 0.7})`; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    // slot row — labels are the SERVER's scaled multipliers
    const slots = world.slots, n = slots.length, tb = world.table || [], sh = world.slotH || 40;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let i = 0; i < n; i++) {
      const s = slots[i], kick = world.slotKick[i] || 0, y = world.slotY + kick * 7;
      const c = slotColor(i, n);
      const rx = s.x + 2.5, rw = s.w - 5, rh = sh, rad = Math.min(9, rw * 0.22);
      const mult = tb.length ? tb[Math.min(i, tb.length - 1)] : 0;
      const grd = ctx.createLinearGradient(0, y, 0, y + rh);
      grd.addColorStop(0, "rgba(255,255,255,.28)"); grd.addColorStop(0.28, "rgba(255,255,255,0)"); grd.addColorStop(1, "rgba(0,0,0,.38)");
      if (mult >= 10 || kick > 0) { ctx.shadowColor = c; ctx.shadowBlur = mult >= 10 ? 12 : 18 * kick; }
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(rx, y, rw, rh, rad) : ctx.rect(rx, y, rw, rh);
      ctx.fillStyle = c; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(rx, y, rw, rh, rad) : ctx.rect(rx, y, rw, rh);
      ctx.fillStyle = grd; ctx.fill();
      ctx.strokeStyle = kick > 0 ? `rgba(255,255,255,${0.4 + kick * 0.6})` : "rgba(255,255,255,.22)";
      ctx.lineWidth = kick > 0 ? 2 : 1;
      ctx.stroke();
      ctx.fillStyle = "rgba(6,8,13,.92)";
      const label = tb.length ? slotLabel(mult) : "";
      // long labels ("1000x") get squeezed so they still fit a narrow tile
      const fs = Math.max(9, Math.min(16, s.w * 0.28) * (label.length > 4 ? 0.8 : 1));
      ctx.font = `700 ${fs}px 'DM Sans', sans-serif`;
      ctx.fillText(label, rx + rw / 2, y + rh / 2 + 1.5);
    }
    // gold orbs
    for (const b of world.balls) {
      const r = world.ballR;
      const gr = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.35, r * 0.15, b.x, b.y, r);
      gr.addColorStop(0, "#fdf3d0"); gr.addColorStop(0.55, "#e7c476"); gr.addColorStop(1, "#a9843e");
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 7);
      ctx.fillStyle = gr; ctx.shadowColor = "rgba(240,217,154,.8)"; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0;
    }
    // sparks + landing popups
    for (const f of world.fx) {
      const k = f.t / f.life;
      ctx.globalAlpha = 1 - k;
      if (f.kind === "spark") {
        ctx.fillStyle = f.col;
        ctx.beginPath(); ctx.arc(f.x, f.y, 2.6 * (1 - k * 0.5), 0, 7); ctx.fill();
      } else {
        // a win pops in green; anything less is stated in neutral grey
        ctx.fillStyle = f.good ? "#7ef0c0" : "#8a94a8";
        ctx.font = "700 22px 'DM Sans', sans-serif";
        ctx.fillText(f.text, f.x, f.y - 40 * k);
      }
      ctx.globalAlpha = 1;
    }
  };

  // ── mount: canvas fit (ResizeObserver) + the rAF loop ────────────────────
  useEffect(() => {
    deadRef.current = false;
    const cv = canvasRef.current;
    const fit = () => {
      const el = boardRef.current;
      if (!el || !cv) return;
      const r = el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(2, r.width * dpr); cv.height = Math.max(2, r.height * dpr);
      world.dpr = dpr; world.w = r.width; world.h = r.height;
      geom();
    };
    fitRef.current = fit;
    fit();
    const ro = new ResizeObserver(fit);
    if (boardRef.current) ro.observe(boardRef.current);
    let raf = 0, pt = 0;
    const loop = (t) => {
      if (deadRef.current) return;
      const dt = Math.min(0.032, (t - (pt || t)) / 1000 || 0.016);
      pt = t;
      step(dt); draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      deadRef.current = true;
      cancelAnimationFrame(raf);
      try { ro.disconnect(); } catch { /* fine */ }
      clearTimeout(shakeTimer.current);
      clearTimeout(chainTimer.current);
      // balls in the air will never land now — never strand their holds
      for (const t of Array.from(holdsRef.current)) dropHold(t);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── drops: one POST per ball; the response IS the ball's fate ────────────
  const spawn = (data, hold) => {
    psfx.drop();
    world.balls.push({
      hold,                    // released the instant this ball settles
      x: (world.w || 800) / 2 + (Math.random() - 0.5) * world.sx * 0.5,
      y: 6, vx: (Math.random() - 0.5) * 30, vy: 0,
      row: 0, S: 0, // S = RIGHTs consumed so far → target peg index = S + 1
      dirs: data.directions,   // server: 0 = left, 1 = right, one per row
      bucket: data.bucket,     // server: Σ directions — where it MUST land
      mult: data.multiplier,   // server: table[bucket]
      payout: data.payout,     // server: truncate(bet × multiplier, 2)
    });
  };

  const fire = async () => {
    const betAmt = bet;
    setError("");
    setFlying((f) => f + 1); // locks risk/rows immediately, before the await
    const hold = takeHold(); // freeze the credits before the stake is debited
    let handedOff = false;   // true once the ball owns the hold
    try {
      const { ok, data } = await apiPost("/api/games/plinko/start", { betAmount: betAmt, rows, risk });
      if (deadRef.current) return false;
      if (!ok || !Array.isArray(data?.directions)) {
        chainAbort.current = true;
        setFlying((f) => Math.max(0, f - 1));
        setError(data?.error || "Something went wrong");
        return false;
      }
      if (Array.isArray(data.table)) { setTable(data.table); world.table = data.table; }
      spawn(data, hold); // apiPost already stepped the shared balance store
      handedOff = true;
      return true;
    } finally {
      if (!handedOff) dropHold(hold); // error / unmount — never leak a hold
    }
  };

  const can = (balance ?? 0) >= MIN_BET;
  const dropOne = () => { if (can) fire(); };
  const dropTen = () => {
    if (!can) return;
    chainAbort.current = false;
    let k = 0;
    const one = () => {
      if (deadRef.current || chainAbort.current) return;
      const bal = getBalance();
      if (bal != null && bal < bet) return; // stake outran the wallet — stop
      fire();
      if (++k < 10) chainTimer.current = setTimeout(one, 160);
    };
    one();
  };

  const busy = flying > 0;
  const cfgLock = { opacity: busy ? 0.4 : 1, pointerEvents: busy ? "none" : "auto", transition: "opacity .2s ease" };
  const chip = lastWin
    ? { label: `× ${trimNum(lastWin.mult)}  +${fmtMKD(lastWin.win)}`, color: lastWin.mult >= 1 ? T.win : T.text2 }
    : { label: "READY", color: T.text2 };

  return (
    <SpaceRoot>
      <SpaceBackground fastDur={7} />
      <SpaceHeader title="PLINKO" chip={chip} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
        <SpaceSidebar>
          <SoundButton />
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 2.2vh, 18px)" }}>
            <BetStepper bet={bet} setBet={setBet} maxBet={MAX_BET} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10, ...cfgLock }}>
              <SectionLabel>RISK</SectionLabel>
              <div style={{ display: "flex", gap: 10 }}>
                {RISKS.map((o) => (
                  <button key={o.v} onClick={() => { if (busy) return; sfx.click(); setRisk(o.v); }} className="sp-hover-gold"
                    style={pillStyle(risk === o.v, { flex: 1, minHeight: "clamp(46px, 8vh, 68px)", fontSize: "clamp(13px, 2.2vh, 18px)", letterSpacing: 1 })}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, ...cfgLock }}>
              <SectionLabel>ROWS</SectionLabel>
              <div style={{ display: "flex", gap: 10 }}>
                {ROWS.map((v) => (
                  <button key={v} onClick={() => { if (busy) return; sfx.click(); setRows(v); }} className="sp-hover-gold"
                    style={pillStyle(rows === v, { flex: 1, minHeight: "clamp(46px, 8vh, 68px)", fontSize: "clamp(16px, 2.6vh, 22px)", letterSpacing: 1 })}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SpaceSidebar>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div ref={boardRef} style={{ position: "relative", flex: 1, minHeight: 140, margin: "6px 24px 6px 14px", animation: shake === 2 ? "plShakeBig .6s ease" : shake === 1 ? "plShake .5s ease" : "none" }}>
            <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
            {error && (
              <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 9, padding: "10px 18px", borderRadius: 12, border: "1px solid rgba(255,122,106,.5)", background: "rgba(255,122,106,.12)", color: T.lose, fontSize: 15, fontWeight: 600, letterSpacing: 1, whiteSpace: "nowrap" }}>
                {error}
              </div>
            )}
          </div>
          {/* ×10+ jackpot flash wash (covers the play area like the prototype) */}
          <div style={{ position: "absolute", inset: 0, zIndex: 8, pointerEvents: "none", background: "radial-gradient(115% 90% at 50% 105%, rgba(240,217,154,.14), rgba(240,217,154,0) 55%)", opacity: flashOn ? 1 : 0, transition: "opacity .5s ease" }} />

          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", gap: "clamp(8px, 1vw, 14px)", margin: "0 clamp(10px, 1.6vw, 24px) 20px 14px" }}>
            <button onClick={() => { sfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={tileStyle({ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 30px)", borderRadius: 20, background: T.panelBg, backdropFilter: "blur(8px)", fontSize: "clamp(15px, 1.4vw, 21px)", letterSpacing: 3 })}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
              LOBBY
            </button>
            <button onClick={() => { sfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={tileStyle({ flex: "none", width: "clamp(56px, 11vh, 88px)", minHeight: "clamp(56px, 11vh, 88px)", borderRadius: 20, background: T.panelBg, backdropFilter: "blur(8px)", color: T.text2, display: "flex", alignItems: "center", justifyContent: "center" })}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" /></svg>
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={dropTen}
              style={{ minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2.2vw, 34px)", borderRadius: 20, border: "3px dashed #3a4557", background: T.panelBg, backdropFilter: "blur(8px)", color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: can ? "pointer" : "default", transition: "all .2s ease" }}
              className="sp-hover-gold">
              DROP ×10
            </button>
            <GoldButton label="DROP" sub={fmtMKD(bet)} onClick={dropOne} disabled={!can}
              labelSize="clamp(21px, 2.2vw, 32px)"
              style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", letterSpacing: 5 }} />
          </div>
        </div>
      </div>

      {rules && (
        <div onClick={() => setRules(false)} style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,6,10,.72)", backdropFilter: "blur(4px)" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540, padding: "38px 42px", borderRadius: 24, border: `2px solid ${T.ctlBorder}`, background: "linear-gradient(180deg,#111826,#0a0d14)", boxShadow: "0 34px 90px rgba(0,0,0,.65)" }}>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>HOW TO PLAY</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 15, margin: "26px 0 30px", fontSize: 17, lineHeight: 1.5, color: "#b7c0d1" }}>
              <div style={{ display: "flex", gap: 13 }}><span style={{ color: T.gold, fontWeight: 700 }}>●</span><span>Press DROP to release a ball from the top of the peg field.</span></div>
              <div style={{ display: "flex", gap: 13 }}><span style={{ color: T.win, fontWeight: 700 }}>◆</span><span>The ball bounces down and lands in a multiplier slot — you win bet × multiplier.</span></div>
              <div style={{ display: "flex", gap: 13 }}><span style={{ color: T.lose, fontWeight: 700 }}>✦</span><span>Higher risk and more rows push the big multipliers to the edges.</span></div>
              <div style={{ display: "flex", gap: 13 }}><span style={{ color: T.gold, fontWeight: 700 }}>↑</span><span>Drop as many balls as you like — they fly at the same time.</span></div>
            </div>
            <button onClick={() => { sfx.click(); setRules(false); }}
              style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>
              GOT IT
            </button>
          </div>
        </div>
      )}
    </SpaceRoot>
  );
}
