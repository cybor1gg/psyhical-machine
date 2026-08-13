// ROULETTE — space-theme cabinet screen, designed in the established space
// visual language (no handoff prototype existed for this game). The board is
// the GRAVITY WHEEL: a conic-gradient European wheel (single zero, real pocket
// order, gold separators) idling in slow rotation on the left; SPIN launches a
// gold ball counter-orbiting in the outer groove while the wheel accelerates,
// then the wheel decelerates and the ball glides inward and SEATS on the
// server's pocket — the landing angle is derived from the pocket's index in
// WHEEL_ORDER, so the ball always lands where the server said. The right half
// is the European betting board (0 + 3×12 grid + dozens/columns/even-money).
//
// INSTANT family: one POST carries the whole bet layout and settles the round
// — the server is the only authority on the pocket, per-bet wins, payout and
// balance (api/routes/roulette.js). The client only paces the story (orbit +
// ~2.5s drop) and paints; balance flows through useBalance via api.js.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api";
import { useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import SpaceBackground from "./SpaceBackground";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar,
  GoldButton, SoundButton, BetStepper, T,
} from "./Shell";
import { beep, whoosh, sfx, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import "./space.css";
import "./roulette.css";

const MAX_BET = 99999; // platform max TOTAL stake (МКД) — mirrors the server cap
const CHIP_DENOMS = [5, 10, 25, 50, 100, 500]; // chip rack under the board
// Classic casino chip colours (base / highlight / edge-shadow / numeral ink).
const CHIP_STYLE = {
  5: { base: "#c8342c", hi: "#e8635a", dark: "#7d1b16", ink: "#fff3f1" },
  10: { base: "#2f6fd0", hi: "#5f9bf0", dark: "#183f7d", ink: "#f0f6ff" },
  25: { base: "#2f9e5f", hi: "#5fd08c", dark: "#175c37", ink: "#f0fff6" },
  50: { base: "#e08a2c", hi: "#f5b862", dark: "#8a4f13", ink: "#2a1802" },
  100: { base: "#2b3247", hi: "#4c5878", dark: "#141824", ink: "#eaf0ff" },
  500: { base: "#7b3fd4", hi: "#a575ec", dark: "#43207a", ink: "#f5eeff" },
};

// ── European wheel facts (must mirror api/lib/games/roulette.js) ────────────
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const STEP = 360 / 37; // one pocket, degrees
const RED_SET = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const POCKET_HEX = { green: "#1f8a4d", red: "#d64545", black: "#232c42" };
const BRIGHT_HEX = { green: "#3ae0a1", red: "#ff6a6a", black: "#c6d0e2" }; // legible-on-dark variants
const pocketKind = (n) => (n === 0 ? "green" : RED_SET.has(n) ? "red" : "black");

// Pocket disc paint: pocket i of WHEEL_ORDER is CENTERED at i·STEP degrees
// from the disc's 12-o'clock (the conic starts at −STEP/2), so "angle of
// pocket i" is simply i·STEP everywhere in the physics below.
const WHEEL_CONIC = `conic-gradient(from ${(-STEP / 2).toFixed(4)}deg, ${WHEEL_ORDER
  .map((n, i) => `${POCKET_HEX[pocketKind(n)]} ${(i * STEP).toFixed(3)}deg ${((i + 1) * STEP).toFixed(3)}deg`)
  .join(",")})`;
const WHEEL_SEPS = `repeating-conic-gradient(from ${(-STEP / 2 - 0.4).toFixed(4)}deg, rgba(217,178,106,.85) 0deg 0.8deg, rgba(0,0,0,0) 0.8deg ${STEP.toFixed(4)}deg)`;

// ── wheel/ball physics (deg/s; radii in % of the wheel square) ──────────────
const IDLE_SPD = 7;      // idle drift — a full lap every ~51s
const FAST_SPD = 210;    // spin speed while the ball orbits
const BALL_SPD = -300;   // ball counter-orbits the wheel
const ORBIT_R = 45.6;    // outer groove
const SEAT_R = 30.4;     // riding the pocket band
const MIN_ORBIT_MS = 1050; // the ball always orbits at least this long
const DROP_MS = 2500;    // glide from orbit into the pocket

// Landing bounce — modelled the way a real ball behaves: it FALLS onto the
// pocket bed (accelerating), then hops a few times, each hop lower and
// shorter (free fall: duration ∝ √height). The hops live in the RADIUS;
// the angle keeps one smooth ease for the whole drop so nothing ever jerks,
// with a small forward slip while airborne. Everything reaches exactly zero
// at p=1, preserving the seat-on-the-server-pocket guarantee.
// FIVE landing profiles — one is picked at random for every spin, so no two
// landings rattle the same way: a short skip, a lively patter, a high slow
// bounce, a long chattering roll, and a dead-drop that barely hops.
const LANDINGS = [
  { at: 0.60, amp: 5.2, rest: 0.34, hops: 3, drift: STEP * 0.75 }, // quick skip
  { at: 0.52, amp: 7.4, rest: 0.44, hops: 5, drift: STEP * 1.25 }, // lively patter
  { at: 0.50, amp: 9.6, rest: 0.52, hops: 4, drift: STEP * 1.7 },  // high & slow
  { at: 0.46, amp: 6.4, rest: 0.62, hops: 6, drift: STEP * 2.1 },  // long chatter
  { at: 0.68, amp: 3.4, rest: 0.28, hops: 3, drift: STEP * 0.4 },  // dead drop
].map((p) => {
  // free-fall relation: each hop keeps `rest` of the height and √rest of the
  // duration, normalized so the whole sequence fills the bounce phase.
  const a = [];
  let h = 1, d = 1, t = 0;
  for (let i = 0; i < p.hops; i++) { a.push({ t0: t, dur: d, h }); t += d; h *= p.rest; d *= Math.sqrt(p.rest); }
  return { ...p, arcs: a.map((o) => ({ t0: o.t0 / t, dur: o.dur / t, h: o.h })) };
});
// q (0..1 of the bounce phase) → { h: normalized height, i: hop index }
function hopAt(prof, q) {
  const arcs = prof.arcs;
  for (let i = 0; i < arcs.length; i++) {
    const o = arcs[i];
    if (q >= o.t0 && q < o.t0 + o.dur) {
      const u = (q - o.t0) / o.dur;
      return { h: o.h * 4 * u * (1 - u), i }; // parabolic arc
    }
  }
  return { h: 0, i: arcs.length };
}

// ── betting board model (keys are stable; payloads mirror the server) ───────
const NUM_CELLS = [];
for (let n = 1; n <= 36; n++) NUM_CELLS.push({ n, col: Math.ceil(n / 3) + 1, row: 3 - ((n - 1) % 3) });
const DOZENS = [
  { key: "dz1", n: 1, label: "1ST 12", colS: 2 },
  { key: "dz2", n: 2, label: "2ND 12", colS: 6 },
  { key: "dz3", n: 3, label: "3RD 12", colS: 10 },
];
// grid row 1 holds 3,6..36 (r%3==0 → server column 3); row 3 holds 1,4..34 (column 1)
const COLUMNS = [{ key: "col3", n: 3, row: 1 }, { key: "col2", n: 2, row: 2 }, { key: "col1", n: 1, row: 3 }];

// ── INSIDE bets: the chip positions BETWEEN numbers, exactly like a real
// felt. The server prices them as { type:"inside", ns:[…] } paying 36/count
// (split 17:1, street 11:1, corner 8:1, six-line 5:1). Each zone is a thin
// hit target laid over the grid line it represents.
//   grid: col 1 = zero, cols 2..13 = number columns, col 14 = 2:1
//         row 1 = 3,6,9…  row 2 = 2,5,8…  row 3 = 1,4,7…
const numAt = (col, row) => (col - 2) * 3 + (4 - row); // grid cell → number
const INSIDE_ZONES = [];
for (let col = 2; col <= 13; col++) {
  for (let row = 1; row <= 3; row++) {
    const n = numAt(col, row);
    // vertical split — this number and the one to its right (n | n+3)
    if (col < 13) INSIDE_ZONES.push({ kind: "v", col, row, ns: [n, n + 3] });
    // horizontal split — this number and the one below it in the same column
    if (row < 3) INSIDE_ZONES.push({ kind: "h", col, row, ns: [n, numAt(col, row + 1)] });
    // corner — four numbers meeting at the bottom-right of this cell
    if (col < 13 && row < 3) {
      INSIDE_ZONES.push({ kind: "c", col, row, ns: [n, n + 3, numAt(col, row + 1), numAt(col, row + 1) + 3] });
    }
  }
  // street — the three numbers of this column, on the bottom line
  INSIDE_ZONES.push({ kind: "s", col, row: 3, ns: [numAt(col, 1), numAt(col, 2), numAt(col, 3)] });
  // six-line — this street plus the next, on the bottom line between them
  if (col < 13) {
    INSIDE_ZONES.push({
      kind: "6", col, row: 3,
      ns: [numAt(col, 1), numAt(col, 2), numAt(col, 3), numAt(col + 1, 1), numAt(col + 1, 2), numAt(col + 1, 3)],
    });
  }
}
// zero splits (0|3, 0|2, 0|1) on the zero cell's right edge, and the basket
// 0-1-2-3 at its bottom-right corner
for (let row = 1; row <= 3; row++) INSIDE_ZONES.push({ kind: "v", col: 1, row, ns: [0, numAt(2, row)] });
INSIDE_ZONES.push({ kind: "c", col: 1, row: 2, ns: [0, 1, 2, 3] });
// canonical ascending order, so one felt position is always one bet key
for (const z of INSIDE_ZONES) z.ns.sort((a, b) => a - b);
const zoneKey = (z) => `in:${z.ns.join("-")}`;
const ZONE_LABEL = { v: "SPLIT", h: "SPLIT", c: "CORNER", s: "STREET", 6: "SIX LINE" };
const OUTSIDE = [
  { key: "low", type: "low", label: "1–18" },
  { key: "even", type: "even", label: "EVEN" },
  { key: "red", type: "red", label: "RED", tint: "red" },
  { key: "black", type: "black", label: "BLACK", tint: "black" },
  { key: "odd", type: "odd", label: "ODD" },
  { key: "high", type: "high", label: "19–36" },
];

// Roulette-specific sfx on the shared audio engine. Wins get the space win
// chord (full fanfare on a straight-up hit); a spin that pays nothing makes
// no settle sound at all — only the wheel's own ticks and bounces.
const rlSfx = {
  chip: () => { beep("triangle", 760, 420, 0.09, 0.07); beep("sine", 1500, 900, 0.05, 0.05, 0.02); },
  spin: () => { sfx.bet(); whoosh(400, 2200, 0.07, 0.7, 0.05); },
  tick: sfx.tick,
  bounce: () => beep("triangle", 2000, 1400, 0.045, 0.06), // soft landing-bounce contact
  win: () => { sfx.win(); whoosh(1200, 4200, 0.05, 0.45, 0.1); },
  jackpot: () => { sfx.cash(); [1319, 1568].forEach((f, i) => beep("sine", f, 0, 0.12, 0.3, 0.42 + i * 0.08)); },
  click: sfx.click,
  select: sfx.select,
};

// One board spot: gold-bordered navy cell, red/black/green tint, gold stake
// badge, expanding win ring (--ring color via roulette.css). Staking is
// Board cell. Staking is driven at the GRID level (see the pointer handlers
// on the grid) so a held press can slide across cells and stake each one it
// enters; the cell only registers its stake callback and renders. Backgrounds
// are fully OPAQUE (colour layer over a solid base) so the drifting sun can
// never shine through the numbers.
function Spot({ spotKey, tapReg, label, tint, stake, win, ringColor, disabled, onTap, style, fs, zone, title }) {
  const layer = tint === "red" ? "linear-gradient(180deg, rgba(214,69,69,.52), rgba(140,38,38,.34))"
    : tint === "black" ? "linear-gradient(180deg, rgba(35,44,66,.9), rgba(17,23,36,.78))"
      : tint === "green" ? "linear-gradient(180deg, rgba(31,138,77,.55), rgba(16,84,48,.4))"
        : "linear-gradient(180deg, rgba(13,19,31,.72), rgba(13,19,31,.72))";
  const bg = `${layer}, #0a0e18`;
  const on = stake > 0;
  const tapRef = useRef(onTap); tapRef.current = onTap;
  useEffect(() => {
    if (!tapReg || spotKey == null) return;
    tapReg.set(spotKey, tapRef);
    return () => { tapReg.delete(spotKey); };
  }, [tapReg, spotKey]);
  // Inside-bet zone: an invisible line/corner target that only shows itself
  // when staked (or hovered) — it must not clutter the felt.
  if (zone) {
    return (
      <button disabled={disabled} className={"rl-zone" + (win ? " rl-win" : "") + (on ? " rl-zone-on" : "")}
        data-spot={spotKey} title={title}
        onClick={(e) => { if (e.detail === 0 && !disabled) tapRef.current(); }}
        onContextMenu={(e) => e.preventDefault()}
        style={{ position: "relative", zIndex: 6, padding: 0, cursor: disabled ? "default" : "pointer", touchAction: "none", "--ring": ringColor, ...style }}>
        {on && (
          <span className="rl-badge" key={stake}
            style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", minWidth: "clamp(17px, 3vh, 23px)", height: "clamp(17px, 3vh, 23px)", padding: "0 3px", borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#f6ecc9,#c79a54)", border: "1.5px solid #7a5e2c", color: "#1a1408", fontSize: "clamp(9px, 1.5vh, 12px)", fontWeight: 700, boxShadow: "0 2px 7px rgba(0,0,0,.6)", zIndex: 2 }}>
            {stake}
          </span>
        )}
      </button>
    );
  }
  return (
    <button disabled={disabled} className={"rl-cell" + (win ? " rl-win" : "")} data-spot={spotKey}
      onClick={(e) => { if (e.detail === 0 && !disabled) tapRef.current(); }} // keyboard activation only
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "relative", minHeight: 44, padding: 0, borderRadius: 10,
        border: `2px solid ${on ? T.accent : "rgba(217,178,106,.3)"}`, background: bg,
        color: "#e6ecf6", fontFamily: "'DM Sans', Helvetica, sans-serif", fontWeight: 700,
        fontSize: fs, letterSpacing: 1, cursor: disabled ? "default" : "pointer",
        touchAction: "none", userSelect: "none", WebkitUserSelect: "none",
        boxShadow: on ? "0 0 14px rgba(217,178,106,.28), inset 0 1px 0 rgba(255,255,255,.06)" : "inset 0 1px 0 rgba(255,255,255,.05)",
        "--ring": ringColor, ...style,
      }}>
      {label}
      {on && (
        <span className="rl-badge" key={stake}
          style={{ position: "absolute", right: 3, bottom: 3, minWidth: "clamp(17px, 3vh, 24px)", height: "clamp(17px, 3vh, 24px)", padding: "0 3px", borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#f6ecc9,#c79a54)", border: "1.5px solid #7a5e2c", color: "#1a1408", fontSize: "clamp(9px, 1.5vh, 12px)", fontWeight: 700, boxShadow: "0 2px 6px rgba(0,0,0,.5)" }}>
          {stake}
        </span>
      )}
    </button>
  );
}

function RulesModal({ onClose }) {
  const row = (mark, color, text) => (
    <div style={{ display: "flex", gap: 13 }}>
      <span style={{ color, fontWeight: 700 }}>{mark}</span><span>{text}</span>
    </div>
  );
  const pay = (label, pays) => (
    <div key={label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, padding: "7px 0", borderBottom: `1px solid ${T.panelBorder}` }}>
      <span style={{ fontSize: 15, letterSpacing: 1 }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 700, color: T.gold, whiteSpace: "nowrap" }}>{pays}</span>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,6,10,.72)", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, padding: "38px 42px", borderRadius: 24, border: `2px solid ${T.ctlBorder}`, background: "linear-gradient(180deg,#111826,#0a0d14)", boxShadow: "0 34px 90px rgba(0,0,0,.65)" }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>HOW TO PLAY</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 13, margin: "24px 0 18px", fontSize: 17, lineHeight: 1.5, color: "#b7c0d1" }}>
          {row("◆", T.gold, "Set your chip, then tap the board — numbers, colors, dozens, columns. Stack as many spots as you like.")}
          {row("●", T.win, "SPIN — the gravity wheel decides one pocket out of 37 and every bet settles at once.")}
          {row("✦", "#3ae0a1", "One green zero. Outside bets lose when it hits — that zero is the house's whole edge.")}
        </div>
        <div style={{ margin: "0 0 28px", color: "#b7c0d1" }}>
          {pay("STRAIGHT — a single number", "35 : 1")}
          {pay("DOZEN · COLUMN", "2 : 1")}
          {pay("RED · BLACK · ODD · EVEN · 1–18 · 19–36", "1 : 1")}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}

export default function RouletteSpace() {
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  // phase: idle (placing) → spinning (ball in flight) → settled → idle on edit
  const [phase, setPhase] = useState("idle");
  const [chipVal, setChipVal] = useState(50);     // chip amount, via BetStepper
  const [bets, setBets] = useState({});           // spotKey -> { type, n?, stake }
  const [recent, setRecent] = useState([]);       // last 8 pockets, newest first
  const [winKeys, setWinKeys] = useState(() => new Set()); // staked spots that won
  const [winPocket, setWinPocket] = useState(null); // the pocket, for the bare-cell ring
  const [hubN, setHubN] = useState(null);         // number in the wheel hub
  const [hubKey, setHubKey] = useState(0);        // retriggers the hub pop
  const [lastPayout, setLastPayout] = useState(null); // null until first settle
  const [flash, setFlash] = useState(false);      // gold win flash overlay
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");

  const rotorRef = useRef(null);
  const ballRotRef = useRef(null);
  const ballDotRef = useRef(null);
  const landRef = useRef(null);        // resolves the current spin when the ball seats
  const lastLayoutRef = useRef(null);  // last SPUN layout, for REBET
  const busyRef = useRef(false);       // one request in flight at a time
  const tapReg = useRef(new Map());    // spotKey -> stake callback ref (grid staking)
  const hold = useRef({ t: 0, n: 0, key: null, active: false }); // press-and-slide state
  const timers = useRef([]);
  const errTimer = useRef(0);
  const flashTimer = useRef(0);

  // wheel/ball physics state — mutated by the rAF loop only, never re-rendered
  const sref = useRef({ wheelA: 0, speed: IDLE_SPD, target: IDLE_SPD, ballA: 90, r: ORBIT_R, mode: "hidden", seatIdx: null, drop: null, tapAt: 0 });

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };

  // ── SUSPENSE: the credits stay frozen from the SPIN request until the ball
  // SEATS in its pocket — never while it is still bouncing. holdsRef counts
  // our own holds so the !ok path and unmount can always give them back.
  const holdsRef = useRef(0);
  const takeHold = () => { holdsRef.current++; holdBalance(); };
  const dropHold = () => { if (holdsRef.current > 0) { holdsRef.current--; releaseBalance(); } };
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    while (holdsRef.current > 0) { holdsRef.current--; releaseBalance(); }
  }, []);

  // ── mount: ambience (instant game — never a live round to resume) ─────────
  useEffect(() => {
    armAmbientOnGesture();
    startAmbient();
  }, []);

  // ── the rAF loop: wheel always turning; ball orbits, then drops ───────────
  // Landing math: pocket i of WHEEL_ORDER sits at i·STEP on the disc, so its
  // live screen angle is wheelA + i·STEP. During the drop the ball's angle is
  //   ballA = (wheelA + idx·STEP) + offset·(1 − ease(p))
  // where offset = ((ballA₀ − pocketAbs₀) mod 360) + 720 at drop start — two
  // extra laps that shrink to ZERO, so at p=1 the ball is exactly on the
  // server's pocket and rides the wheel there (radius eased groove → band).
  useEffect(() => {
    const S = sref.current;
    let raf = 0, last = null;
    const easeOut = (p) => 1 - Math.pow(1 - p, 3);
    const frame = (ts) => {
      raf = requestAnimationFrame(frame);
      if (last == null) { last = ts; return; }
      const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
      S.speed += (S.target - S.speed) * Math.min(1, dt * 2.2);
      S.wheelA += S.speed * dt;
      if (S.mode === "seated") { S.ballA = S.wheelA + S.seatIdx * STEP; S.r = SEAT_R; }
      else if (S.mode === "orbit") { S.ballA += BALL_SPD * dt; S.r = ORBIT_R; }
      else if (S.mode === "drop" && S.drop) {
        const d = S.drop;
        const now = performance.now();
        if (now < d.t0) { S.ballA += BALL_SPD * dt; S.r = ORBIT_R; } // still orbiting until drop time
        else {
          if (d.offset == null) { // drop begins NOW: continuity + start the wheel decel
            const pAbs0 = S.wheelA + d.idx * STEP;
            d.offset = ((S.ballA - pAbs0) % 360 + 360) % 360 + 720;
            d.lastRel = -1;
            d.lastHop = -1;
            S.target = IDLE_SPD;
          }
          const p = Math.min(1, (now - d.t0) / d.dur);
          const pocketAbs = S.wheelA + d.idx * STEP;
          const prof = d.prof;
          // ANGLE: one smooth decay across the whole drop — never oscillates,
          // so there is no velocity discontinuity anywhere.
          let ang = d.offset * (1 - easeOut(p));
          let r;
          if (p < prof.at) {
            // falling inward, accelerating like gravity (ease-IN)
            const rp = Math.max(0, Math.min(1, (p - 0.22) / Math.max(0.08, prof.at - 0.22)));
            r = ORBIT_R + (SEAT_R - ORBIT_R) * (rp * rp);
            // pocket-fret ticks on the way in (the bounce has its own sfx)
            const rel = Math.round((((pocketAbs + ang - S.wheelA) / STEP) % 37 + 37) % 37);
            if (p > 0.12 && rel !== d.lastRel) { d.lastRel = rel; rlSfx.tick(); }
          } else {
            // hopping on the bed: parabolic arcs, each lower and shorter
            const q = (p - prof.at) / (1 - prof.at);
            const hop = hopAt(prof, q);
            const fade = 1 - q;
            r = SEAT_R + prof.amp * hop.h * fade;
            ang += prof.drift * hop.h * fade; // slips forward while airborne
            if (hop.i !== d.lastHop) { d.lastHop = hop.i; if (hop.i > 0) rlSfx.bounce(); }
          }
          S.ballA = pocketAbs + ang;
          S.r = r;
          if (p >= 1) {
            S.mode = "seated"; S.seatIdx = d.idx; S.drop = null;
            S.ballA = S.wheelA + d.idx * STEP; S.r = SEAT_R;
            const fn = landRef.current; landRef.current = null;
            if (fn) fn();
          }
        }
      }
      if (!S.drop && S.wheelA > 720000) { S.wheelA %= 360; if (S.mode === "orbit") S.ballA %= 360; }
      if (rotorRef.current) rotorRef.current.style.transform = `rotate(${S.wheelA}deg)`;
      if (ballRotRef.current) { ballRotRef.current.style.transform = `rotate(${S.ballA}deg)`; ballRotRef.current.style.opacity = S.mode === "hidden" ? 0 : 1; }
      if (ballDotRef.current) ballDotRef.current.style.top = (50 - S.r) + "%";
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const lock = phase === "spinning";
  const totalStaked = Object.values(bets).reduce((s, b) => s + b.stake, 0);
  const capTotal = Math.min(MAX_BET, Math.floor(balance));

  const flashError = (msg) => {
    setError(msg);
    clearTimeout(errTimer.current);
    errTimer.current = later(() => setError(""), 2200);
  };
  const doFlash = () => {
    setFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = later(() => setFlash(false), 420);
  };
  const clearResultPaint = () => { setWinKeys(new Set()); setWinPocket(null); };

  // ── board interactions ────────────────────────────────────────────────────
  function place(key, shape) {
    if (lock || busyRef.current) return;
    if (totalStaked + chipVal > capTotal) {
      flashError(totalStaked + chipVal > MAX_BET ? `MAX TOTAL BET ${fmtMKD(MAX_BET)}` : "NOT ENOUGH CREDITS");
      return;
    }
    clearResultPaint();
    setPhase("idle");
    setBets((b) => ({ ...b, [key]: { ...shape, stake: (b[key]?.stake || 0) + chipVal } }));
    rlSfx.chip();
  }
  function clearAll() {
    if (lock || busyRef.current || totalStaked === 0) return;
    setBets({});
    clearResultPaint();
    setPhase("idle");
    rlSfx.click();
  }
  function rebet() {
    if (lock || busyRef.current || !lastLayoutRef.current) return;
    const layout = lastLayoutRef.current;
    const total = Object.values(layout).reduce((s, b) => s + b.stake, 0);
    if (total > capTotal) { flashError("NOT ENOUGH CREDITS"); return; }
    setBets(layout);
    clearResultPaint();
    setPhase("idle");
    rlSfx.select();
  }

  // ── the round: one POST settles everything; the wheel tells the story ─────
  async function spin() {
    if (lock || busyRef.current || totalStaked <= 0) return;
    if (totalStaked > capTotal) { flashError("NOT ENOUGH CREDITS"); return; }
    const entries = Object.entries(bets);
    setError("");
    clearResultPaint();
    setPhase("spinning");
    busyRef.current = true;
    lastLayoutRef.current = bets;

    // launch NOW — wheel accelerates, ball starts its counter-orbit
    const S = sref.current;
    S.tapAt = performance.now();
    S.target = FAST_SPD;
    if (S.mode === "hidden") S.ballA = S.wheelA + 90;
    S.mode = "orbit";
    S.drop = null;
    rlSfx.spin();

    const payload = entries.map(([, b]) => ({ type: b.type, n: b.n, ns: b.ns, stake: b.stake }));
    takeHold(); // the server answers long before the ball lands — freeze the readout
    const { ok, data } = await apiPost("/api/games/roulette/start", { bets: payload });
    busyRef.current = false;
    if (!ok) {
      dropHold();
      // wind down: back to idle drift, ball re-seats on its old pocket (or hides)
      S.target = IDLE_SPD;
      S.mode = S.seatIdx != null ? "seated" : "hidden";
      S.drop = null;
      setPhase("idle");
      flashError((data?.error || "Something went wrong").toUpperCase());
      return;
    }

    // schedule the drop onto the SERVER's pocket (never before MIN_ORBIT_MS)
    const idx = Math.max(0, WHEEL_ORDER.indexOf(data.pocket));
    // a random landing profile per spin — five distinct rattles
    const prof = LANDINGS[(Math.random() * LANDINGS.length) | 0];
    S.drop = { idx, t0: Math.max(performance.now(), S.tapAt + MIN_ORBIT_MS), dur: DROP_MS, offset: null, lastRel: -1, lastHop: -1, prof };
    S.mode = "drop";

    let done = false;
    const settle = () => {
      if (done) return; done = true;
      const winners = new Set(entries.filter((_, i) => (data.bets?.[i]?.win || 0) > 0).map(([k]) => k));
      const straightHit = entries.some(([, b], i) => b.type === "straight" && (data.bets?.[i]?.win || 0) > 0);
      setWinKeys(winners);
      setWinPocket(data.pocket);
      setHubN(data.pocket);
      setHubKey((k) => k + 1);
      setRecent((r) => [data.pocket, ...r].slice(0, 8));
      setLastPayout(data.payout);
      setPhase("settled");
      if (data.payout > 0) {
        if (straightHit) rlSfx.jackpot(); else rlSfx.win();
        doFlash();
      } // a spin that pays nothing settles in silence
      dropHold(); // the ball has SEATED — only now may the credits move
      later(() => setWinKeys(new Set()), 3000); // the rings fade; hub + rail keep the story
    };
    landRef.current = settle; // resolves exactly when the ball seats
    later(() => {             // failsafe if frames are throttled (hidden tab)
      if (done || !landRef.current) return;
      S.mode = "seated"; S.seatIdx = idx; S.drop = null; S.target = IDLE_SPD;
      landRef.current = null;
      settle();
    }, 9000);
  }

  // ── readout line — server errors take it over, in red ─────────────────────
  let readText = "", readColor = T.muted, readGlow = "rgba(0,0,0,0)", readOpacity = 1, readSize = 26;
  if (error) { readText = error; readColor = "#ff6a5a"; readGlow = "rgba(255,90,74,.55)"; }
  else if (lock) { readText = "NO MORE BETS"; readColor = T.gold; readGlow = "rgba(240,217,154,.5)"; readSize = 30; }
  else if (phase === "settled") {
    readSize = 34;
    if (lastPayout > 0) { readText = "WIN +" + fmtMKD(lastPayout); readColor = T.win; readGlow = "rgba(46,230,166,.5)"; }
    // NO WIN stays readable in neutral grey — the wheel's own reds are the
    // only reds on this screen, and they mean "red pocket", not "you lost".
    else { readText = "NO WIN"; readColor = T.text2; readSize = 28; }
  } else if (totalStaked > 0) { readText = "PRESS SPIN"; readOpacity = 0.8; }
  else { readText = "PLACE YOUR BETS"; readOpacity = 0.8; }

  // header status chip: last win
  const chipHdr = lock
    ? { label: "SPINNING", color: T.gold }
    : lastPayout != null
      ? (lastPayout > 0 ? { label: "+" + fmtMKD(lastPayout), color: T.win } : { label: "NO WIN", color: T.text2 })
      : { label: "READY", color: T.text2 };

  const hubHex = hubN != null ? BRIGHT_HEX[pocketKind(hubN)] : T.muted;

  const stat = (label, value, color = T.text) => (
    <div key={label} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "clamp(7px, 1.4vh, 12px) 3px", borderRadius: 14, border: `2px solid ${T.ctlBorder}`, background: "rgba(255,255,255,.03)" }}>
      <span style={{ fontSize: "clamp(9px, 1.5vh, 11px)", letterSpacing: 1.5, color: T.muted, whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: "clamp(12px, 2.1vh, 16px)", fontWeight: 700, color, whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );

  // one Spot on the board, wired to the shared placing rules
  const spot = (key, shape, label, tint, extra = {}, fs = "clamp(14px, 2.3vh, 21px)") => {
    const isNum = shape.type === "straight";
    const won = winKeys.has(key);
    const bare = isNum && winPocket === shape.n && !won;
    return (
      <Spot key={key} spotKey={key} tapReg={tapReg.current} label={label} tint={tint} fs={fs}
        stake={bets[key]?.stake || 0}
        win={won || bare}
        ringColor={won ? "rgba(240,217,154,.85)" : bare ? BRIGHT_HEX[pocketKind(shape.n)] : undefined}
        disabled={lock}
        onTap={() => place(key, shape)}
        style={extra} />
    );
  };

  // ── grid-level staking: press to stake, HOLD to repeat, and SLIDE across
  // cells while holding to spam different numbers (each newly entered cell
  // stakes immediately and becomes the repeat target).
  const cellKeyAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const btn = el && el.closest ? el.closest("[data-spot]") : null;
    return btn && !btn.disabled ? btn.getAttribute("data-spot") : null;
  };
  const stakeKey = (key) => { const ref = tapReg.current.get(key); if (ref) ref.current(); };
  const gridDown = (e) => {
    if (lock || (e.pointerType === "mouse" && e.button !== 0)) return;
    const key = cellKeyAt(e.clientX, e.clientY);
    if (!key) return;
    e.preventDefault();
    const h = hold.current;
    clearTimeout(h.t);
    h.active = true; h.key = key; h.n = 0;
    stakeKey(key);
    const tick = () => { h.n++; stakeKey(h.key); h.t = setTimeout(tick, h.n >= 5 ? 150 : 300); };
    h.t = setTimeout(tick, 300);
  };
  const gridMove = (e) => {
    const h = hold.current;
    if (!h.active) return;
    const key = cellKeyAt(e.clientX, e.clientY);
    if (key && key !== h.key) { h.key = key; h.n = 0; stakeKey(key); } // new cell stakes at once
  };
  const gridUp = () => { const h = hold.current; clearTimeout(h.t); h.active = false; h.key = null; };

  const cellRow = "minmax(clamp(44px, 7vh, 62px), 1fr)";
  const stripRow = "minmax(clamp(44px, 6vh, 54px), auto)";

  return (
    <SpaceRoot>
      <SpaceBackground variant="game" fastDur={12} />

      {/* gold win flash */}
      <div style={{ position: "absolute", inset: 0, zIndex: 8, pointerEvents: "none", background: "radial-gradient(circle at 50% 50%, rgba(240,217,154,.4), rgba(240,217,154,0) 70%)", opacity: flash ? 1 : 0, transition: "opacity .3s ease" }} />

      <SpaceHeader title="ROULETTE" chip={chipHdr} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", gap: 0 }}>

        {/* ── left control panel ── */}
        <SpaceSidebar>
          <SoundButton />
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 2vh, 16px)", opacity: lock ? 0.4 : 1, pointerEvents: lock ? "none" : "auto", transition: "opacity .2s ease" }}>
            <BetStepper bet={chipVal} setBet={setChipVal} disabled={lock} maxBet={MAX_BET} />
            <div style={{ fontSize: "clamp(10px, 1.7vh, 13px)", letterSpacing: 1.5, lineHeight: 1.5, color: T.muted }}>
              THE CHIP — EVERY TAP ON THE BOARD STAKES THIS AMOUNT
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {stat("TOTAL BET", fmtMKD(totalStaked), T.gold)}
              {stat("SPOTS", String(Object.keys(bets).length))}
              {stat("LAST WIN", fmtMKD(lastPayout || 0), lastPayout > 0 ? T.win : T.text)}
            </div>
          </div>
        </SpaceSidebar>

        {/* ── game column ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* readout */}
          <div style={{ position: "relative", zIndex: 4, height: 46, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ opacity: readOpacity, fontSize: readSize, fontWeight: 700, letterSpacing: 3, color: readColor, textShadow: `0 0 28px ${readGlow}`, transition: "opacity .25s ease" }}>{readText}</div>
          </div>

          {/* wheel + board */}
          <div style={{ position: "relative", zIndex: 4, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", gap: "clamp(8px, 1.4vw, 26px)", padding: "0 clamp(10px, 1.6vw, 24px) 0 clamp(6px, 1vw, 16px)" }}>

            {/* ── the GRAVITY WHEEL ── */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ position: "relative", width: "min(100%, 58vh)", aspectRatio: "1 / 1" }}>
                {/* rim + ball groove */}
                <div style={{ position: "absolute", inset: 0, zIndex: 1, borderRadius: "50%", background: "radial-gradient(circle at 50% 40%, #1b2434, #0b101c 72%)", border: "clamp(3px, .5vh, 5px) solid #7a5e2c", boxShadow: "0 0 44px rgba(240,217,154,.14), 0 18px 50px rgba(0,0,0,.55), inset 0 0 34px rgba(0,0,0,.75)" }} />
                <div style={{ position: "absolute", inset: "6%", zIndex: 1, borderRadius: "50%", border: "1.5px solid rgba(217,178,106,.35)" }} />
                {/* the rotor: pockets + numbers + cone, driven by the rAF loop */}
                <div ref={rotorRef} style={{ position: "absolute", inset: "8%", zIndex: 2, borderRadius: "50%", willChange: "transform" }}>
                  <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `${WHEEL_SEPS}, ${WHEEL_CONIC}`, boxShadow: "inset 0 0 0 2px rgba(217,178,106,.55), inset 0 0 30px rgba(0,0,0,.5)" }} />
                  <svg viewBox="0 0 200 200" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                    {WHEEL_ORDER.map((n, i) => (
                      <g key={n} transform={`rotate(${(i * STEP).toFixed(3)} 100 100)`}>
                        <text x="100" y="17" textAnchor="middle" fontSize="7.8" fontWeight="700" fontFamily="'DM Sans', Helvetica, sans-serif" fill="#f2f5fa" stroke="rgba(0,0,0,.45)" strokeWidth=".7" paintOrder="stroke">{n}</text>
                      </g>
                    ))}
                  </svg>
                  <div style={{ position: "absolute", inset: "29%", borderRadius: "50%", background: "radial-gradient(circle at 50% 36%, #1a2436, #0a0e18 80%)", border: "2px solid rgba(217,178,106,.5)", boxShadow: "inset 0 0 22px rgba(0,0,0,.65), 0 0 18px rgba(0,0,0,.5)" }} />
                </div>
                {/* center hub readout (static — doesn't rotate) */}
                <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "31%", aspectRatio: "1 / 1", zIndex: 4, borderRadius: "50%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "3%", background: "radial-gradient(circle at 50% 34%, #1a2436, #0a0e18 78%)", border: "clamp(2px, .4vh, 4px) solid #7a5e2c", boxShadow: "0 0 26px rgba(0,0,0,.6), inset 0 2px 0 rgba(255,255,255,.06)" }}>
                  {hubN == null
                    ? <span style={{ fontSize: "clamp(24px, 6vh, 52px)", fontWeight: 700, color: T.muted, opacity: 0.6 }}>—</span>
                    : <span key={hubKey} style={{ fontSize: "clamp(30px, 7.5vh, 64px)", fontWeight: 700, lineHeight: 1, color: hubHex, opacity: lock ? 0.3 : 1, textShadow: `0 0 30px ${hubHex}66`, animation: lock ? "none" : "rlHubPop .5s cubic-bezier(.2,1.5,.4,1) both", transition: "opacity .3s ease" }}>{hubN}</span>}
                  <span style={{ fontSize: "clamp(8px, 1.4vh, 12px)", letterSpacing: 3, color: lock ? T.gold : T.muted, transition: "color .3s ease" }}>
                    {lock ? "SPINNING" : hubN != null ? "WINNER" : ""}
                  </span>
                </div>
                {/* the gold ball — rotation wrapper + radius-positioned dot */}
                <div ref={ballRotRef} style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", opacity: 0, willChange: "transform" }}>
                  <div ref={ballDotRef} style={{ position: "absolute", left: "50%", top: (50 - ORBIT_R) + "%", width: "3.4%", aspectRatio: "1 / 1", transform: "translate(-50%,-50%)", borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #ffffff, #f0d99a 55%, #a9843e)", boxShadow: "0 0 12px rgba(240,217,154,.9), 0 2px 5px rgba(0,0,0,.6)" }} />
                </div>
              </div>
            </div>

            {/* ── the betting board ── */}
            <div style={{ flex: 1.18, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(8px, 1.6vh, 16px)" }}>

              {/* recent winning numbers rail (empty until the first spin) */}
              <div style={{ flex: "none", minHeight: "clamp(28px, 5vh, 40px)", display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(5px, .7vw, 10px)" }}>
                {recent.map((n, i) => (
                  <span key={hubKey + "-" + i} style={{ width: "clamp(26px, 4.6vh, 38px)", height: "clamp(26px, 4.6vh, 38px)", borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "clamp(12px, 2vh, 16px)", fontWeight: 700, color: "#f2f5fa", background: POCKET_HEX[pocketKind(n)], border: "2px solid rgba(255,255,255,.14)", boxShadow: "0 2px 8px rgba(0,0,0,.45)", opacity: 1 - i * 0.09, animation: i === 0 ? "rlPillIn .35s cubic-bezier(.2,1.5,.4,1) both" : "none" }}>{n}</span>
                ))}
              </div>

              {/* European layout grid — press to stake, hold to repeat, slide
                  across cells to spam several numbers. Sits on an opaque panel
                  so the drifting sun never shows through the board. */}
              <div
                onPointerDown={gridDown} onPointerMove={gridMove}
                onPointerUp={gridUp} onPointerLeave={gridUp} onPointerCancel={gridUp}
                style={{ width: "min(100%, 940px)", padding: "clamp(5px, .8vh, 9px)", borderRadius: 14, background: "#070a12", border: `1px solid ${T.panelBorder}`, boxShadow: "0 10px 30px rgba(0,0,0,.5)", opacity: lock ? 0.55 : 1, pointerEvents: lock ? "none" : "auto", transition: "opacity .25s ease", touchAction: "none", display: "grid", gridTemplateColumns: "1.15fr repeat(12, 1fr) 1.15fr", gridTemplateRows: `repeat(3, ${cellRow}) repeat(2, ${stripRow})`, gap: "clamp(3px, .5vh, 6px)" }}>
                {/* zero — spans the three number rows */}
                {spot("n0", { type: "straight", n: 0 }, "0", "green", { gridColumn: 1, gridRow: "1 / span 3" }, "clamp(17px, 2.8vh, 25px)")}
                {/* 1–36, three rows of twelve */}
                {NUM_CELLS.map((c) => spot("n" + c.n, { type: "straight", n: c.n }, String(c.n), pocketKind(c.n), { gridColumn: c.col, gridRow: c.row }))}
                {/* column bets, right edge */}
                {COLUMNS.map((c) => spot(c.key, { type: "column", n: c.n }, "2:1", undefined, { gridColumn: 14, gridRow: c.row }, "clamp(12px, 2vh, 16px)"))}
                {/* dozens */}
                {DOZENS.map((d) => spot(d.key, { type: "dozen", n: d.n }, d.label, undefined, { gridColumn: `${d.colS} / span 4`, gridRow: 4, letterSpacing: 2 }, "clamp(12px, 2vh, 16px)"))}
                {/* even-money strip */}
                {OUTSIDE.map((o, i) => spot(o.key, { type: o.type }, o.label, o.tint, { gridColumn: `${2 + i * 2} / span 2`, gridRow: 5, letterSpacing: 2 }, "clamp(12px, 2vh, 16px)"))}

                {/* inside-bet zones — the lines and corners between numbers.
                    They ride on top of the cells (z-index) so a tap on a line
                    makes the split/corner/street bet, exactly like real felt. */}
                {INSIDE_ZONES.map((z) => {
                  const key = zoneKey(z);
                  const stake = bets[key]?.stake || 0;
                  const won = winKeys.has(key);
                  const TH = "clamp(13px, 2vh, 20px)";
                  const base = { gridColumn: z.col, gridRow: z.row };
                  const pos =
                    z.kind === "v" ? { justifySelf: "end", alignSelf: "stretch", width: TH, transform: "translateX(52%)" }
                      : z.kind === "h" ? { alignSelf: "end", justifySelf: "stretch", height: TH, transform: "translateY(52%)" }
                        : z.kind === "c" ? { justifySelf: "end", alignSelf: "end", width: TH, height: TH, transform: "translate(52%, 52%)" }
                          : z.kind === "s" ? { alignSelf: "end", justifySelf: "stretch", height: TH, transform: "translateY(52%)" }
                            : { justifySelf: "end", alignSelf: "end", width: TH, height: TH, transform: "translate(52%, 52%)" };
                  return (
                    <Spot key={key} spotKey={key} tapReg={tapReg.current}
                      zone stake={stake} win={won}
                      ringColor={won ? "rgba(240,217,154,.85)" : undefined}
                      disabled={lock}
                      onTap={() => place(key, { type: "inside", ns: z.ns })}
                      title={ZONE_LABEL[z.kind]}
                      style={{ ...base, ...pos }} />
                  );
                })}
              </div>

              {/* chip denominations — BELOW the board, like a real rack. Tap a
                  chip to set the staking amount; the sidebar stepper is the
                  custom chip (last one touched wins, a chip lights only while
                  the live value matches it). */}
              <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(8px, 1vw, 15px)", opacity: lock ? 0.55 : 1, pointerEvents: lock ? "none" : "auto", transition: "opacity .25s ease" }}>
                {CHIP_DENOMS.map((d) => {
                  const c = CHIP_STYLE[d];
                  return (
                    <button key={d} disabled={lock} aria-label={`Chip ${d}`}
                      onClick={() => { rlSfx.click(); setChipVal(d); }}
                      className={"rl-chip" + (chipVal === d ? " rl-chip-on" : "")}
                      style={{ background: `radial-gradient(circle at 50% 38%, ${c.hi}, ${c.base} 62%, ${c.dark})` }}>
                      {/* edge dashes */}
                      <span className="rl-chip-edge" />
                      {/* inner face + denomination */}
                      <span className="rl-chip-face" style={{ background: `radial-gradient(circle at 50% 35%, ${c.hi}, ${c.base})`, color: c.ink }}>{d}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── bottom bar ── */}
          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", gap: "clamp(8px, 1vw, 14px)", margin: "10px clamp(10px, 1.6vw, 24px) 20px 10px" }}>
            <button onClick={() => { rlSfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 30px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>LOBBY
            </button>
            <button onClick={() => { rlSfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={{ flex: "none", width: "clamp(56px, 11vh, 88px)", minHeight: "clamp(56px, 11vh, 88px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" /></svg>
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={clearAll} disabled={lock || totalStaked === 0} className="sp-hover-gold"
              style={{ minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 32px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: (lock || totalStaked === 0) ? "default" : "pointer", opacity: (lock || totalStaked === 0) ? 0.35 : 1, transition: "opacity .2s ease" }}>CLEAR</button>
            <button onClick={rebet} disabled={lock || !lastLayoutRef.current} className="sp-hover-gold"
              style={{ minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 32px)", borderRadius: 20, border: "3px dashed #3a4557", background: T.panelBg, color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: (lock || !lastLayoutRef.current) ? "default" : "pointer", opacity: (lock || !lastLayoutRef.current) ? 0.35 : 1, transition: "opacity .2s ease" }}>REBET</button>
            <GoldButton label={lock ? "SPINNING…" : "SPIN"} sub={totalStaked > 0 ? fmtMKD(totalStaked) : undefined}
              onClick={spin} disabled={lock || totalStaked <= 0} labelSize="clamp(21px, 2.2vw, 32px)"
              style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 }} />
          </div>

        </div>
      </div>

      {rules && <RulesModal onClose={() => setRules(false)} />}
    </SpaceRoot>
  );
}
