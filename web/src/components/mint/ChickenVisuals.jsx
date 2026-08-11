// Chicken Cross — the design system's full road stage, ported 1:1 from the
// original Claude Design deliverable (MintBets Design System ui_kits/game-shell/
// ChickenGame.jsx). Everything visual lives here: the metro train the chicken
// steps off, the synced traffic light, manhole-cover multiplier medallions,
// steam-leaking gas lanes, continuous ambient traffic with headway control,
// rush-and-save choreography (bollards bursting out of the road to take a hit),
// the two death types (car strike / green gas blast with the looming skull),
// and the camera that pans/zooms the road after the chicken.
// Assets are the design's own art, pre-downscaled into /games/chicken/*.
// Only the module plumbing differs from the original: ES imports, our sound
// engine, and server-driven outcomes passed down as props (no local RNG for
// anything that pays — steam lanes, save theatre and car picks stay cosmetic).
import React from "react";
import { sound as snd } from "../../lib/sound";

// ── layout constants (design-exact) ─────────────────────────────────────────
export const SIDEWALK_W = 240, LANE_W = 150, GOAL_W = 148;
const CAR_FALL_MS = 820;         // a death car takes this long to fall the whole lane (fast, hard hit)
const CAR_IMPACT_FRAC = 0.46;    // fraction of that fall at which it overlaps the chicken
export const CAR_IMPACT_MS = Math.round(CAR_FALL_MS * CAR_IMPACT_FRAC);

const A = "/games/chicken";
const fmt = (n) => (isFinite(n) ? n : 0).toFixed(2);

// ── keyframes (from the design's ChickenCross.html) — injected once ─────────
const KEYFRAMES = `
@keyframes chk-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
@keyframes chk-steam { 0% { transform: translate(-50%,0) scale(0.5); opacity: 0; } 18% { opacity: 0.85; } 100% { transform: translate(-50%,-46px) scale(1.7); opacity: 0; } }
@keyframes chk-ring { 0%, 100% { opacity: 0.4; transform: translate(-50%,-50%) scale(0.96); } 50% { opacity: 1; transform: translate(-50%,-50%) scale(1.05); } }
@keyframes chk-bollard-up { 0% { transform: translateY(37px); } 100% { transform: translateY(0); } }
@keyframes chk-bollard-hit { 0% { transform: translateY(0) rotate(0deg); } 20% { transform: translateY(0.5px) rotate(-2.5deg); } 45% { transform: translateY(0) rotate(1.8deg); } 70% { transform: translateY(0) rotate(-1deg); } 100% { transform: translateY(0) rotate(0deg); } }
@keyframes chk-bollard-dust { 0% { transform: translate(-50%,0) scale(0.3); opacity: 0; } 25% { opacity: 0.55; } 100% { transform: translate(-50%,-8px) scale(1.9); opacity: 0; } }
@keyframes chk-wreck-smoke { 0% { transform: translate(-50%,-50%) translate(0,0) scale(0.4); opacity: 0; } 12% { opacity: 0.55; } 60% { opacity: 0.3; } 100% { transform: translate(-50%,-50%) translate(var(--sx), var(--sy)) scale(var(--ss)); opacity: 0; } }
@keyframes chk-dent-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes chk-car-crush { 0% { transform: scaleY(1); } 40% { transform: scaleY(0.93); } 100% { transform: scaleY(0.965); } }
@keyframes chk-spark { 0% { transform: translate(-50%,-50%) translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(-50%,-50%) translate(var(--ex), var(--ey)) scale(0.25); opacity: 0; } }
@keyframes chk-impact-flash { 0% { transform: translate(-50%,-50%) scale(0.3); opacity: 0.9; } 100% { transform: translate(-50%,-50%) scale(1.9); opacity: 0; } }
@keyframes chk-boom-core { 0% { transform: translate(-50%,-50%) scale(0.15); opacity: 0; } 12% { opacity: 1; } 45% { transform: translate(-50%,-50%) scale(1.05); opacity: 1; } 100% { transform: translate(-50%,-50%) scale(1.5); opacity: 0; } }
@keyframes chk-boom-ring { 0% { transform: translate(-50%,-50%) scale(0.1); opacity: 0.9; } 100% { transform: translate(-50%,-50%) scale(2.4); opacity: 0; } }
@keyframes chk-boom-ring2 { 0% { transform: translate(-50%,-50%) scale(0.1); opacity: 0.7; } 100% { transform: translate(-50%,-50%) scale(3.3); opacity: 0; } }
@keyframes chk-ember { 0% { transform: translate(-50%,-50%) translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(-50%,-50%) translate(var(--ex), var(--ey)) scale(0.2); opacity: 0; } }
@keyframes chk-smoke { 0% { transform: translate(-50%,-50%) translate(0,0) scale(0.3); opacity: 0; } 14% { opacity: 0.85; } 55% { opacity: 0.6; } 100% { transform: translate(-50%,-50%) translate(var(--sx), var(--sy)) scale(var(--ss)); opacity: 0; } }
@keyframes chk-haze { 0% { transform: translate(-50%,-46%) scale(0.4); opacity: 0; } 20% { opacity: 0.8; } 100% { transform: translate(-50%,-58%) scale(1.7); opacity: 0; } }
@keyframes chk-skull { 0% { transform: translate(-50%,-78%) scale(0.5); opacity: 0; } 24% { transform: translate(-50%,-112%) scale(0.95); opacity: 0.85; } 54% { transform: translate(-50%,-122%) scale(1.05); opacity: 0.7; } 100% { transform: translate(-50%,-150%) scale(1.4); opacity: 0; } }
@keyframes chk-shake { 0%,100% { transform: translate(0,0); } 20% { transform: translate(-4px,3px); } 40% { transform: translate(4px,-2px); } 60% { transform: translate(-3px,-3px); } 80% { transform: translate(3px,2px); } }
.chk-shake-on { animation: chk-shake 0.4s ease-in-out 1; }
`;

// ── chicken (image sprite frames) ───────────────────────────────────────────
const FRAMES = {
  idle: `${A}/chicken-idle.webp`, crouch: `${A}/chicken-crouch.webp`,
  mid: `${A}/chicken-mid.webp`, fly: `${A}/chicken-fly.webp`,
  splat: `${A}/splat.webp`, splatGas: `${A}/splat-gas.webp`,
};
export const CARS = ["truck", "sport", "red", "purple", "taxi", "classic", "muscle"].map((n) => `${A}/car-${n}.webp`);
export const pickCar = () => CARS[Math.floor(Math.random() * CARS.length)];

let preloaded = false;
export function preloadChickenArt() {
  if (preloaded || typeof Image === "undefined") return;
  preloaded = true;
  [...Object.values(FRAMES), ...CARS, `${A}/tree.webp`].forEach((s) => { const im = new Image(); im.src = s; });
}

export function Chicken({ splat, hopKey, deathType }) {
  const [frame, setFrame] = React.useState("idle");
  const tRef = React.useRef([]);
  const hopRef = React.useRef(null);
  const shRef = React.useRef(null);
  const clearAll = () => { tRef.current.forEach(clearTimeout); tRef.current = []; };
  const playedRef = React.useRef(0);
  React.useEffect(() => {
    // play each hop exactly once (ref guard) — and even on a DEATH hop: `dead` lands in the
    // same render as the hop now that the killer car launches immediately, so gating on
    // `frozen` here would swallow the jump animation and the chicken would just teleport
    if (!hopKey || playedRef.current === hopKey || splat) return;
    playedRef.current = hopKey;
    clearAll();
    // crouch → rise → wings-out apex → descend → land: a quick, snappy leap
    const seq = [["crouch", 0], ["mid", 42], ["fly", 96], ["mid", 185], ["idle", 255]];
    seq.forEach(([f, ms]) => tRef.current.push(setTimeout(() => setFrame(f), ms)));
    // drive the arc with WAAPI so the image elements never remount (no first-hop flash)
    const el = hopRef.current;
    if (el && el.animate) {
      el.style.transformOrigin = "50% 92%";
      el.animate(
        [
          { transform: "translateY(0) scale(1,1)" },
          { transform: "translateY(3px) scale(1.08,0.88)", offset: 0.13 },
          { transform: "translateY(-34px) scale(0.95,1.07)", offset: 0.5 },
          { transform: "translateY(-9px) scale(0.99,1.02)", offset: 0.8 },
          { transform: "translateY(2px) scale(1.06,0.9)", offset: 0.92 },
          { transform: "translateY(0) scale(1,1)" },
        ],
        { duration: 270, easing: "cubic-bezier(0.33,0.85,0.56,1)" }
      );
    }
    // the ground shadow shrinks while airborne, snaps back on landing
    const sh = shRef.current;
    if (sh && sh.animate) {
      sh.animate(
        [
          { transform: "translateX(-50%) scale(1)", opacity: 1 },
          { transform: "translateX(-50%) scale(0.68)", opacity: 0.5, offset: 0.5 },
          { transform: "translateX(-50%) scale(1)", opacity: 1 },
        ],
        { duration: 270, easing: "linear" }
      );
    }
    return clearAll;
  }, [hopKey, splat]);
  React.useEffect(() => clearAll, []);

  const W = 102;
  // tyre-track splat only when run over by a car; gas/explosion deaths use the clean splat
  const splatFrame = deathType === "steam" ? "splatGas" : "splat";
  const active = splat ? splatFrame : frame;
  return (
    <div style={{ position: "relative", width: W, height: W }}>
      {/* soft ground shadow — hidden when struck so the flattened chicken sits flush */}
      {!splat && <div ref={shRef} style={{ position: "absolute", left: "50%", bottom: 8, transform: "translateX(-50%)", width: 52, height: 13, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,0,0,0.5), transparent 70%)", filter: "blur(1.5px)" }} />}
      <div ref={hopRef} style={{ position: "absolute", inset: 0, willChange: "transform" }}>
        {/* all frames stay mounted (decoded once) — only opacity toggles, so no
            swap flicker. No CSS filters: the chicken rides the panning camera
            and hops on WAAPI transforms, and a filtered moving element
            re-rasterises per frame on iOS Safari — the breathing ground-shadow
            div below the sprite does the grounding instead. */}
        {["idle", "crouch", "mid", "fly", "splat", "splatGas"].map((f) => (
          <img key={f} src={FRAMES[f]} alt="chicken" draggable="false"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity: f === active ? 1 : 0 }} />
        ))}
      </div>
    </div>
  );
}

// ── car (top-down image) ────────────────────────────────────────────────────
// NO CSS filters here: cars move constantly, and `filter` on a moving element
// re-rasterises per frame on iOS Safari (the roulette-ball lesson). The drop
// shadow is a composited radial-gradient div under the car, and lane dimming
// is a translucent dark overlay — both pure GPU layers.
function CarBase({ src, dim = 0 }) {
  return (
    <span style={{ position: "relative", display: "block" }}>
      <span aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: -6, transform: "translateX(-50%)", width: "84%", height: 26, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(0,0,0,0.5), rgba(0,0,0,0.18) 62%, transparent)", pointerEvents: "none" }} />
      <img src={src} alt="" draggable={false}
        style={{ position: "relative", display: "block", height: 158, width: "auto", pointerEvents: "none", userSelect: "none" }} />
      {dim > 0 && <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: "rgba(6,12,18," + (dim * 0.72).toFixed(2) + ")", borderRadius: 16, pointerEvents: "none" }} />}
    </span>
  );
}
const Car = React.memo(CarBase);

// a single car that drives straight down its lane (WAAPI for a smooth, glitch-free pass)
function DriveCar({ x, src, dur, H, easing = "linear", dim = 0, rush = false, onBlocked, onDone, startY, endY }) {
  const ref = React.useRef(null);
  const animRef = React.useRef(null);
  const exitY = endY != null ? endY : H * 0.55 + 180;
  const enterY = startY != null ? startY : -H * 0.55 - 180;
  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    if (!el.animate) { if (onDone) onDone(); return; }
    const a = el.animate(
      [{ transform: "translate(-50%, " + enterY + "px)" },
       { transform: "translate(-50%, " + exitY + "px)" }],
      { duration: dur, easing, fill: "forwards" }
    );
    animRef.current = a;
    if (onDone) a.onfinish = onDone;
    return () => a.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // floor it: when the chicken hops into this lane, the car accelerates out of the way
  React.useEffect(() => {
    if (!rush) return;
    const el = ref.current, a = animRef.current;
    if (!el || !a) return;
    let curY = exitY;
    try { curY = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42; } catch { /* keep exitY */ }
    if (curY >= exitY - 6) return;                 // already clear of the chicken
    // still fully ABOVE the bollard line → it can't believably outrun the chicken from
    // way up there; the handler decides: save round → bollards stop THIS car (returns true);
    // death round → no save, fall through and floor it out of the killer's path
    if (onBlocked && curY + 158 <= -131 && onBlocked(curY)) { a.cancel(); return; }
    a.cancel();
    const b = el.animate(
      [{ transform: "translate(-50%, " + curY + "px)" },
       { transform: "translate(-50%, " + exitY + "px)" }],
      { duration: 300, easing: "cubic-bezier(0.32, 0, 0.62, 1)", fill: "forwards" }   // ease-in: stamps on the gas
    );
    animRef.current = b;
    if (onDone) b.onfinish = onDone;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rush]);
  return (
    <div ref={ref} style={{ position: "absolute", top: "50%", left: x, transform: "translate(-50%, " + enterY + "px)", willChange: "transform" }}>
      <Car src={src} dim={dim} />
    </div>
  );
}

// ── green manhole-gas explosion ─────────────────────────────────────────────
function Boom() {
  // a few embers flung outward at random angles
  const embers = React.useMemo(() => Array.from({ length: 11 }).map(() => {
    const a = Math.random() * Math.PI * 2, d = 34 + Math.random() * 46;
    return { ex: Math.cos(a) * d, ey: Math.sin(a) * d, sz: 5 + Math.random() * 7, delay: Math.random() * 60 };
  }), []);
  // billowing green gas — lots of soft puffs fanning mostly upward, expanding + fading slowly
  const smoke = React.useMemo(() => Array.from({ length: 16 }).map(() => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.3;     // upward fan
    const d = 26 + Math.random() * 66;
    return {
      sx: Math.cos(a) * d,
      sy: Math.sin(a) * d - (18 + Math.random() * 46),         // strong upward bias
      ss: 2.3 + Math.random() * 2.8,
      sz: 20 + Math.random() * 30,
      dur: 1.7 + Math.random() * 1.3,
      delay: Math.random() * 320,
      op: 0.4 + Math.random() * 0.4,
      toxic: Math.random() < 0.5,
    };
  }), []);
  return (
    <div style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, pointerEvents: "none", zIndex: 9 }}>
      {/* billowing gas cloud (behind the burst) */}
      {smoke.map((s, i) => (
        <div key={"s" + i} style={{ position: "absolute", left: "50%", top: "50%", width: s.sz, height: s.sz, borderRadius: "50%",
          background: s.toxic
            ? "radial-gradient(circle at 48% 42%, rgba(196,246,150,0.95), rgba(108,210,124,0.7) 44%, transparent 72%)"
            : "radial-gradient(circle at 48% 42%, rgba(150,200,150,0.8), rgba(86,140,104,0.6) 46%, transparent 73%)",
          filter: "blur(5px)", mixBlendMode: "screen",
          "--sx": s.sx + "px", "--sy": s.sy + "px", "--ss": s.ss,
          transform: "translate(-50%,-50%) scale(0.3)", opacity: 0,
          animation: `chk-smoke ${s.dur}s ease-out ${s.delay}ms forwards` }} />
      ))}
      {/* lingering low ground haze */}
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 150, height: 84, borderRadius: "50%",
        background: "radial-gradient(circle at 50% 50%, rgba(120,210,130,0.5), rgba(70,150,90,0.22) 52%, transparent 76%)",
        filter: "blur(8px)", transform: "translate(-50%,-46%) scale(0.4)", opacity: 0,
        animation: "chk-haze 2.4s ease-out forwards" }} />
      {/* death's-head skull looming as a dark shadow inside the gas */}
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 78, height: 78,
        transform: "translate(-50%,-78%) scale(0.5)", opacity: 0, mixBlendMode: "multiply",
        animation: "chk-skull 2.4s ease-out 0.18s forwards" }}>
        <svg viewBox="0 0 64 64" width="100%" height="100%" style={{ filter: "blur(1.2px)", overflow: "visible" }}>
          <g fill="rgba(18,52,30,0.82)">
            <path d="M32 5c-12 0-20 8.4-20 20 0 6.4 2.7 10.6 5.6 13.4 1.5 1.4 2.2 2.6 2.3 4.6l.3 4.2c.1 1.8 1.3 2.8 3 2.8h2.1l.0-5.2c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v5.2h2.4v-5.2c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v5.2h2.1c1.7 0 2.9-1 3-2.8l.3-4.2c.1-2 .8-3.2 2.3-4.6C49.3 36.2 52 32 52 25.6 52 13.4 44 5 32 5z" />
          </g>
          <g fill="rgba(6,26,14,0.92)">
            <ellipse cx="23" cy="26" rx="6.6" ry="7.4" />
            <ellipse cx="41" cy="26" rx="6.6" ry="7.4" />
            <path d="M32 32c-2 2.4-3.4 4-3.4 6 0 2 1.5 3.2 3.4 3.2s3.4-1.2 3.4-3.2c0-2-1.4-3.6-3.4-6z" />
          </g>
          <g fill="rgba(150,240,150,0.5)">
            <circle cx="23" cy="27" r="1.8" />
            <circle cx="41" cy="27" r="1.8" />
          </g>
        </svg>
      </div>
      {/* expanding shock rings */}
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 64, height: 64, borderRadius: "50%", border: "5px solid rgba(190,255,130,0.95)", animation: "chk-boom-ring 0.55s cubic-bezier(0.2,0.7,0.3,1) forwards" }} />
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 64, height: 64, borderRadius: "50%", border: "3px solid rgba(120,245,140,0.8)", animation: "chk-boom-ring2 0.7s cubic-bezier(0.2,0.7,0.3,1) forwards" }} />
      {/* bright core burst */}
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 96, height: 96, borderRadius: "50%",
        background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.98) 0%, rgba(214,255,140,0.95) 24%, rgba(96,240,120,0.85) 52%, rgba(40,190,90,0.4) 74%, transparent 82%)",
        filter: "blur(0.5px)", animation: "chk-boom-core 0.6s ease-out forwards" }} />
      {/* embers */}
      {embers.map((e, i) => (
        <div key={i} style={{ position: "absolute", left: "50%", top: "50%", width: e.sz, height: e.sz, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(220,255,150,1), rgba(80,230,110,0.8) 60%, transparent)",
          "--ex": e.ex + "px", "--ey": e.ey + "px",
          animation: `chk-ember 0.6s ease-out ${e.delay}ms forwards` }} />
      ))}
    </div>
  );
}

// ── bollard near-miss save ──────────────────────────────────────────────────
// A rogue car charges the chicken's lane; safety bollards burst out of the
// asphalt just above the crossing and take the hit instead of the chicken.
// Timeline (ms from mount): riseMs bollards rise · impactMs impact (sparks,
// crumple, crash sound) — sounds are scheduled by the brain's triggerSave()
// so they stay in sync with these.
function BollardSave({ carSrc, H, startY, impactMs = 620, riseMs = 180, dim = 0 }) {
  const imp = impactMs / 1000, rise = riseMs / 1000;
  const carRef = React.useRef(null);
  const sparks = React.useMemo(() => Array.from({ length: 18 }).map(() => {
    const a = Math.PI * (1.05 + Math.random() * 0.9);   // fan up and sideways
    const d = 20 + Math.random() * 46;
    return { ex: Math.cos(a) * d, ey: Math.sin(a) * d - 8, sz: 2.5 + Math.random() * 4.5, dl: Math.random() * 90 };
  }), []);
  React.useEffect(() => {
    const el = carRef.current; if (!el || !el.animate) return;
    const enterY = startY != null ? startY : -(H * 0.62 + 200);
    // car img is 158px tall, bumper at its bottom edge; visible post tops sit at
    // 50% - 131px → crashY = -131 - 158 + small crush so the bumper stops ON the
    // posts instead of driving through them
    const crashY = -287;
    el.animate(
      [
        { transform: "translate(-50%," + enterY + "px) rotate(0deg)" },
        { transform: "translate(-50%," + crashY + "px) rotate(0deg)", offset: 0.6 },
        { transform: "translate(-50%," + (crashY - 14) + "px) rotate(1.6deg)", offset: 0.68 },
        { transform: "translate(-50%," + (crashY - 2) + "px) rotate(-0.8deg)", offset: 0.82 },
        { transform: "translate(-50%," + (crashY - 5) + "px) rotate(0.4deg)" },
      ],
      { duration: Math.round(impactMs / 0.6), easing: "linear", fill: "forwards" }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* charging car — front end crushes + dents at the moment of impact */}
      <div ref={carRef} style={{ position: "absolute", top: "50%", left: LANE_W / 2, transform: "translate(-50%, " + (startY != null ? startY : -(H * 0.62 + 200)) + "px)", willChange: "transform" }}>
        <div style={{ position: "relative", transformOrigin: "50% 0%", animation: "chk-car-crush 0.3s ease-out " + (imp + 0.02) + "s both" }}>
          <Car src={carSrc} dim={dim} />
          {/* dented bumper/hood shading — invisible until the hit */}
          <div style={{ position: "absolute", left: "50%", bottom: 3, width: 48, height: 24, transform: "translateX(-50%)", borderRadius: "45% 45% 50% 50%",
            background: "radial-gradient(ellipse at 36% 62%, rgba(0,0,0,0.5), transparent 58%), radial-gradient(ellipse at 68% 42%, rgba(0,0,0,0.42), transparent 55%)",
            filter: "blur(1px)", opacity: 0, animation: "chk-dent-in 0.12s ease-out " + imp + "s both" }} />
          {/* buckled-metal crease highlight across the hood */}
          <div style={{ position: "absolute", left: "50%", bottom: 20, width: 34, height: 3, transform: "translateX(-50%) rotate(-4deg)", borderRadius: 2,
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4) 30%, rgba(255,255,255,0.12) 55%, rgba(255,255,255,0.35) 78%, transparent)",
            filter: "blur(0.5px)", opacity: 0, animation: "chk-dent-in 0.12s ease-out " + (imp + 0.02) + "s both" }} />
        </div>
      </div>
      {/* smoke wisps off the crumpled hood */}
      {[0, 1].map((k) => (
        <div key={"sm" + k} style={{ position: "absolute", left: LANE_W / 2 + (k ? -10 : 8), top: "calc(50% - 148px)", width: 16 + k * 6, height: 16 + k * 6, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(200,205,210,0.55), transparent 70%)", filter: "blur(3px)",
          "--sx": (k ? -14 : 10) + "px", "--sy": "-40px", "--ss": 2.2,
          transform: "translate(-50%,-50%) scale(0.3)", opacity: 0,
          animation: "chk-smoke 1.4s ease-out " + (imp + 0.12 + k * 0.25) + "s both" }} />
      ))}
      {/* wreck keeps smoking — dark looping puffs rising off the crumpled front */}
      {[0, 1, 2].map((k) => (
        <div key={"ws" + k} style={{ position: "absolute", left: LANE_W / 2 + [-9, 7, -2][k], top: "calc(50% - 146px)", width: 14 + k * 4, height: 14 + k * 4, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(66,72,78,0.6), rgba(120,128,135,0.35) 50%, transparent 72%)", filter: "blur(3px)",
          "--sx": [-13, 10, -4][k] + "px", "--sy": "-54px", "--ss": 2.4,
          transform: "translate(-50%,-50%) scale(0.4)", opacity: 0,
          animation: "chk-wreck-smoke 2.1s ease-out " + (imp + 0.2 + k * 0.7) + "s infinite" }} />
      ))}
      {/* open hole under each bollard — the retracted post's cap sits just below the surface until launch */}
      {[28.5, 75, 121.5].map((bx, i) => (
        <div key={"hole" + i} style={{ position: "absolute", left: bx, top: "calc(50% - 106px)", width: 26, height: 16, transform: "translate(-50%,-50%)", borderRadius: "50%",
          background: "radial-gradient(ellipse at 50% 30%, #0A1118 0 55%, #131C25 78%, rgba(90,104,116,0.6) 100%)",
          boxShadow: "0 1.5px 1.5px rgba(140,155,170,0.25)", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: "50%", top: "50%", width: 18, height: 10, transform: "translate(-50%,-42%)", borderRadius: "50%",
            background: "radial-gradient(ellipse at 38% 26%, #9AA9B6, #5E6C79 58%, #333E49 100%)",
            boxShadow: "inset 0 1.5px 2.5px rgba(0,0,0,0.55), inset 0 -1px 1.5px rgba(0,0,0,0.35)" }} />
        </div>
      ))}
      {/* the three bollards — steel cylinders seen at the same angle as their sockets */}
      {[19.5, 66, 112.5].map((bx, i) => (
        <div key={"b" + i} style={{ position: "absolute", left: bx, top: "calc(50% - 136px)", width: 18, height: 37,
          clipPath: "path('M0 -24 L18 -24 L18 35.8 Q9 40.2 0 35.8 Z')" }}>
          <div style={{ position: "absolute", inset: 0,
            transformOrigin: "50% 100%",
            transform: "translateY(37px)", animation: "chk-bollard-up 0.34s cubic-bezier(0.33,1,0.68,1) " + (rise + i * 0.05) + "s both" + (i === 1 ? ", chk-bollard-hit 0.32s ease-out " + imp + "s forwards" : "") }}>
            {/* body — the shaft runs the full depth of the opening */}
            <div style={{ position: "absolute", left: 0, right: 0, top: 5, bottom: 0, borderRadius: "0 0 9px 9px / 0 0 5px 5px",
              background: "linear-gradient(90deg,#2E3841 0%,#5A6875 18%,#9AA9B8 45%,#6B7885 64%,#39434D 100%)" }} />
            {/* matte reflective bands */}
            <div style={{ position: "absolute", left: 0, right: 0, top: 12, height: 6,
              background: "linear-gradient(90deg, rgba(46,140,102,0.55), rgba(110,190,155,0.8) 45%, rgba(46,140,102,0.55))" }} />
            <div style={{ position: "absolute", left: 0, right: 0, top: 21, height: 3,
              background: "linear-gradient(90deg, rgba(46,140,102,0.45), rgba(110,190,155,0.65) 45%, rgba(46,140,102,0.45))" }} />
            {/* vertical specular highlight down the left face */}
            <div style={{ position: "absolute", left: 3, top: 9, bottom: 8, width: 2.5, borderRadius: 2,
              background: "linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1))", filter: "blur(0.4px)" }} />
            {/* shadow gathering on the shaft's bottom end inside the hole */}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 14, borderRadius: "0 0 9px 9px / 0 0 5px 5px",
              background: "linear-gradient(180deg, transparent 0%, rgba(0,2,4,0.16) 40%, rgba(0,2,4,0.38) 75%, rgba(0,2,4,0.58) 100%)" }} />
            {/* ambient-occlusion ring where the post crosses the road surface */}
            <div style={{ position: "absolute", left: -1, right: -1, bottom: 13, height: 5, borderRadius: "50%",
              background: "radial-gradient(ellipse, rgba(0,0,0,0.3), transparent 70%)", filter: "blur(1px)" }} />
            {/* elliptical top cap */}
            <div style={{ position: "absolute", left: 0, top: 0, width: 18, height: 10, borderRadius: "50%",
              background: "radial-gradient(ellipse at 38% 26%, #D7E2EC, #8E9DAC 58%, #4E5B68 100%)",
              boxShadow: "inset 0 -1.5px 2px rgba(0,0,0,0.35), 0 1px 1.5px rgba(0,0,0,0.4)" }} />
          </div>
        </div>
      ))}
      {/* dust puff where each bollard breaks the surface */}
      {[28.5, 75, 121.5].map((bx, i) => (
        <div key={"du" + i} style={{ position: "absolute", left: bx, top: "calc(50% - 106px)", width: 28, height: 12, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(175,185,195,0.6), transparent 72%)", filter: "blur(2px)",
          transform: "translate(-50%,0) scale(0.3)", opacity: 0, animation: "chk-bollard-dust 0.45s ease-out " + (rise + 0.05 + i * 0.05) + "s both" }} />
      ))}
      {/* impact flash + sparks at the bollard line */}
      <div style={{ position: "absolute", left: LANE_W / 2, top: "calc(50% - 131px)" }}>
        <div style={{ position: "absolute", width: 48, height: 48, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,240,200,0.9), rgba(255,180,90,0.4) 55%, transparent 75%)",
          transform: "translate(-50%,-50%) scale(0.3)", opacity: 0, animation: "chk-impact-flash 0.38s ease-out " + imp + "s forwards" }} />
        {sparks.map((s, i) => (
          <div key={i} style={{ position: "absolute", width: s.sz, height: s.sz, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,235,180,1), rgba(255,150,60,0.8) 60%, transparent)",
            "--ex": s.ex + "px", "--ey": s.ey + "px",
            transform: "translate(-50%,-50%)", opacity: 0, animation: "chk-spark 0.45s ease-out " + (imp + s.dl / 1000) + "s forwards" }} />
        ))}
      </div>
    </div>
  );
}

// ── continuous background traffic so lanes are never empty ──────────────────
function Traffic({ N, H, avoidRef, saveLaneRef, curLane, rushLane, viewRef, active, onCharge }) {
  const [cars, setCars] = React.useState([]);
  const idRef = React.useRef(0);
  const laneRef = React.useRef({});   // lane -> { t, dur, id } of the current leader
  React.useEffect(() => {
    if (!active || !H) return;   // stop SPAWNING — but cars already on the road finish their drive
    let alive = true;
    const MIN_HEADWAY = 750;          // ms a follower must trail the leader in the same lane
    const spawn = () => {
      if (!alive) return;
      const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
      const leaderOf = (L) => { const info = laneRef.current[L]; return (info && (now - info.t) < info.dur + 200) ? info : null; };
      const blocked = (L) => { const ld = leaderOf(L); return ld && (now - ld.t) < MIN_HEADWAY; };
      const saveLane = saveLaneRef ? saveLaneRef.current : 0;
      const noGo = (L) => L === avoidRef.current || L === avoidRef.current + 1 || L === saveLane || blocked(L);
      let lane = 1 + Math.floor(Math.random() * N), tries = 0;
      while (N > 1 && noGo(lane) && tries++ < 30)
        lane = 1 + Math.floor(Math.random() * N);
      if (N > 1 && noGo(lane)) return; // no free lane this tick
      const id = ++idRef.current;
      const src = CARS[Math.floor(Math.random() * CARS.length)];
      let dur = 2000 + Math.random() * 1100;          // brisk city traffic (2.0–3.1s)
      const leader = leaderOf(lane);
      if (leader) dur = Math.max(dur, leader.dur);   // never faster than the car ahead
      laneRef.current[lane] = { t: now, dur, id };
      const x = SIDEWALK_W + (lane - 1) * LANE_W + LANE_W / 2;
      // pan the whoosh to the side the car drives past on (relative to the chicken)
      const cur = avoidRef.current || 1;
      const gap = Math.abs(lane - cur);
      // one sound per car — but ONLY if this lane is actually on-screen
      const view = (viewRef && viewRef.current) || {};
      const screenX = x * (view.z || 1) + (view.tx || 0);
      const onScreen = screenX > -LANE_W * 0.5 && screenX < (view.w || 99999) + LANE_W * 0.5;
      if (onScreen && snd.carPass) {
        const pan = Math.max(-0.9, Math.min(0.9, (lane - cur) * 0.34));
        const prox = Math.max(0.06, 1 - gap * 0.26);   // distant lanes barely audible
        snd.carPass(pan, prox, dur);
      }
      setCars((cs) => [...cs, { id, x, src, dur, lane }]);
      setTimeout(() => {
        // removal always runs (even after the round ends) so no car ever pops out of existence
        setCars((cs) => cs.filter((c) => c.id !== id));
        if (laneRef.current[lane] && laneRef.current[lane].id === id) delete laneRef.current[lane];
      }, dur + 200);
    };
    spawn();
    const iv = setInterval(spawn, 560);
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, N, H]);
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 3 }}>
      {cars.map((c) => {
        const dim = c.lane < curLane ? 0.5 : c.lane > curLane ? 0.4 : 0;
        return (
          <div key={c.id} style={{ position: "absolute", inset: 0 }}>
            <DriveCar x={c.x} src={c.src} dur={c.dur} H={H} dim={dim} rush={c.lane === rushLane}
              onBlocked={(y) => {
                const took = onCharge ? onCharge(c.lane, c.src, y, H) : false;
                if (took) {   // this car becomes the bollard-crash car — hand it off
                  setCars((cs) => cs.filter((q) => q.id !== c.id));
                  if (laneRef.current[c.lane] && laneRef.current[c.lane].id === c.id) delete laneRef.current[c.lane];
                }
                return took;
              }} />
          </div>
        );
      })}
    </div>
  );
}

// ── multiplier medallion (custom manhole cover) ─────────────────────────────
// A flat, top-down steel cover set into the asphalt: recessed seat, bolted rim,
// radial tread, engraved multiplier plate. Gassy lanes glow toxic green from
// the seating gap; the busted lane turns red.
function MedallionBase({ mult, state, onClick, idx, variant = 0, covered = false, busted = false, steamy = false }) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = "mh" + uid;
  const rim = busted ? ["#C4574C", "#6E241C"] : ["#5E6C7A", "#2B3641"];
  const face = busted ? ["#B04A40", "#7E2A22", "#551610"] : ["#4C5967", "#38444F", "#242F39"];
  const plate = busted ? ["#8F332A", "#57140D"] : ["#313C47", "#1D2730"];
  const wrapFilt = busted
    ? "drop-shadow(0 0 14px rgba(225,91,76,0.5)) drop-shadow(0 5px 7px rgba(0,0,0,0.5))"
    : steamy
      ? "drop-shadow(0 0 12px rgba(110,235,130,0.3)) drop-shadow(0 5px 7px rgba(0,0,0,0.5))"
      : "drop-shadow(0 5px 7px rgba(0,0,0,0.5))";
  const label = mult.toFixed(2) + "×";
  const fs = label.length <= 5 ? 13 : label.length === 6 ? 12 : label.length === 7 ? 10.5 : 8.5;
  const tp = { x: 52, textAnchor: "middle", dominantBaseline: "central", fontFamily: "'Unbounded', var(--font-numeric)", fontWeight: 800, fontSize: fs, letterSpacing: "-0.6" };
  return (
    <div onClick={state === "next" ? () => onClick(idx) : undefined}
      style={{ position: "relative", width: 94, height: 94, cursor: state === "next" ? "pointer" : "default", filter: wrapFilt, transition: "filter 0.3s" }}>
      {/* pulsing mint target ring under the next lane's cover */}
      {state === "next" && (
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 108, height: 108, borderRadius: "50%",
          border: "2.5px solid var(--mint-bright)", boxShadow: "0 0 18px rgba(84,214,166,0.4), inset 0 0 16px rgba(84,214,166,0.22)",
          transform: "translate(-50%,-50%)", animation: "chk-ring 1.3s ease-in-out infinite", pointerEvents: "none" }} />
      )}
      {/* toxic vapour seeping out — only on gassy lanes */}
      {steamy && !busted && (
        <div style={{ position: "absolute", left: "50%", top: "22%", width: 0, height: 0, pointerEvents: "none", zIndex: 4, opacity: covered ? 0 : 1, transition: "opacity 0.25s" }}>
          {[0, 1, 2, 3, 4, 5].map((k) => (
            <div key={k} style={{ position: "absolute", left: [-14, -4, 6, 14, -9, 2][k], top: [2, -2, 0, 2, -3, 3][k], width: [13, 10, 14, 10, 9, 12][k], height: [13, 10, 14, 10, 9, 12][k], borderRadius: "50%",
              background: "radial-gradient(circle at 50% 50%, rgba(200,255,135,0.9), rgba(90,245,110,0.5) 52%, transparent 73%)",
              filter: "blur(2px)", transform: "translate(-50%,0) scale(0.4)", opacity: 0,
              animation: "chk-steam " + (2.0 + (k % 3) * 0.35) + "s ease-out " + (k * 0.36) + "s infinite" }} />
          ))}
        </div>
      )}
      <svg width="94" height="94" viewBox="0 0 104 104" style={{ display: "block" }}>
        <defs>
          <linearGradient id={id + "r"} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={rim[0]} /><stop offset="100%" stopColor={rim[1]} />
          </linearGradient>
          <radialGradient id={id + "f"} cx="40%" cy="34%" r="76%">
            <stop offset="0%" stopColor={face[0]} /><stop offset="55%" stopColor={face[1]} /><stop offset="100%" stopColor={face[2]} />
          </radialGradient>
          <radialGradient id={id + "p"} cx="45%" cy="36%" r="74%">
            <stop offset="0%" stopColor={plate[0]} /><stop offset="100%" stopColor={plate[1]} />
          </radialGradient>
        </defs>
        {/* recessed asphalt seat */}
        <circle cx="52" cy="53.5" r="49" fill="rgba(0,0,0,0.4)" />
        {/* seating gap — a sliver of dark (or toxic glow) around the cover */}
        <circle cx="52" cy="52" r="47.5" fill={steamy && !busted ? "rgba(104,228,124,0.55)" : "rgba(5,9,13,0.92)"} style={{ transition: "fill 0.3s" }} />
        {/* bolted rim */}
        <circle cx="52" cy="52" r="45" fill={"url(#" + id + "r)"} />
        {Array.from({ length: 8 }).map((_, k) => {
          const a = (k / 8) * Math.PI * 2 + Math.PI / 8 + variant * 0.26;
          const bx = 52 + Math.cos(a) * 41.5, by = 52 + Math.sin(a) * 41.5;
          return (
            <g key={k}>
              <circle cx={bx} cy={by + 0.7} r="2.3" fill="rgba(0,0,0,0.55)" />
              <circle cx={bx} cy={by} r="2.1" fill={busted ? "#D98078" : "#7C8B99"} />
              <circle cx={bx - 0.5} cy={by - 0.6} r="0.8" fill="rgba(230,240,248,0.5)" />
            </g>
          );
        })}
        {/* cover face */}
        <circle cx="52" cy="52" r="38.5" fill={"url(#" + id + "f)"} stroke="rgba(0,0,0,0.5)" strokeWidth="1.2" />
        {/* radial tread bars, each with a thin catch-light */}
        {Array.from({ length: 22 }).map((_, k) => {
          const a = (k / 22) * Math.PI * 2 + variant * 0.14;
          return (
            <g key={k}>
              <line x1={52 + Math.cos(a) * 28} y1={52 + Math.sin(a) * 28} x2={52 + Math.cos(a) * 35.5} y2={52 + Math.sin(a) * 35.5} stroke="rgba(0,0,0,0.4)" strokeWidth="3.4" strokeLinecap="round" />
              <line x1={52 + Math.cos(a) * 28.6} y1={52 + Math.sin(a) * 28.6 - 0.7} x2={52 + Math.cos(a) * 34.9} y2={52 + Math.sin(a) * 34.9 - 0.7} stroke={busted ? "rgba(255,170,160,0.16)" : "rgba(190,210,225,0.13)"} strokeWidth="1.1" strokeLinecap="round" />
            </g>
          );
        })}
        {/* lift slots */}
        <rect x="48.4" y="23.8" width="7.2" height="3.4" rx="1.7" fill="rgba(0,0,0,0.6)" />
        <rect x="48.4" y="76.8" width="7.2" height="3.4" rx="1.7" fill="rgba(0,0,0,0.6)" />
        {/* engraved centre plate */}
        <circle cx="52" cy="53.2" r="21.5" fill="rgba(0,0,0,0.38)" />
        <circle cx="52" cy="52" r="21.5" fill={"url(#" + id + "p)"} stroke="rgba(0,0,0,0.45)" strokeWidth="1.1" />
        <circle cx="52" cy="50.9" r="21.5" fill="none" stroke={busted ? "rgba(255,160,150,0.28)" : "rgba(170,190,205,0.2)"} strokeWidth="0.8" />
        {/* multiplier cast into the plate — light metal on the dark recess */}
        {state !== "passed" && (
          <g>
            <text {...tp} y={53.6} fill="rgba(0,0,0,0.5)" stroke="rgba(0,0,0,0.5)" strokeWidth="2.6" paintOrder="stroke">{label}</text>
            <text {...tp} y={52} fill={busted ? "#FFD9D4" : "#C6D3DD"} stroke={busted ? "rgba(74,13,7,0.9)" : "rgba(10,16,22,0.9)"} strokeWidth="2.4" paintOrder="stroke">{label}</text>
          </g>
        )}
        {/* soft top sheen */}
        <ellipse cx="43" cy="36" rx="23" ry="10" fill="rgba(205,225,240,0.055)" />
      </svg>
    </div>
  );
}
const Medallion = React.memo(MedallionBase);

// ── traffic signal (synced with the round) ──────────────────────────────────
// While a round is live the walk lamp burns mint and cars get red — the traffic
// ignores it, of course; that's the game. Idle or busted flips it back.
function SemaforBase({ walk }) {
  const lamp = (on, color, glow, sq) => ({ width: 12, height: 12, borderRadius: sq ? 3 : "50%", flex: "0 0 auto",
    background: on ? color : "#161F2A", border: "1px solid rgba(0,0,0,0.55)",
    boxShadow: on ? "0 0 10px " + glow + ", inset 0 -2px 3px rgba(0,0,0,0.3)" : "inset 0 2px 4px rgba(0,0,0,0.6)",
    transition: "background 0.3s, box-shadow 0.3s" });
  const box = { background: "linear-gradient(180deg,#16202B,#0E151E)", border: "1px solid #324356", boxShadow: "0 4px 10px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", alignItems: "center" };
  return (
    <div style={{ position: "absolute", left: 178, bottom: "calc(50% + 70px)", width: 44, height: 148, zIndex: 2, filter: "drop-shadow(3px 5px 5px rgba(0,0,0,0.35))" }}>
      {/* pole + foot */}
      <div style={{ position: "absolute", bottom: 0, left: 16, width: 7, height: 100, borderRadius: 2, background: "linear-gradient(90deg,#3E4C5B,#1E2934 55%,#2C3945)" }} />
      <div style={{ position: "absolute", bottom: 0, left: 10, width: 19, height: 6, borderRadius: "3px 3px 0 0", background: "#1E2934" }} />
      {/* car head — red for traffic while the chicken has right of way */}
      <div style={{ ...box, position: "absolute", top: 0, left: 7, width: 25, padding: "4px 0", gap: 3, borderRadius: 6 }}>
        <div style={lamp(walk, "#E15B4C", "rgba(225,91,76,0.85)")} />
        <div style={lamp(false, "#E8C56A", "rgba(232,197,106,0.85)")} />
        <div style={lamp(!walk, "#54D6A6", "rgba(84,214,166,0.85)")} />
      </div>
      {/* pedestrian box — stop / walk */}
      <div style={{ ...box, position: "absolute", top: 58, left: 4, width: 31, padding: "4px 0", gap: 3, borderRadius: 5 }}>
        <div style={lamp(!walk, "#E15B4C", "rgba(225,91,76,0.85)", true)} />
        <div style={lamp(walk, "#54D6A6", "rgba(84,214,166,0.85)", true)} />
      </div>
    </div>
  );
}
const Semafor = React.memo(SemaforBase);

// ── stopped metro train ─────────────────────────────────────────────────────
// A big mint-livery metro stopped along the kerb — wide enough that its far
// side hangs off-screen left, so the chicken reads small next to it.
function TrainBase() {
  const win = (pos, k) => {
    const dark = k % 4 === 2;                       // a few unlit compartments
    return (
      <div key={k} style={{ position: "absolute", right: 3, width: 16, height: 38, ...pos, borderRadius: 5,
        background: "#0E1F16", boxShadow: "0 0 0 1.5px rgba(122,150,138,0.35), 0 1px 3px rgba(0,0,0,0.5)" + (dark ? "" : ", 0 0 10px rgba(242,205,130,0.22)") }}>
        <div style={{ position: "absolute", inset: 2.5, borderRadius: 3, overflow: "hidden",
          background: dark
            ? "linear-gradient(160deg, rgba(120,180,220,0.16) 0%, rgba(8,18,13,0.95) 58%)"
            : "linear-gradient(90deg, rgba(206,168,98,0.6), rgba(244,214,150,0.9) 52%, rgba(184,144,80,0.55))" }}>
          <div style={{ position: "absolute", top: -8, left: -5, width: 6, height: 56, background: "rgba(225,242,250,0.20)", transform: "rotate(16deg)" }} />
          <div style={{ position: "absolute", top: -8, left: 4, width: 2.5, height: 56, background: "rgba(225,242,250,0.12)", transform: "rotate(16deg)" }} />
        </div>
        <div style={{ position: "absolute", top: 8, left: 2, right: 2, height: 1.8, background: "#0E1F16" }} />
        <div style={{ position: "absolute", top: "50%", left: 2, right: 2, height: 2.2, marginTop: -1.1, background: "#0E1F16" }} />
      </div>
    );
  };
  const carriage = (key, pos, radius, winPos) => (
    <div key={key} style={{ position: "absolute", left: 6, width: 148, ...pos, borderRadius: radius, overflow: "hidden",
      background: "linear-gradient(90deg, #1D5340 0%, #2E8C68 38%, #2A7C5C 62%, #16412F 100%)",
      boxShadow: "0 0 0 2px rgba(6,14,10,0.6), 10px 0 16px rgba(0,0,0,0.45)" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0 3px, transparent 3px 104px)" }} />
      <div style={{ position: "absolute", top: 8, bottom: 8, left: "42%", width: 4, background: "rgba(255,255,255,0.12)" }} />
      <div style={{ position: "absolute", top: 8, bottom: 8, left: "20%", width: 2, background: "rgba(0,0,0,0.18)" }} />
      <div style={{ position: "absolute", top: 8, bottom: 8, left: "64%", width: 2, background: "rgba(0,0,0,0.18)" }} />
      <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 22, background: "linear-gradient(90deg, #174534, #0D2A1E)" }} />
      <div style={{ position: "absolute", top: 0, bottom: 0, right: 20.5, width: 1.5, background: "rgba(180,210,195,0.22)" }} />
      {(winPos || []).map((p, k) => win(p, k))}
    </div>
  );
  const vent = (top) => (
    <div style={{ position: "absolute", left: 30, top: top, width: 42, height: 60, borderRadius: 8, background: "linear-gradient(90deg,#14382A,#1C4A37)", boxShadow: "inset 0 0 0 3px rgba(0,0,0,0.35)" }}>
      <div style={{ position: "absolute", inset: 8, backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.4) 0 4px, transparent 4px 12px)" }} />
    </div>
  );
  return (
    <div style={{ position: "absolute", top: 0, bottom: 0, left: -44, width: 160 }}>
      {/* ballast bed */}
      <div style={{ position: "absolute", inset: 0, background: "#20282F" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 30% 24%, rgba(255,255,255,0.05) 0 1.3px, transparent 2px), radial-gradient(circle at 70% 60%, rgba(0,0,0,0.35) 0 1.5px, transparent 2.2px)", backgroundSize: "9px 12px, 11px 14px" }} />
      {/* sleepers */}
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 8, width: 148, backgroundImage: "repeating-linear-gradient(0deg, rgba(58,48,36,0.9) 0 18px, transparent 18px 62px)" }} />
      {/* rails */}
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 28, width: 7, background: "linear-gradient(90deg,#39434D,#7E8C99,#2E3841)" }} />
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 118, width: 7, background: "linear-gradient(90deg,#39434D,#7E8C99,#2E3841)" }} />
      {/* carriages: one stopped at the crossing, neighbours coupled beyond */}
      {carriage("top", { top: 0, height: "calc(50% - 292px)" }, "0 0 26px 26px",
        [{ bottom: 34 }, { bottom: 90 }, { bottom: 146 }, { bottom: 202 }, { bottom: 258 }])}
      {carriage("main", { top: "calc(50% - 260px)", height: 520 }, 30,
        [-206, -150, 150, 206].map((o) => ({ top: 260 + o - 19 })))}
      {carriage("bot", { top: "calc(50% + 292px)", bottom: 0 }, "26px 26px 0 0",
        [{ top: 34 }, { top: 90 }, { top: 146 }, { top: 202 }, { top: 258 }])}
      {/* couplers in the gaps */}
      <div style={{ position: "absolute", left: 62, top: "calc(50% - 286px)", width: 32, height: 20, borderRadius: 4, background: "#39434D", boxShadow: "0 0 6px rgba(0,0,0,0.6)" }} />
      <div style={{ position: "absolute", left: 62, top: "calc(50% + 266px)", width: 32, height: 20, borderRadius: 4, background: "#39434D", boxShadow: "0 0 6px rgba(0,0,0,0.6)" }} />
      {/* roof vents on the stopped carriage */}
      {vent("calc(50% - 208px)")}
      {vent("calc(50% + 148px)")}
      {/* ── double doors slid open at the crossing ── */}
      <div style={{ position: "absolute", left: 128, top: "calc(50% - 128px)", width: 2, height: 256, background: "rgba(0,0,0,0.35)" }} />
      <div style={{ position: "absolute", left: 121, top: "calc(50% - 68px)", width: 34, height: 136, borderRadius: 7, background: "#0D231A", boxShadow: "0 0 0 2px rgba(140,168,155,0.28), inset 0 0 0 2px rgba(0,0,0,0.5)" }} />
      <div style={{ position: "absolute", left: 125, top: "calc(50% - 62px)", width: 26, height: 124, borderRadius: 4, overflow: "hidden", background: "linear-gradient(90deg, rgba(16,28,21,0.95) 0%, rgba(242,205,130,0.55) 60%, rgba(255,226,168,0.75) 100%)" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 14, background: "linear-gradient(180deg, rgba(0,0,0,0.5), transparent)" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 14, background: "linear-gradient(0deg, rgba(0,0,0,0.5), transparent)" }} />
        <div style={{ position: "absolute", left: 9, top: 10, bottom: 10, width: 2.5, borderRadius: 2, background: "rgba(20,34,26,0.75)", boxShadow: "1px 0 0 rgba(255,240,200,0.35)" }} />
      </div>
      {/* ribbed threshold plate at the doorway edge */}
      <div style={{ position: "absolute", left: 150, top: "calc(50% - 62px)", width: 5, height: 124, background: "repeating-linear-gradient(0deg, #8A98A6 0 3px, #5A6875 3px 7px)", boxShadow: "0 0 3px rgba(0,0,0,0.5)" }} />
      {/* door-open indicator lamp */}
      <div style={{ position: "absolute", left: 113, top: "calc(50% - 77px)", width: 7, height: 7, borderRadius: "50%", background: "#54D6A6", boxShadow: "0 0 8px rgba(84,214,166,0.8)" }} />
      {/* the two leaves, slid apart (one parked up, one down) */}
      {[{ top: "calc(50% - 114px)", seal: "bottom" }, { top: "calc(50% + 66px)", seal: "top" }].map((L, i) => (
        <div key={i} style={{ position: "absolute", left: 124, top: L.top, width: 30, height: 48, borderRadius: 5, background: "linear-gradient(90deg, #2E8C68 0%, #27745A 55%, #1B4E3A 100%)", boxShadow: "0 0 0 2px rgba(6,14,10,0.55), 3px 2px 5px rgba(0,0,0,0.4)" }}>
          <div style={{ position: "absolute", left: 6, top: 7, width: 18, height: 22, borderRadius: 4, background: "#0E1F16", boxShadow: "0 0 0 1.5px rgba(122,150,138,0.35)" }}>
            <div style={{ position: "absolute", inset: 2, borderRadius: 2.5, overflow: "hidden", background: "linear-gradient(90deg, rgba(206,168,98,0.55), rgba(244,214,150,0.85))" }}>
              <div style={{ position: "absolute", top: -6, left: -3, width: 4, height: 36, background: "rgba(225,242,250,0.2)", transform: "rotate(18deg)" }} />
            </div>
          </div>
          <div style={{ position: "absolute", left: 5, bottom: 6, width: 20, height: 1.6, background: "rgba(0,0,0,0.3)" }} />
          <div style={{ position: "absolute", left: 5, bottom: 10, width: 20, height: 1.6, background: "rgba(0,0,0,0.3)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, [L.seal]: 0, height: 3, background: "#0B1712", borderRadius: 2 }} />
          <div style={{ position: "absolute", left: 0, right: 0, [L.seal]: 3, height: 2.5, background: "rgba(232,197,106,0.75)" }} />
        </div>
      ))}
      {/* boarding step down onto the pavement */}
      <div style={{ position: "absolute", left: 152, top: "calc(50% - 56px)", width: 28, height: 112, borderRadius: 3,
        background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.2) 0 4px, transparent 4px 16px), linear-gradient(90deg,#4A5A6B,#303D4B)",
        boxShadow: "0 3px 6px rgba(0,0,0,0.45)" }} />
    </div>
  );
}
const Train = React.memo(TrainBase);

// ── sidewalk decor ──────────────────────────────────────────────────────────
function BushBase({ x, y, s = 1, dark }) {
  const pal = dark
    ? { hi: "#2F7E56", mid: "#1F5238", lo: "#123122", glint: "rgba(120,220,160,0.26)", tip: "rgba(140,235,175,0.32)" }
    : { hi: "#3FA070", mid: "#2A6E4B", lo: "#17402C", glint: "rgba(150,240,185,0.28)", tip: "rgba(170,255,200,0.38)" };
  const lobes = [
    { l: 0, b: 5, w: 34, h: 28, r: "58% 42% 52% 48% / 62% 58% 42% 38%", d: 0.85 },
    { l: 42, b: 7, w: 36, h: 30, r: "46% 54% 48% 52% / 58% 62% 38% 42%", d: 0.88 },
    { l: 16, b: 9, w: 46, h: 40, r: "52% 48% 55% 45% / 60% 55% 45% 40%", d: 1 },
    { l: 5, b: 0, w: 34, h: 25, r: "50% 50% 46% 54% / 55% 60% 42% 45%", d: 1.02 },
    { l: 36, b: 0, w: 33, h: 23, r: "54% 46% 50% 50% / 62% 55% 40% 45%", d: 1.06 },
  ];
  return (
    <div style={{ position: "absolute", left: x, bottom: y, width: 80 * s, height: 50 * s, filter: "drop-shadow(3px 4px 4px rgba(0,0,0,0.35))" }}>
      <div style={{ position: "absolute", left: "50%", bottom: -4 * s, transform: "translateX(-50%)", width: "94%", height: 12 * s, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(0,0,0,0.45), transparent 75%)" }} />
      {lobes.map((o, i) => (
        <div key={i} style={{ position: "absolute", left: o.l * s, bottom: o.b * s, width: o.w * s, height: o.h * s, borderRadius: o.r,
          background: "radial-gradient(circle at 32% 24%, " + pal.hi + ", " + pal.mid + " 48%, " + pal.lo + " 92%)",
          filter: "brightness(" + o.d + ")",
          boxShadow: "inset -4px -6px 8px rgba(0,0,0,0.3), inset 3px 4px 6px rgba(255,255,255,0.07)" }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: "inherit", overflow: "hidden",
            backgroundImage: "radial-gradient(circle at 30% 25%, " + pal.glint + " 0 1.5px, transparent 2.5px), radial-gradient(circle at 62% 48%, rgba(0,0,0,0.3) 0 1.5px, transparent 2.5px), radial-gradient(circle at 45% 72%, " + pal.glint + " 0 1px, transparent 2px)",
            backgroundSize: "11px 13px, 13px 15px, 9px 11px", opacity: 0.85 }} />
        </div>
      ))}
      <div style={{ position: "absolute", left: "26%", top: "16%", width: 7 * s, height: 5 * s, borderRadius: "60% 40% 55% 45%", background: pal.tip }} />
      <div style={{ position: "absolute", left: "56%", top: "26%", width: 6 * s, height: 4 * s, borderRadius: "50% 50% 60% 40%", background: pal.tip, opacity: 0.8 }} />
    </div>
  );
}
const Bush = React.memo(BushBase);

function TreeBase({ x, y, s = 1, z = 2 }) {
  const w = 132 * s, h = 148 * s;
  return (
    <div style={{ position: "absolute", left: x, bottom: y, width: w, height: h, zIndex: z }}>
      <div style={{ position: "absolute", left: "50%", bottom: -8 * s, transform: "translateX(-50%)", width: w * 0.82, height: 20 * s, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(0,0,0,0.5), rgba(0,0,0,0.18) 60%, transparent)", filter: "blur(2px)" }} />
      <img src={`${A}/tree.webp`} alt="" draggable="false" style={{ position: "relative", width: "100%", height: "100%", objectFit: "contain", objectPosition: "bottom center", filter: "drop-shadow(6px 10px 7px rgba(0,0,0,0.34))" }} />
    </div>
  );
}
const Tree = React.memo(TreeBase);

function HydrantBase({ x, y }) {
  return (
    <div style={{ position: "absolute", left: x, bottom: y, width: 32, height: 48, filter: "drop-shadow(2px 3px 3px rgba(0,0,0,0.4))" }}>
      <div style={{ position: "absolute", left: "50%", bottom: -3, transform: "translateX(-50%)", width: 30, height: 8, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(0,0,0,0.5), transparent 75%)" }} />
      <div style={{ position: "absolute", left: 4, bottom: 0, width: 24, height: 6, borderRadius: "3px 3px 2px 2px", background: "linear-gradient(180deg,#A93327,#7C221A)" }} />
      <div style={{ position: "absolute", left: 8, bottom: 5, width: 16, height: 27, borderRadius: "8px 8px 3px 3px", background: "linear-gradient(90deg, #F07A6A 0%, #DE5A4C 34%, #B23A2E 74%, #93291F 100%)" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 8, height: 2.5, background: "rgba(0,0,0,0.22)" }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: 17, height: 2.5, background: "rgba(0,0,0,0.22)" }} />
        <div style={{ position: "absolute", left: 2.5, top: 3, width: 2.5, height: 20, borderRadius: 2, background: "rgba(255,235,230,0.32)" }} />
        <div style={{ position: "absolute", left: "50%", top: 10.5, transform: "translateX(-50%)", width: 9, height: 9, borderRadius: "50%", background: "radial-gradient(circle at 38% 32%, #E9705F, #A03226 70%)", border: "1.5px solid rgba(0,0,0,0.35)" }}>
          <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 3.5, height: 3.5, borderRadius: "50%", background: "#6E1D14" }} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 1, bottom: 20, width: 8, height: 8, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #E9705F, #98291D 75%)", border: "1px solid rgba(0,0,0,0.4)" }} />
      <div style={{ position: "absolute", right: 1, bottom: 20, width: 8, height: 8, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #E9705F, #98291D 75%)", border: "1px solid rgba(0,0,0,0.4)" }} />
      <div style={{ position: "absolute", left: 5, bottom: 31, width: 22, height: 6, borderRadius: 3, background: "linear-gradient(180deg,#E5604F,#A22F23)", boxShadow: "inset 0 -2px 2px rgba(0,0,0,0.25)" }} />
      <div style={{ position: "absolute", left: 9, bottom: 36, width: 14, height: 9, borderRadius: "50% 50% 3px 3px", background: "radial-gradient(circle at 38% 26%, #EF7B69, #B23A2E 78%)" }} />
      <div style={{ position: "absolute", left: 13.5, bottom: 44, width: 5, height: 4, borderRadius: 1.5, background: "linear-gradient(180deg,#C7473A,#8E2820)" }} />
    </div>
  );
}
const Hydrant = React.memo(HydrantBase);

// ── cash-out celebration popup (same as Roulette's) ─────────────────────────
export function ChickenCashWin({ payout, profit }) {
  const accent = "#37dd84";
  return (
    <div style={{ position: "absolute", left: "50%", top: "44%", transform: "translate(-50%,-50%)", zIndex: 45, pointerEvents: "none", animation: "rl-pop 360ms cubic-bezier(0.34,1.45,0.5,1)" }}>
      <div style={{ background: accent, borderRadius: 18, padding: 6, boxShadow: "0 20px 55px rgba(0,0,0,0.55)", minWidth: 236 }}>
        <div style={{ padding: "16px 30px 13px", textAlign: "center", fontFamily: "'Unbounded', var(--font-numeric)", fontWeight: 800, fontSize: 34, color: "#062018", letterSpacing: "-0.02em" }}>x{(payout || 0).toFixed(2)}</div>
        <div style={{ background: "#0e1014", border: `2px solid ${accent}`, borderRadius: 13, padding: "11px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#2A6FDB"></circle><path d="M12 6.2v11.6M9.4 9.1c0-1.3 1.2-2 2.6-2s2.6.6 2.6 1.9c0 2.8-5.2 1.3-5.2 4.1 0 1.3 1.2 2 2.6 2s2.6-.7 2.6-2" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round"></path></svg>
          <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 16, color: "#fff" }}>${profit}</span>
        </div>
      </div>
    </div>
  );
}

// ── the road stage ──────────────────────────────────────────────────────────
export function ChickenStage({ mults, lane, playing, dead, hit, cashed, hitLane, carSrc, deathType, hopKey, startKey, win, rushLane, steamLanes, save, onStep, onCharge, mobileUI = false }) {
  const ref = React.useRef(null);
  const entRef = React.useRef(null);
  const [w, setW] = React.useState(960);
  const [h, setH] = React.useState(600);
  React.useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const apply = () => {
      const cw = el.clientWidth, ch = el.clientHeight;
      setW((p) => (p === cw ? p : cw));
      setH((p) => (p === ch ? p : ch));
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el); apply();
    return () => ro.disconnect();
  }, []);
  React.useEffect(() => { preloadChickenArt(); }, []);
  const avoidRef = React.useRef(lane);
  avoidRef.current = lane;
  const saveLaneRef = React.useRef(0);
  saveLaneRef.current = save ? save.lane : 0;   // blocked lane: crashed car + raised bollards
  const N = mults.length;
  const contentW = SIDEWALK_W + N * LANE_W + GOAL_W;
  const chickenX = lane === 0 ? SIDEWALK_W - 50 : lane > N ? SIDEWALK_W + N * LANE_W + 74 : SIDEWALK_W + (lane - 1) * LANE_W + LANE_W / 2;
  // organic landing: every hop settles a touch off-centre (a live bird, not a machine)
  const jitter = React.useMemo(() => {
    if (lane < 1 || lane > N) return { x: 0, y: 0 };
    return { x: (Math.random() - 0.5) * 16, y: (Math.random() - 0.5) * 14 };
  }, [hopKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  // stable click handler so memoized medallions don't re-render on every hop
  const onStepRef = React.useRef(onStep); onStepRef.current = onStep;
  const stepClick = React.useCallback((i) => onStepRef.current(i), []);
  const anchor = w * 0.28;
  // zoom the road in on desktop; the PHONE layout always stays 1:1 so enough
  // lanes are visible on small screens
  const Z = mobileUI ? 1 : 1.25;
  const rawTx = Math.max(w - contentW * Z, Math.min(0, anchor - chickenX * Z));
  // Mobile: while a bollard save is playing in the chicken's lane, HOLD the camera
  // still — the crash reads rock-solid instead of sliding sideways mid-impact.
  const prevTxRef = React.useRef(rawTx);
  const heldTxRef = React.useRef(null);
  let tx = rawTx;
  if (mobileUI && save && save.lane === lane) {
    if (heldTxRef.current == null) heldTxRef.current = prevTxRef.current;
    tx = heldTxRef.current;
  } else {
    heldTxRef.current = null;
  }
  prevTxRef.current = tx;
  const viewRef = React.useRef({});
  viewRef.current = { tx, w, z: Z };
  const canStep = playing && !dead && !cashed && lane < N;
  const stepLane = lane + 1;
  const walkOn = playing && !dead && !cashed;

  // a fresh chicken hops out of the open train door when the last one is gone
  React.useEffect(() => {
    if (!startKey) return;
    const el = entRef.current; if (!el || !el.animate) return;
    el.animate(
      [
        { transform: "translateX(-80px) translateY(-4px)", opacity: 0 },
        { transform: "translateX(-70px) translateY(-10px)", opacity: 1, offset: 0.14 },
        { transform: "translateX(-40px) translateY(-36px)", opacity: 1, offset: 0.5 },
        { transform: "translateX(0) translateY(0)", opacity: 1 },
      ],
      { duration: 470, easing: "cubic-bezier(0.34,1.3,0.5,1)" }
    );
  }, [startKey]);

  return (
    <div ref={ref} className={"chk-stage" + (hit ? " chk-shake-on" : "")} style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden",
      background: "linear-gradient(180deg, #1A2634 0%, #121B26 100%)" }}>
      <style>{KEYFRAMES}</style>
      {/* scrolling road content */}
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: contentW, transform: `translateX(${tx}px) scale(${Z})`, transformOrigin: "0 50%", willChange: "transform", transition: lane === 0 ? "none" : (mobileUI ? "transform 1.15s cubic-bezier(0.3,0.6,0.25,1) 0.12s" : "transform 0.75s cubic-bezier(0.3,0.6,0.25,1)") }}>
        {/* ── left sidewalk: train, paving, street furniture ── */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: SIDEWALK_W, background: "linear-gradient(90deg, #2C3A48, #303F4E)" }}>
          <Train />
          {/* platform warning line along the train edge */}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 119, width: 5, background: "rgba(232,197,106,0.14)", boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.2)" }} />
          {/* paving slabs */}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 116, right: 7, backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.30) 0 1.5px, transparent 1.5px 46px), repeating-linear-gradient(90deg, rgba(0,0,0,0.20) 0 1.5px, transparent 1.5px 62px)" }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 116, right: 7, backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 46px)", backgroundPosition: "0 1.5px" }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 116, right: 7, backgroundImage: "radial-gradient(circle at 25% 35%, rgba(0,0,0,0.10) 0 1px, transparent 1.5px), radial-gradient(circle at 75% 70%, rgba(255,255,255,0.02) 0 1px, transparent 1.5px)", backgroundSize: "13px 17px, 15px 19px" }} />
          {/* light cast from each lit carriage window */}
          {[-206, -150, 206].map((o) => (
            <div key={o} style={{ position: "absolute", left: 110, top: "calc(50% + " + (o - 22) + "px)", width: 54, height: 44,
              background: "linear-gradient(90deg, rgba(244,212,140,0.07), rgba(242,205,130,0.025) 55%, transparent 82%)",
              clipPath: "polygon(0 26%, 100% 4%, 100% 96%, 0 74%)", filter: "blur(3px)", pointerEvents: "none" }}>
              <div style={{ position: "absolute", left: 0, right: "22%", top: "47%", height: "7%", background: "rgba(24,30,26,0.10)", filter: "blur(2px)" }} />
            </div>
          ))}
          {/* street furniture — kept clear of the chicken's path */}
          <Semafor walk={walkOn} />
          <Hydrant x={188} y={-17} />
          {/* kerb edge */}
          <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 7, background: "linear-gradient(90deg,#4A5A6B,#26313D)", boxShadow: "2px 0 8px rgba(0,0,0,0.5)" }} />
        </div>
        {/* asphalt speckle across the whole carriageway */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: SIDEWALK_W, width: N * LANE_W,
          backgroundImage: "radial-gradient(circle at 22% 31%, rgba(0,0,0,0.30) 0 1.5px, transparent 2px), radial-gradient(circle at 71% 64%, rgba(0,0,0,0.24) 0 1.5px, transparent 2px), radial-gradient(circle at 47% 86%, rgba(255,255,255,0.028) 0 1px, transparent 1.5px)",
          backgroundSize: "13px 15px, 11px 13px, 17px 19px" }} />
        {/* pedestrian crossing painted across every lane — the chicken's path */}
        <div style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", height: 134, left: SIDEWALK_W, width: N * LANE_W, pointerEvents: "none" }}>
          <div style={{ position: "absolute", inset: 0,
            backgroundImage: "repeating-linear-gradient(90deg, rgba(208,222,234,0.24) 0 20px, transparent 20px 50px)",
            WebkitMaskImage: "linear-gradient(180deg, transparent 0, #000 9%, #000 91%, transparent 100%)",
            maskImage: "linear-gradient(180deg, transparent 0, #000 9%, #000 91%, transparent 100%)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: "30%", height: 20, background: "linear-gradient(180deg, transparent, rgba(10,15,22,0.5), transparent)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: "62%", height: 17, background: "linear-gradient(180deg, transparent, rgba(10,15,22,0.42), transparent)" }} />
        </div>
        {/* lanes */}
        {mults.map((m, i) => {
          const idx = i + 1;
          const x = SIDEWALK_W + i * LANE_W;
          const st = idx < lane ? "passed" : idx === lane ? "current" : (idx === stepLane && canStep) ? "next" : "future";
          const dim = st === "passed" ? 0.5 : st === "future" ? 0.4 : 0;
          return (
            <div key={idx} style={{ position: "absolute", top: 0, bottom: 0, left: x, width: LANE_W,
              background: idx % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent" }}>
              {/* tyre-polish streaks where wheels run */}
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent 0 22%, rgba(0,0,0,0.18) 30% 39%, transparent 47% 55%, rgba(0,0,0,0.18) 63% 72%, transparent 80%)", filter: "blur(5px)" }} />
              {/* lane lines: dashed dividers, solid edge lines beside both kerbs */}
              {i < N - 1 ? (
                <div style={{ position: "absolute", top: 0, bottom: 0, right: -2, width: 4, background: "repeating-linear-gradient(180deg, rgba(212,226,240,0.38) 0 30px, transparent 30px 72px)" }} />
              ) : (
                <div style={{ position: "absolute", top: 0, bottom: 0, right: 4, width: 4, background: "rgba(212,226,240,0.30)" }} />
              )}
              {i === 0 && <div style={{ position: "absolute", top: 0, bottom: 0, left: 4, width: 4, background: "rgba(212,226,240,0.30)" }} />}
              {/* bollard sockets sunk in the asphalt above the crossing — always visible */}
              {[28.5, 75, 121.5].map((bx) => (
                <div key={"sk" + bx} style={{ position: "absolute", left: bx, top: "calc(50% - 106px)", width: 26, height: 16, transform: "translate(-50%,-50%)", borderRadius: "50%",
                  background: "radial-gradient(ellipse at 50% 35%, #0A1118 0 48%, #131C25 72%, rgba(90,104,116,0.6) 100%)",
                  boxShadow: "0 1.5px 1.5px rgba(140,155,170,0.25), inset 0 -1.5px 2.5px rgba(0,0,0,0.7)", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: "50%", top: "50%", width: 18, height: 10, transform: "translate(-50%,-42%)", borderRadius: "50%",
                    background: "radial-gradient(ellipse at 38% 26%, #9AA9B6, #5E6C79 58%, #333E49 100%)",
                    boxShadow: "inset 0 1.5px 2.5px rgba(0,0,0,0.55), inset 0 -1px 1.5px rgba(0,0,0,0.35)" }} />
                </div>
              ))}
              {/* medallion centered */}
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>
                <Medallion mult={m} state={st} variant={i % 3} idx={idx} steamy={!!steamLanes[idx] && st !== "passed"} covered={hit && hitLane === idx} busted={hit && hitLane === idx} onClick={stepClick} />
              </div>
              {/* uniform lane shade for upcoming / passed lanes */}
              <div style={{ position: "absolute", inset: 0, background: "#04080D", opacity: dim, transition: "opacity 0.3s", pointerEvents: "none" }} />
            </div>
          );
        })}
        {/* destination kerb on the far side — where the run finishes */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: SIDEWALK_W + N * LANE_W, width: GOAL_W, background: "linear-gradient(90deg, #303F4E, #2C3A48)" }}>
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 7, background: "linear-gradient(90deg,#4A5A6B,#26313D)", boxShadow: "-2px 0 8px rgba(0,0,0,0.5)" }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 7, right: 34, backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.30) 0 1.5px, transparent 1.5px 46px), repeating-linear-gradient(90deg, rgba(0,0,0,0.20) 0 1.5px, transparent 1.5px 62px)" }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 34, background: "linear-gradient(90deg, #1E3B2D, #1A3226)", boxShadow: "inset 6px 0 8px -4px rgba(0,0,0,0.45)" }} />
          <Tree x={GOAL_W - 118} y={"calc(50% + 168px)"} s={0.85} />
          <Bush x={GOAL_W - 84} y={24} s={0.85} dark />
        </div>
        {/* continuous ambient traffic on the other lanes */}
        <Traffic N={N} H={h} avoidRef={avoidRef} saveLaneRef={saveLaneRef} curLane={lane} rushLane={rushLane} viewRef={viewRef} active={playing && !dead && !cashed} onCharge={onCharge} />
        {/* crash car — drives smoothly straight down the hit lane (car deaths only) */}
        {dead && hitLane > 0 && deathType !== "steam" && (
          <div key={"car" + hitLane} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 8 }}>
            <DriveCar x={SIDEWALK_W + (hitLane - 1) * LANE_W + LANE_W / 2} src={carSrc}
              startY={-(h * 0.62 + 180)} endY={h * 0.62 + 160}
              dur={CAR_FALL_MS} easing="linear" H={h} />
          </div>
        )}
        {/* gas explosion — green burst out of the manhole (steam deaths) */}
        {dead && hitLane > 0 && deathType === "steam" && (
          <div key={"boom" + hitLane} style={{ position: "absolute", top: "50%", left: SIDEWALK_W + (hitLane - 1) * LANE_W + LANE_W / 2, transform: "translate(-50%,-50%)", width: 0, height: 0, zIndex: 8 }}>
            <Boom />
          </div>
        )}
        {/* bollard near-miss: a car charges the lane, the bollards take the hit */}
        {save && (
          <div key={save.key} style={{ position: "absolute", top: 0, bottom: 0, left: SIDEWALK_W + (save.lane - 1) * LANE_W, width: LANE_W, pointerEvents: "none", zIndex: 7 }}>
            <BollardSave carSrc={save.carSrc} H={h} startY={save.startY} impactMs={save.impactMs} riseMs={save.riseMs} dim={save.lane < lane ? 0.5 : save.lane > lane ? 0.4 : 0} />
          </div>
        )}
        {/* chicken */}
        <div style={{ position: "absolute", top: "50%", left: chickenX + jitter.x, transform: `translate(-50%, calc(-50% - ${hit ? 4 : 26 + jitter.y}px))`, transition: lane === 0 ? "none" : hit ? "none" : "left 0.26s var(--ease-out), transform 0.26s var(--ease-out)", zIndex: 6 }}>
          <div ref={entRef}>
            <Chicken splat={hit} hopKey={hopKey} deathType={deathType} />
          </div>
        </div>
      </div>

      {/* cash-out popup — road dimmed behind */}
      {cashed && win && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none",
          background: "rgba(0,0,0,0.45)", animation: "rl-fade 240ms ease-out" }}>
          <ChickenCashWin payout={win.payout} profit={win.profit} />
        </div>
      )}
    </div>
  );
}

export { fmt as chickenFmt };
