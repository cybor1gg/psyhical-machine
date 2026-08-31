// STAR CLUSTER — PixiJS (WebGL) reel board. A pixel port of the DOM board in
// BonanzaSpace.jsx: the 6x5 symbol grid, the falls/tumbles, the win pulse and
// implode, the shards, the black holes with their badges, the devour spirals,
// the feed sparks and the comet merge ceremony. The state machine in
// BonanzaSpace remains the ONLY driver — it calls these imperative ops at the
// exact points where it flips the React state that CSS keyframes animate, and
// every duration/easing/delay here is transcribed from bonanza.css.
//
// Fallback contract: if this module throws at init (no WebGL) the caller keeps
// the DOM board, which is untouched and fully live. On permanent context loss
// onLost() drops this scene and un-hides the DOM board — whose React state the
// facade kept updating all along, so the board snaps to the current work array
// and the round continues logically intact.
//
// Performance contract (cabinet fleet, Firefox on Fedora 44): caller-driven
// rendering (no ticker), pooled sprites with .visible culling, zero per-frame
// allocations in render(), textures baked once (badges, glows, shards) or
// loaded through Assets (gem art, comet strip, black holes). No Graphics.
import { Sprite, Container, Texture, Rectangle, Assets } from "pixi.js";
import { createPixiApp, textureFromCanvas, bake } from "./pixiApp";

const COLS = 6, ROWS = 5, CELLS = COLS * ROWS;
const GEM = "/space/gems/";
const IDS = ["citrine", "amethyst", "rose", "jade", "sapphire", "emerald", "lunar", "ruby"];
const DEG = Math.PI / 180;

// ── cubic-bezier easing (CSS semantics; y may overshoot [0,1]) ─────────────
function cubicBezier(x1, y1, x2, y2) {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const fx = (t) => ((ax * t + bx) * t + cx) * t;
  const dfx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 5; i++) {
      const d = dfx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (fx(t) - p) / d;
    }
    t = Math.max(0, Math.min(1, t));
    return ((ay * t + by) * t + cy) * t;
  };
}
const LINEAR = (p) => p;
const EASE_INOUT = cubicBezier(0.42, 0, 0.58, 1);       // css ease-in-out
const EASE_OUT = cubicBezier(0, 0, 0.58, 1);            // css ease-out
const E_DROP_OPEN = cubicBezier(0.37, 0.12, 0.63, 0.88); // opening rain + orb ride
const E_DROP_TUM = cubicBezier(0.5, 0, 0.65, 1.12);      // tumble drop (whisper of bounce)
const E_EXIT = cubicBezier(0.55, 0, 0.85, 0.4);          // sweep out + orb out
const E_DEVOUR = cubicBezier(0.6, -0.1, 0.9, 0.5);       // spiral into the hole
const E_POP = cubicBezier(0.4, 0, 0.9, 0.4);             // bnPop implode
const E_FLY = cubicBezier(0.55, 0, 0.85, 0.5);           // bnFlyTrack merge streak
const E_CORE = cubicBezier(0.3, 0.7, 0.4, 1);            // bnCoreCharge
const E_PULL = cubicBezier(0.5, 0, 0.8, 0.4);            // bnPull feed spark

// piecewise keyframe lerp, CSS semantics: the easing applies per SEGMENT.
// pts is [p0,v0, p1,v1, ...] flat; returns the value at raw progress p.
function pw(p, pts, ease) {
  const n = pts.length;
  if (p <= pts[0]) return pts[1];
  for (let i = 0; i < n - 2; i += 2) {
    const p0 = pts[i], p1 = pts[i + 2];
    if (p <= p1) {
      const lt = ease((p - p0) / (p1 - p0));
      return pts[i + 1] + (pts[i + 3] - pts[i + 1]) * lt;
    }
  }
  return pts[n - 1];
}
// css clamp() helpers for the badge metrics (vh/vw units)
const clampVH = (min, vh, max) => Math.max(min, Math.min(max, (vh / 100) * window.innerHeight));
const clampVW = (min, vw, max) => Math.max(min, Math.min(max, (vw / 100) * window.innerWidth));

// keyframe tables, hoisted: tween apply() runs inside render(), which must
// not allocate — a literal per call would be per-frame garbage
const KF_WIN_ROT = [0, 0, 0.25, -14, 0.5, 11, 0.75, -7, 1, 0];          // bnWinPulse
const KF_WIN_SC = [0, 1, 0.25, 1.07, 0.5, 1.1, 0.75, 1.05, 1, 1];
const KF_FLASH = [0, 0, 0.25, 0.85, 1, 0.25];                           // bnFlash
const KF_HAIL_SC = [0, 1, 0.12, 1.32, 0.24, 1.1, 0.4, 1.34, 0.56, 1.12, 0.72, 1.28, 1, 1.18]; // bnCometHail
const KF_HAIL_ROT = [0, 0, 0.12, -5, 0.24, 3, 0.4, -3, 0.56, 2, 0.72, 0, 1, 0];
const KF_RING_A = [0, 0.95, 0.7, 0.35, 1, 0];                           // bnCometRing
const KF_POP_SC = [0, 1.1, 0.35, 1.55, 1, 0.1];                         // bnPop
const KF_POP_A = [0, 1, 0.35, 0.9, 1, 0];
const KF_PULL_A = [0, 0, 0.12, 1, 1, 0.9];                              // bnPull
const KF_FLY_SC = [0, 1, 0.7, 0.72, 1, 0.35];                           // bnFly
const KF_FLY_A = [0, 1, 0.84, 1, 1, 0];                                 // bnFlyTrack
const KF_CORE_A = [0, 0, 0.45, 0.9, 1, 1];                              // bnCoreCharge
const KF_BIG_SC = [0, 0.22, 0.26, 1.18, 0.46, 1.02, 0.66, 1.2, 0.84, 1.1, 1, 1.22]; // bnBigComet
const KF_BIG_A = [0, 0, 0.26, 1, 1, 1];

export async function createBnBoard({ wrap, gridEl, getFx, onLost }) {
  // shared engine util: fleet init policy (webgl-only, autoStart:false, dpr cap
  // + 2.2MP clamp), canvas mounted into wrap, 3s context-loss watchdog.
  const { app, fit: fitApp, destroy: destroyApp } = await createPixiApp({ wrap, onLost });
  // the canvas overlays the reel glass; the panel's overflow:hidden + rounded
  // corners clip it — the same reel mask the DOM board uses. z 2 puts it above
  // the felt fx (dividers/tint/sheen, z auto) and under the DOM plaques (z 9).
  app.canvas.style.position = "absolute";
  app.canvas.style.left = "0";
  app.canvas.style.top = "0";
  app.canvas.style.zIndex = "2";
  app.canvas.style.pointerEvents = "none";

  let destroyed = false;

  // ── textures ─────────────────────────────────────────────────────────────
  const urls = [...IDS.map((s) => GEM + s + ".png"), GEM + "comet-strip.png",
    GEM + "blackhole-1.png", GEM + "blackhole-2.png", GEM + "blackhole-3.png", GEM + "blackhole-4.png"];
  try {
    await Assets.load(urls); // throws -> caller keeps the DOM board
  } catch (e) {
    destroyApp();            // don't leak the app/canvas on a failed load
    throw e;
  }
  const gemTex = {};
  for (const s of IDS) gemTex[s] = Assets.get(GEM + s + ".png");
  const holeTex = [1, 2, 3, 4].map((t) => Assets.get(GEM + "blackhole-" + t + ".png"));
  const stripTex = Assets.get(GEM + "comet-strip.png");
  // 12 frame textures over the shared strip source — frames are OURS
  // (destroy(false)), the source stays in the Assets cache for remounts.
  const fw = stripTex.source.width / 12, fh = stripTex.source.height;
  const cometFrames = Array.from({ length: 12 }, (_, i) =>
    new Texture({ source: stripTex.source, frame: new Rectangle(i * fw, 0, fw, fh) }));

  const ownTex = [];
  const own = (t) => { ownTex.push(t); return t; };
  // white radial for the coreflash (rgba .9 -> 0 at 66%) — tinted white, stretched per cell
  const flashTex = own(textureFromCanvas(bake(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    r.addColorStop(0, "rgba(255,255,255,.9)"); r.addColorStop(0.66, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  })));
  // shard: 16x4 rounded bar, white — tinted per symbol colour
  const shardTex = own(textureFromCanvas(bake(16, 4, (g) => {
    g.fillStyle = "#fff";
    g.beginPath(); g.roundRect(0, 0, 16, 4, 2); g.fill();
  })));
  // feed spark: 7px dot, #fff6d8 -> #ffd67a 60% -> transparent
  const pullTex = own(textureFromCanvas(bake(14, 14, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0.5, w / 2, h / 2, 7);
    r.addColorStop(0, "#fff6d8"); r.addColorStop(0.6, "#ffd67a"); r.addColorStop(1, "rgba(255,170,80,0)");
    g.fillStyle = r; g.beginPath(); g.arc(w / 2, h / 2, 7, 0, 7); g.fill();
  })));
  // golden shockwave ring (bnCometRing / bigcomet ring): baked mid-size, scaled
  const RING_R = 60, RING_CS = RING_R * 2 + 14;
  const ringTex = own(textureFromCanvas(bake(RING_CS, RING_CS, (g, w, h) => {
    g.strokeStyle = "rgba(255,214,110,.9)"; g.lineWidth = 3;
    g.shadowColor = "rgba(255,196,90,.6)"; g.shadowBlur = 9;
    g.beginPath(); g.arc(w / 2, h / 2, RING_R, 0, 7); g.stroke();
  })));
  // orb heat glow (static drop-shadow 0 0 12px rgba(255,170,80,.6))
  const orbGlowTex = own(textureFromCanvas(bake(96, 96, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, w * 0.28, w / 2, h / 2, w / 2);
    r.addColorStop(0, "rgba(255,170,80,.6)"); r.addColorStop(1, "rgba(255,170,80,0)");
    g.fillStyle = r; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, 7); g.fill();
  })));
  // streak / big-comet halo (the double drop-shadow, rasterised once)
  const cometGlowTex = own(textureFromCanvas(bake(128, 128, (g, w, h) => {
    let r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * 0.30);
    r.addColorStop(0, "rgba(255,196,104,.95)"); r.addColorStop(1, "rgba(255,196,104,0)");
    g.fillStyle = r; g.fillRect(0, 0, w, h);
    r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * 0.5);
    r.addColorStop(0, "rgba(255,170,70,.5)"); r.addColorStop(1, "rgba(255,170,70,0)");
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  })));
  // the flycore charge (bn-flycore radial)
  const coreTex = own(textureFromCanvas(bake(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    r.addColorStop(0, "rgba(255,240,200,.95)"); r.addColorStop(0.46, "rgba(255,196,104,.5)");
    r.addColorStop(0.72, "rgba(255,170,70,0)"); r.addColorStop(1, "rgba(255,170,70,0)");
    g.fillStyle = r; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, 7); g.fill();
  })));

  // orb badge pills (pill + "×N" text baked together), cached per tier+mult+size
  const badgeCache = new Map();
  const BADGE_STYLE = [null,
    { border: "rgba(255,224,150,.75)", col: "#ffe9b6", glow: "rgba(255,214,120,.8)", fs: () => clampVH(13, 2.3, 26) },
    { border: "rgba(140,220,255,.8)", col: "#ffe9b6", glow: "rgba(140,220,255,.85)", fs: () => clampVH(13, 2.3, 26) },
    { border: "rgba(240,150,255,.85)", col: "#ffe9ff", glow: "rgba(235,120,255,.9)", fs: () => clampVH(15, 2.6, 30) },
    { border: "rgba(255,160,110,.95)", col: "#fff2df", glow: "rgba(255,120,70,.95)", fs: () => clampVH(17, 3, 34) },
  ];
  function badgeTexture(tier, mult) {
    const st = BADGE_STYLE[tier] || BADGE_STYLE[1];
    const fs = Math.round(st.fs());
    const key = tier + ":" + mult + ":" + fs;
    let tx = badgeCache.get(key);
    if (tx) return tx;
    const padX = clampVW(7, 0.8, 13), text = "×" + mult;
    const meas = document.createElement("canvas").getContext("2d");
    meas.font = `700 ${fs}px 'DM Sans', Helvetica, sans-serif`;
    const tw = meas.measureText(text).width;
    const w = Math.ceil(tw + padX * 2 + 3), h = Math.ceil(fs * 1.15 + 2 + 3);
    tx = own(textureFromCanvas(bake(w + 8, h + 8, (g) => {
      const x = 4, y = 4, r = h / 2;
      const grad = g.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, "rgba(90,62,18,.92)"); grad.addColorStop(1, "rgba(46,30,8,.94)");
      g.fillStyle = grad;
      g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
      g.strokeStyle = st.border; g.lineWidth = 1.5;
      g.beginPath(); g.roundRect(x, y, w, h, r); g.stroke();
      g.strokeStyle = "rgba(255,235,190,.4)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + r * 0.7, y + 1); g.lineTo(x + w - r * 0.7, y + 1); g.stroke();
      g.font = `700 ${fs}px 'DM Sans', Helvetica, sans-serif`;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.shadowColor = st.glow; g.shadowBlur = 12;
      g.fillStyle = st.col;
      g.fillText(text, x + w / 2, y + h / 2 + 1);
      g.shadowBlur = 0;
      g.fillText(text, x + w / 2, y + h / 2 + 1);
    })));
    badgeCache.set(key, tx);
    return tx;
  }

  // ── scene graph, back to front (mirrors the DOM z-indices) ───────────────
  const stage = app.stage;
  const symC = stage.addChild(new Container());   // cells, z auto
  const liftC = stage.addChild(new Container());  // .lifted winners, z 5
  const ringC = stage.addChild(new Container());  // hail shockwaves (::after — above the comet)
  const shardC = stage.addChild(new Container()); // z 6
  const orbC = stage.addChild(new Container());   // z 8
  const pullC = stage.addChild(new Container());  // z 14
  const flyC = stage.addChild(new Container());   // streaks + core, z 15
  const bigC = stage.addChild(new Container());   // the merged giant, z 16

  // ── cells ────────────────────────────────────────────────────────────────
  // zIndex keeps the DOM's stable cell paint order (later index above) even
  // after a winner is reparented to the lift layer and back
  symC.sortableChildren = true;
  liftC.sortableChildren = true;
  const cells = Array.from({ length: CELLS }, (_, i) => {
    const spr = symC.addChild(new Sprite(Texture.EMPTY));
    spr.anchor.set(0.5); spr.visible = false; spr.zIndex = i * 2;
    const flash = symC.addChild(new Sprite(flashTex));
    flash.anchor.set(0.5); flash.visible = false; flash.zIndex = i * 2 + 1;
    return {
      i, spr, flash, id: null, comet: false,
      dy: 0, dvx: 0, dvy: 0,       // fall offset + devour offset (px)
      s: 1, rot: 0, alpha: 1,      // anim scale/rotation/alpha over the fit
      fit: 1, box: 0,              // texture fit scale for the current art
      win: false, pop: false, dev: false, hidden: false,
    };
  });

  // ── pools ────────────────────────────────────────────────────────────────
  function pool(container, tex, n, setup) {
    const arr = [];
    const mk = () => {
      const s = container.addChild(new Sprite(tex));
      s.anchor.set(0.5); s.visible = false;
      if (setup) setup(s);
      return s;
    };
    for (let i = 0; i < n; i++) arr.push(mk());
    arr.get = () => {
      for (let i = 0; i < arr.length; i++) if (!arr[i].visible) return arr[i];
      const s = mk(); arr.push(s); return s;
    };
    return arr;
  }
  const shardPool = pool(shardC, shardTex, 24, (s) => s.anchor.set(0, 0.5));
  const pullPool = pool(pullC, pullTex, 27);
  const ringPool = pool(ringC, ringTex, 6);       // scatter-hail rings ride above the comets
  // the baked ring's diameter inside its own texture (ring 2*RING_R of RING_CS)
  const RING_FIT = RING_CS / (RING_R * 2);
  // merge streaks: glow + comet pairs
  const flyPool = [];
  const mkFly = () => {
    const glow = flyC.addChild(new Sprite(cometGlowTex));
    glow.anchor.set(0.5); glow.visible = false;
    const spr = flyC.addChild(new Sprite(cometFrames[0]));
    spr.anchor.set(0.5); spr.visible = false;
    const o = { glow, spr };
    flyPool.push(o); return o;
  };
  for (let i = 0; i < 6; i++) mkFly();
  const coreSpr = flyC.addChild(new Sprite(coreTex));
  coreSpr.anchor.set(0.5); coreSpr.visible = false;
  const bigGlow = bigC.addChild(new Sprite(cometGlowTex));
  bigGlow.anchor.set(0.5); bigGlow.visible = false;
  const bigSpr = bigC.addChild(new Sprite(cometFrames[0]));
  bigSpr.anchor.set(0.5); bigSpr.visible = false;
  const bigRing = bigC.addChild(new Sprite(ringTex));
  bigRing.anchor.set(0.5); bigRing.visible = false;

  // orbs: { cell, mult, tier, glow, hole, badge, oy, t0, holeH, badgeH }
  let orbs = [];
  const orbPool = [];
  function orbGet() {
    for (const o of orbPool) if (!o.used) { o.used = true; return o; }
    const glow = orbC.addChild(new Sprite(orbGlowTex)); glow.anchor.set(0.5);
    const hole = orbC.addChild(new Sprite(holeTex[0])); hole.anchor.set(0.5);
    const badge = orbC.addChild(new Sprite(Texture.EMPTY)); badge.anchor.set(0.5);
    const o = { used: true, glow, hole, badge };
    orbPool.push(o); return o;
  }
  function orbFree(o) {
    o.used = false;
    o.glow.visible = o.hole.visible = o.badge.visible = false;
    o.badge.texture = Texture.EMPTY;
  }

  // ── geometry (measured off the live DOM grid, the CSS source of truth) ───
  const geo = { ox: 0, oy: 0, cw: 100, ch: 80, gx: 4, gy: 4, gw: 600, gh: 400, cx: 300, cy: 200 };
  function layout() {
    if (destroyed) return;
    const pr = wrap.getBoundingClientRect();
    const gr = gridEl ? gridEl.getBoundingClientRect() : pr;
    if (gr.width < 2 || gr.height < 2) return;
    const cs = gridEl ? getComputedStyle(gridEl) : null;
    const gx = cs ? parseFloat(cs.columnGap) || 0 : 0;
    const gy = cs ? parseFloat(cs.rowGap) || 0 : 0;
    geo.ox = gr.left - pr.left; geo.oy = gr.top - pr.top;
    geo.gw = gr.width; geo.gh = gr.height; geo.gx = gx; geo.gy = gy;
    geo.cw = (gr.width - (COLS - 1) * gx) / COLS;
    geo.ch = (gr.height - (ROWS - 1) * gy) / ROWS;
    geo.cx = geo.ox + gr.width / 2; geo.cy = geo.oy + gr.height / 2;
    for (const c of cells) { c.box = geo.ch * 1.12; refit(c); }
  }
  const colOf = (i) => i % COLS, rowOf = (i) => Math.floor(i / COLS);
  const cellX = (i) => geo.ox + colOf(i) * (geo.cw + geo.gx) + geo.cw / 2;
  const cellY = (i) => geo.oy + rowOf(i) * (geo.ch + geo.gy) + geo.ch / 2;
  // the DOM's posOf percentages (orbs, shards, pulls, streak starts): percent
  // of the grid box INCLUDING gaps — up to ~3px off the true cell centre at
  // the edges, exactly like the board the player approved
  const pctX = (i) => geo.ox + ((colOf(i) + 0.5) * (100 / COLS)) / 100 * geo.gw;
  const pctY = (i) => geo.oy + ((rowOf(i) + 0.5) * (100 / ROWS)) / 100 * geo.gh;
  function refit(c) {
    if (!c.id) return;
    if (c.comet) { c.fit = 1; return; } // comet frames are stretched to the box
    const t = gemTex[c.id];
    c.fit = t ? Math.min(c.box / t.width, c.box / t.height) : 1;
  }
  layout();

  // ── the tween engine ─────────────────────────────────────────────────────
  // fxMode: 'lock'  — CSS transition semantics: the --fx factor is sampled once
  //                   when the tween starts (drops, sweeps, devours);
  //         'live'  — CSS animation semantics: duration/delay track --fx every
  //                   frame, progress jumps on change (orb in/out);
  //         'none'  — not fx-scaled at all (win pulse, pop, shards, pulls,
  //                   merge, hail — their CSS carries no var(--fx)).
  const tweens = [];
  function tw(o) { // {delay,dur,fxMode,ease?,apply,done?,tag,cell}
    o.t0 = performance.now();
    o.fx0 = o.fxMode === "lock" ? getFx() : 1;
    tweens.push(o);
    return o;
  }
  const killTweens = (pred) => {
    for (let i = tweens.length - 1; i >= 0; i--) {
      if (pred(tweens[i])) { tweens[i] = tweens[tweens.length - 1]; tweens.pop(); }
    }
  };
  function stepTweens(now) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const t = tweens[i];
      const f = t.fxMode === "live" ? getFx() : t.fxMode === "lock" ? t.fx0 : 1;
      const p = (now - t.t0 - t.delay * f) / Math.max(1, t.dur * f);
      if (p < 0) { if (!t.noFill) t.apply(0); continue; } // fill:both backwards fill
      if (p >= 1) {
        t.apply(1);
        tweens[i] = tweens[tweens.length - 1]; tweens.pop();
        if (t.done) t.done();
        continue;
      }
      t.apply(p);
    }
  }

  // ── state the render loop reads ──────────────────────────────────────────
  let hasComet = false;       // any comet on the board -> the 12fps flip runs
  let hotDevour = false, hotBadge = false; // .mathing — holes spin at 1.1s
  let convergeOn = false;
  let bigOn = false, bigT0 = 0;
  let skip = 0;

  function reparent(c, up) {
    const target = up ? liftC : symC;
    if (c.spr.parent !== target) target.addChild(c.spr);
    if (c.flash.parent !== target) target.addChild(c.flash);
  }
  function resetCell(c) {
    c.dy = 0; c.dvx = 0; c.dvy = 0; c.s = 1; c.rot = 0; c.alpha = 1;
    c.win = false; c.pop = false; c.dev = false; c.hidden = false;
    c.flash.visible = false;
    reparent(c, false);
  }
  function setCellId(c, id) {
    c.id = id || null;
    c.comet = id === "scatter";
    if (!id) { c.spr.visible = false; return; }
    c.spr.texture = c.comet ? cometFrames[0] : gemTex[id];
    refit(c);
  }
  const orbOwns = (i) => { for (const o of orbs) if (o.cell === i) return true; return false; };

  // ═════════ the imperative ops (one per DOM state flip) ═══════════════════

  // instant settle — idle greeting board, or a scene attaching mid-round
  function setBoard(ids, orbList) {
    killTweens(() => true);
    for (let i = 0; i < CELLS; i++) { resetCell(cells[i]); setCellId(cells[i], ids[i]); }
    for (const o of orbs) orbFree(o.slot);
    orbs = [];
    for (const b of orbList || []) orbAdd(b, null, 0);
    for (const c of cells) if (orbOwns(c.i)) c.hidden = true;
    clearMerge();
    hotDevour = hotBadge = false;
  }

  // bnDrop — mode 'open': .45s rain, col*70 + (ROWS-1-row)*75 stagger;
  // mode 'tumble': one fast .3s drop, no stagger. Both fx-LOCKED like the
  // CSS transitions they replace. shifts is the same array shiftsFor() fed
  // the DOM (survivors r-keep, newcomers fresh+1.35, opening rigid sheet).
  function dropIn(ids, shifts, mode) {
    // cell + merge tweens die; riding orbs keep falling, and shards/pulls are
    // independent timed elements in the DOM — they finish across the refill
    killTweens((t) => t.tag !== "orb" && t.tag !== "shard" && t.tag !== "pull");
    clearMerge();
    hotDevour = false;
    for (let i = 0; i < CELLS; i++) {
      const c = cells[i];
      resetCell(c);
      setCellId(c, ids[i]);
      if (orbOwns(i)) { c.hidden = true; continue; }
      const sh = shifts[i] || 0;
      if (!c.id || sh <= 0) continue;
      const start = -sh * 1.05 * geo.ch;          // 105% of the cell per row
      c.dy = start;
      tw({
        tag: "drop", cell: i, fxMode: "lock",
        delay: mode === "open" ? colOf(i) * 70 + (ROWS - 1 - rowOf(i)) * 75 : 0,
        dur: mode === "open" ? 450 : 300,
        apply: (p) => { c.dy = start * (1 - (mode === "open" ? E_DROP_OPEN : E_DROP_TUM)(p)); },
      });
    }
  }

  // the exit: bottom-first within a column, columns left to right, symbols
  // accelerating off the bottom edge (672% of the cell), orbs riding their
  // own column beat (700%). Devoured cells hold still, like the DOM.
  function sweepOut() {
    killTweens((t) => t.tag === "drop");          // the exit takes over from mid-flight
    for (const c of cells) {
      if (!c.id || c.dev) continue;
      const from = c.dy;
      tw({
        tag: "exit", cell: c.i, fxMode: "lock",
        delay: colOf(c.i) * 55 + (ROWS - 1 - rowOf(c.i)) * 60, dur: 450,
        apply: (p) => { c.dy = from + (6.72 * geo.ch - from) * E_EXIT(p); },
      });
    }
    for (const o of orbs) {
      const oc = colOf(o.cell), orw = rowOf(o.cell);
      tw({
        tag: "orb", fxMode: "lock",
        delay: oc * 55 + (ROWS - 1 - orw) * 60, dur: 450,
        apply: (p) => { o.oy = 7 * geo.ch * E_EXIT(p); },
      });
    }
  }

  function clearOrbs() {
    killTweens((t) => t.tag === "orb");
    for (const o of orbs) orbFree(o.slot);
    orbs = [];
    for (const c of cells) if (c.hidden && !c.dev) c.hidden = false;
  }

  // step-start reset: winCells/popCells/devour/converge all cleared in one
  // render. Sprites snap back to neutral exactly like the DOM classes coming
  // off — the very next facade call is dropIn or sweepOut.
  function clearFx() {
    // shards and pulls are NOT cleared: in the DOM they are separate timed
    // elements that outlive the win set — here their own done() hides them
    killTweens((t) => t.tag === "win" || t.tag === "winf" || t.tag === "pop" || t.tag === "dev" || t.tag === "fly");
    for (const s of ringPool) s.visible = false;
    for (const c of cells) {
      const keepHidden = orbOwns(c.i);
      resetCell(c);
      c.hidden = keepHidden;
    }
    clearMerge();
    hotDevour = false;
  }

  // bnWinPulse (.55s ease-in-out x2) + the white coreflash (bnFlash .62s,
  // fill both — it PERSISTS at .25 until the cells clear)
  function winPulse(cellIdx) {
    for (const i of cellIdx) {
      const c = cells[i];
      if (!c.id || c.hidden) continue;
      c.win = true;
      reparent(c, true);                          // .bn-cell.lifted
      tw({
        tag: "win", cell: i, fxMode: "none", dur: 1100,
        apply: (p) => {
          const q = p < 0.5 ? p * 2 : p * 2 - 1;  // two iterations
          c.rot = pw(q, KF_WIN_ROT, EASE_INOUT) * DEG;
          c.s = pw(q, KF_WIN_SC, EASE_INOUT);
        },
      });
      c.flash.visible = true;
      c.flash.alpha = 0;
      // its own tag: the flash element's bnFlash keeps running in the DOM
      // even when bn-pop or the devour transform takes the symbol over
      tw({
        tag: "winf", cell: i, fxMode: "none", dur: 620,
        apply: (p) => { c.flash.alpha = pw(p, KF_FLASH, EASE_OUT); },
      });
    }
  }

  // the trigger celebration: bnCometHail (2.2s wind-up/spin/wobble, ends
  // swollen at 1.18 and STAYS) + two golden bnCometRing shockwaves (1.05s x2)
  function scatterPulse(cellIdx) {
    let k = 0;
    for (const i of cellIdx) {
      const c = cells[i];
      if (!c.id || c.hidden) continue;
      c.win = true;
      reparent(c, true);
      tw({
        tag: "win", cell: i, fxMode: "none", dur: 2200,
        apply: (p) => {
          c.s = pw(p, KF_HAIL_SC, EASE_INOUT);
          c.rot = pw(p, KF_HAIL_ROT, EASE_INOUT) * DEG;
        },
      });
      const ring = ringPool.get();
      const ringD = c.box * 1.24;                  // inset -12% of the symbol box
      ring.visible = true;
      ring.position.set(cellX(i), cellY(i));
      tw({
        tag: "win", cell: i, fxMode: "none", dur: 2100,
        apply: (p) => {
          const q = p < 0.5 ? p * 2 : p * 2 - 1;
          const sc = 0.55 + (1.65 - 0.55) * EASE_OUT(q);
          // the DOM ring is a ::after of the PULSING comet — its size is the
          // ring keyframe × the parent's live bnCometHail scale, so the rings
          // breathe with the comets instead of sitting up to ~34% small
          ring.width = ring.height = ringD * sc * c.s * RING_FIT;
          ring.alpha = pw(q, KF_RING_A, EASE_OUT);
        },
        done: () => { ring.visible = false; },
      });
      k++;
    }
    return k;
  }

  // bnPop — the implode: over-scale then collapse to nothing with a twist
  function popWins(cellIdx) {
    for (const i of cellIdx) {
      const c = cells[i];
      if (!c.id || c.hidden) continue;
      c.pop = true;
      // bn-pop's !important beats a still-running bnWinPulse (turbo shortens
      // the sleeps but never the pulse) — the win transform tween must die.
      // The coreflash is a SIBLING element: the DOM leaves it standing (alpha
      // .25) over the emptied cell until the next step clears the win set.
      killTweens((t) => t.cell === i && t.tag === "win");
      tw({
        tag: "pop", cell: i, fxMode: "none", dur: 420,
        apply: (p) => {
          c.s = pw(p, KF_POP_SC, E_POP);
          c.alpha = pw(p, KF_POP_A, E_POP);
          c.rot = (p <= 0.35 ? 0 : E_POP((p - 0.35) / 0.65) * 30) * DEG;
        },
      });
    }
  }

  // the round's finally{}: winCells/popCells cleared, devour/converge/orbs
  // left exactly as they stand (a defensive no-op on the normal path)
  function clearWinPop() {
    killTweens((t) => t.tag === "win" || t.tag === "winf" || t.tag === "pop");
    for (const s of ringPool) s.visible = false;
    for (const c of cells) {
      if (c.dev || (!c.win && !c.pop)) { if (!c.dev) c.flash.visible = false; continue; }
      c.win = false; c.pop = false;
      c.s = 1; c.rot = 0; c.alpha = 1;
      c.flash.visible = false;
      reparent(c, false);
    }
  }

  // six shards, 60 degrees apart with scatter, thrown from the cell centre
  function shards(cell, colour) {
    if (typeof colour === "string") colour = parseInt(colour.slice(1), 16) || 0xffffff;
    const x = pctX(cell), y = pctY(cell);
    for (let k = 0; k < 6; k++) {
      const s = shardPool.get();
      const a = (k * 60 + Math.random() * 30) * DEG;
      s.visible = true; s.tint = colour; s.rotation = a; s.alpha = 1;
      tw({
        tag: "shard", fxMode: "none", dur: 550,
        apply: (p) => {
          const e = EASE_OUT(p);
          const d = 6 + 58 * e;
          const sc = 1 - 0.7 * e;                 // 16x4 css px, scaling to .3
          s.position.set(x + Math.cos(a) * d, y + Math.sin(a) * d);
          s.width = 16 * sc; s.height = 4 * sc;
          s.alpha = 1 - e;
        },
        done: () => { s.visible = false; },
      });
    }
  }

  // IN THE FEATURE the winners do not burst — the nearest hole DRAGS them in.
  // map[i] = {dx,dy,dist}: dx/dy in the DOM's own units (percent of the cell,
  // 105 per step), dist in cells. Stagger capped at 180ms, flight 450ms,
  // fx-locked like the transition it replaces.
  function devour(map) {
    hotDevour = true;
    for (const key in map) {
      const i = +key, c = cells[i];
      if (!c.id || c.hidden) continue;
      const d = map[key];
      killTweens((t) => t.cell === i && t.tag === "win");
      c.dev = true;                               // the flash rides the mover into the hole
      const tx = (d.dx / 100) * geo.cw, ty = (d.dy / 100) * geo.ch;
      tw({
        tag: "dev", cell: i, fxMode: "lock",
        delay: Math.min(Math.round(d.dist * 45), 180), dur: 450,
        apply: (p) => {
          const e = E_DEVOUR(p);
          c.dvx = tx * e; c.dvy = ty * e;
          c.s = 1 + (0.04 - 1) * e;
          c.rot = 220 * e * DEG;
        },
      });
    }
  }

  // bnPull — nine sparks spiralling INTO a feeding hole (a: k*40+(k%3)*13,
  // delay: k*70+(k%4)*35, .9s, 120px -> 2px while swinging +210deg)
  function feed(cell) {
    const x = pctX(cell), y = pctY(cell);
    for (let k = 0; k < 9; k++) {
      const s = pullPool.get();
      const a0 = (k * 40 + (k % 3) * 13) * DEG;
      s.visible = true; s.alpha = 0;
      tw({
        tag: "pull", fxMode: "none", delay: k * 70 + (k % 4) * 35, dur: 900,
        apply: (p) => {
          const e = E_PULL(p);
          const a = a0 + 210 * DEG * e;
          const d = 120 + (2 - 120) * e;
          s.position.set(x + Math.cos(a) * d, y + Math.sin(a) * d);
          s.width = s.height = 7 * (1.1 + (0.15 - 1.1) * e); // 7px dot, 1.1 -> .15
          s.alpha = pw(p, KF_PULL_A, E_PULL);
        },
        done: () => { s.visible = false; },
      });
    }
  }

  // black hole entrance — rides the drop on its column's beat (bnOrbIn:
  // -640% above, fill both, fx-LIVE like the CSS animation it replaces)
  function orbAdd(bomb, mode, t0) {
    const tier = Math.max(1, Math.min(4, bomb.tier || 1));
    const slot = orbGet();
    const o = {
      slot, glow: slot.glow, hole: slot.hole, badge: slot.badge,
      cell: bomb.cell, mult: bomb.mult, tier, oy: 0, t0: t0 || performance.now(),
    };
    o.hole.texture = holeTex[tier - 1];
    o.badge.texture = badgeTexture(tier, bomb.mult);
    o.glow.visible = o.hole.visible = o.badge.visible = true;
    orbs.push(o);
    if (mode) {
      const bc = colOf(bomb.cell), br = rowOf(bomb.cell);
      o.oy = -6.4 * geo.ch;
      tw({
        tag: "orb", fxMode: "live",
        delay: mode === "open" ? bc * 70 + (ROWS - 1 - br) * 75 : 0,
        dur: mode === "open" ? 450 : 300,
        apply: (p) => { o.oy = -6.4 * geo.ch * (1 - (mode === "open" ? E_DROP_OPEN : E_DROP_TUM)(p)); },
      });
    }
    return o;
  }
  function orbEnter(bomb, mode) {
    orbAdd(bomb, mode, performance.now());
    const c = cells[bomb.cell];
    c.hidden = true; c.spr.visible = false;       // a meteor OWNS its cell
  }

  // the merge: comets leave their cells as streaks converging on the centre
  // (bnFlyTrack .62s, k*90ms apart) while the core charges (bnCoreCharge .8s)
  function mergeCeremony(cellIdx) {
    killTweens((t) => t.tag === "win");
    for (const s of ringPool) s.visible = false;
    convergeOn = true;
    let k = 0;
    for (const i of cellIdx) {
      const c = cells[i];
      resetCell(c);
      c.hidden = true;                            // its cell empties
      const fl = k < flyPool.length ? flyPool[k] : mkFly();
      const sx = pctX(i) - geo.cx, sy = pctY(i) - geo.cy;
      const size = geo.ch * 1.05;
      fl.spr.visible = fl.glow.visible = true;
      fl.spr.width = fl.spr.height = size;
      fl.glow.width = fl.glow.height = size * 2.4;
      fl.t0 = performance.now();
      tw({
        tag: "fly", fxMode: "none", delay: k * 90, dur: 620,
        apply: (p) => {
          const e = E_FLY(p);
          const x = geo.cx + sx * (1 - e), y = geo.cy + sy * (1 - e);
          const sc = pw(p, KF_FLY_SC, E_FLY);
          const al = pw(p, KF_FLY_A, E_FLY);
          fl.spr.position.set(x, y); fl.glow.position.set(x, y);
          fl.spr.width = fl.spr.height = size * sc;
          fl.glow.width = fl.glow.height = size * 2.4 * sc;
          fl.spr.alpha = al; fl.glow.alpha = al;
        },
        done: () => { fl.spr.visible = fl.glow.visible = false; },
      });
      k++;
    }
    coreSpr.visible = true;
    coreSpr.position.set(geo.cx, geo.cy);
    const coreSize = geo.ch * 1.25;
    tw({
      tag: "fly", fxMode: "none", dur: 800,
      apply: (p) => {
        const e = E_CORE(p);
        const sc = 0.1 + (1.18 - 0.1) * e;
        coreSpr.width = coreSpr.height = coreSize * sc;
        coreSpr.alpha = pw(p, KF_CORE_A, E_CORE);
      },
    });
  }
  function clearMerge() {
    if (!convergeOn && !bigOn) return;
    convergeOn = false;
    coreSpr.visible = false;
    for (const fl of flyPool) { fl.spr.visible = false; fl.glow.visible = false; }
    bigOn = false;
    bigSpr.visible = bigGlow.visible = bigRing.visible = false;
    killTweens((t) => t.tag === "fly" || t.tag === "big");
  }

  // ...and become ONE great comet (bnBigComet 1s swell + bnCometRing .85s)
  function bigComet(on) {
    if (!on) {
      bigOn = false;
      bigSpr.visible = bigGlow.visible = bigRing.visible = false;
      killTweens((t) => t.tag === "big");
      return;
    }
    bigOn = true; bigT0 = performance.now();
    const size = geo.ch * 2.9;
    // the strip's head sits at +6%/+5% inside its frame; the -56%/-55%
    // translate in the keyframes corrects it back over the grid centre
    const bx = geo.cx - size * 0.06, by = geo.cy - size * 0.05;
    bigSpr.visible = bigGlow.visible = true;
    bigSpr.position.set(bx, by); bigGlow.position.set(bx, by);
    tw({
      tag: "big", fxMode: "none", dur: 1000,
      apply: (p) => {
        const sc = pw(p, KF_BIG_SC, EASE_INOUT);
        const al = pw(p, KF_BIG_A, EASE_INOUT);
        bigSpr.width = bigSpr.height = size * sc;
        bigGlow.width = bigGlow.height = size * 1.9 * sc;
        bigSpr.alpha = al; bigGlow.alpha = al * 0.9;
      },
    });
    bigRing.visible = true;
    bigRing.alpha = 0;                            // bnCometRing has no fill: hidden until its .1s delay
    bigRing.position.set(bx, by);
    tw({
      tag: "big", fxMode: "none", delay: 100, dur: 850, noFill: true,
      apply: (p) => {
        const e = EASE_OUT(p);
        const sc = 0.55 + (1.65 - 0.55) * e;
        // the DOM ring is a ::after of the SWELLING comet: its size is the
        // ring keyframe × the parent's bnBigComet scale at the same wall
        // instant — the ring's elapsed time is delay 100 + p·850 of the
        // parent's 1000ms swell (both start on the same bigComet(true) call)
        const psc = pw((100 + p * 850) / 1000, KF_BIG_SC, EASE_INOUT);
        bigRing.width = bigRing.height = size * 0.92 * sc * psc * RING_FIT; // inset 4%
        bigRing.alpha = pw(p, KF_RING_A, EASE_OUT);
      },
      done: () => { bigRing.visible = false; },
    });
  }

  const setHot = (on) => { hotBadge = on; };       // .mathing via the mult badge

  // ── render (caller's rAF; one render per call, allocation-free) ──────────
  const HOLE_DUR = [7000, 5500, 4000, 2800];
  const ORB_IMG = [1.18, 1.32, 1.46, 1.62];
  function render(now) {
    if (destroyed) return;
    stepTweens(now);

    hasComet = false;
    for (let i = 0; i < CELLS; i++) {
      const c = cells[i];
      if (!c.id || c.hidden) { c.spr.visible = false; c.flash.visible = false; continue; }
      c.spr.visible = true;
      const x = cellX(i) + c.dvx, y = cellY(i) + c.dy + c.dvy;
      c.spr.position.set(x, y);
      c.spr.rotation = c.rot;
      c.spr.alpha = c.alpha;
      if (c.comet) {
        hasComet = true;
        // bnComet 1.15s steps(12, jump-none), per-cell phase -(i%12)*96ms
        const f = Math.floor((((now + (i % 12) * 96) % 1150) / 1150) * 12) % 12;
        c.spr.texture = cometFrames[f];
        c.spr.width = c.spr.height = c.box * c.s;
      } else {
        const t = gemTex[c.id];
        c.spr.scale.set(c.fit * c.s);
        if (c.spr.texture !== t) c.spr.texture = t;
      }
      if (c.flash.visible) {
        c.flash.position.set(x, y);
        // .bn-coreflash: inset -10% of the cell box; the devour transform
        // lives on the MOVER, so it shrinks the flash with the symbol
        const fs = c.dev ? c.s : 1;
        c.flash.width = geo.cw * 1.2 * fs; c.flash.height = geo.ch * 1.2 * fs;
      }
    }

    // orbs: linear spin (scale breathing 1<->1.06), badge pulse on t3/t4,
    // 1.1s hot spin while the board is .mathing
    const hot = hotDevour || hotBadge;
    for (const o of orbs) {
      const imgH = geo.ch * ORB_IMG[o.tier - 1];
      // the badge is baked at 2x with a 4px transparent margin on EVERY side,
      // so the sprite must draw at texture/2 on BOTH axes or the pill (and
      // its ×N text) renders vertically squashed. Layout uses the true pill
      // height (margin excluded); the margin is symmetric, so the pill's
      // centre coincides with the sprite's centre.
      const badgeH = o.badge.texture.height / 2 - 8; // pill height, for layout
      const badgeW = o.badge.texture.width / 2;      // draw width (incl. margin)
      const badgeDrawH = badgeH + 8;                 // draw height (incl. margin)
      const stackH = imgH + badgeH - 0.34 * geo.ch;
      const x = pctX(o.cell), yTop = pctY(o.cell) - stackH / 2 + o.oy;
      const holeY = yTop + imgH / 2;
      const D = hot ? 1100 : HOLE_DUR[o.tier - 1];
      const hp = ((now - o.t0) % D) / D;
      const breathe = 1 + 0.06 * (1 - Math.abs(1 - 2 * hp));
      o.hole.position.set(x, holeY);
      o.hole.rotation = hp * Math.PI * 2;
      o.hole.width = o.hole.height = imgH * breathe;
      o.glow.position.set(x, holeY);
      o.glow.width = o.glow.height = imgH * 1.45;
      o.badge.position.set(x, yTop + imgH - 0.34 * geo.ch + badgeH / 2);
      if (o.tier >= 3) {
        const pd = o.tier === 4 ? 700 : 1100;
        const bp = ((now - o.t0) % pd) / pd;
        const q = bp < 0.5 ? bp * 2 : 2 - bp * 2;
        const sc = 1 + 0.14 * EASE_INOUT(q);
        o.badge.width = badgeW * sc; o.badge.height = badgeDrawH * sc;
      } else {
        o.badge.width = badgeW; o.badge.height = badgeDrawH;
      }
    }

    // the merge streaks + big comet flip their strip frames
    if (convergeOn) {
      const f = Math.floor(((now % 500) / 500) * 12) % 12;
      for (const fl of flyPool) if (fl.spr.visible) fl.spr.texture = cometFrames[f];
    }
    if (bigOn) {
      const f = Math.floor((((now - bigT0) % 550) / 550) * 12) % 12;
      bigSpr.texture = cometFrames[f];
    }

    // idle frame-skip: a settled board with no comets, holes or effects only
    // needs a heartbeat (template: the lander's calm 1-in-4)
    const calm = tweens.length === 0 && !hasComet && orbs.length === 0 && !convergeOn && !bigOn;
    skip = calm ? (skip + 1) % 4 : 0;
    if (skip === 0) app.renderer.render(app.stage);
  }

  function fit() {
    fitApp();
    layout();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    // detach Assets-cache textures so their entries survive StrictMode
    // remounts, then let the app tear the stage down, then destroy what we
    // baked. Comet frame textures are ours but their SOURCE is the cached
    // strip: destroy(false) keeps it alive.
    for (const c of cells) c.spr.texture = Texture.EMPTY;
    for (const o of orbPool) o.hole.texture = Texture.EMPTY;
    for (const fl of flyPool) fl.spr.texture = Texture.EMPTY;
    bigSpr.texture = Texture.EMPTY;
    destroyApp();
    for (const t of cometFrames) t.destroy(false);
    for (const t of ownTex) t.destroy(true);
    badgeCache.clear();
  }

  return {
    kind: "webgl",
    fit, render, destroy,
    setBoard, dropIn, sweepOut, clearOrbs, clearFx, clearWinPop,
    winPulse, scatterPulse, popWins, shards, devour, feed,
    orbEnter, mergeCeremony, bigComet, setHot,
  };
}
