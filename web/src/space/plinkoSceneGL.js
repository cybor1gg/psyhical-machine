// PLINKO — PixiJS (WebGL) scene renderer. A scene-graph port of the Canvas2D
// draw() in PlinkoSpace.jsx, visually identical, reading the SAME `world`
// object each frame. This module renders ONLY — guided physics, economy and
// DOM UI stay in PlinkoSpace. If WebGL is unavailable createPlinkoScene()
// throws and the caller keeps the Canvas2D path.
//
// Performance contract (cabinet fleet, Firefox on Fedora 44):
//   • no per-frame allocations in render(): balls / sparks / pop texts are
//     pooled (geometric growth), culling is .visible, never add/remove
//   • the peg field and slot row are STATIC layers rebuilt only when geom()
//     hands the world new arrays (fit / rows change / new payout table) —
//     detected by identity, exactly like the lander's `sim !== curSim`
//   • every canvas shadowBlur becomes a baked glow sprite whose ALPHA is
//     animated (blur never re-rendered); peg hit growth scales baked sprites
//   • one render per call, no internal ticker — the caller's parked rAF loop
//     stays in charge: when the loop parks, this scene freezes with it
import { Container, Sprite, Text } from "pixi.js";
import { createPixiApp, textureFromCanvas, bake } from "./pixiApp";

const BR = 16;                  // peg bodies baked at this radius, scaled per peg
const OUT_R = 16;               // gold hit-outline ring bake radius
const OUT_CS = OUT_R * 2 + 6;   // its canvas CSS size (radius + stroke pad)
const BALL_R = 16;              // orb bake radius (constant glow baked in)
const BALL_CS = BALL_R * 2 + 28;
const GLOW_R = 32;              // soft radial glow bake radius (64px canvas)
const SLOT_GP = 16;             // slot glow pad (room for the baked blur)

// hex string -> number, memoised (spark colors are a tiny fixed set)
const colCache = new Map();
function colNum(col) {
  let v = colCache.get(col);
  if (v === undefined) { v = parseInt(col.slice(1), 16); colCache.set(col, v); }
  return v;
}

// slotColor() from PlinkoSpace.draw(), producing a tint number instead of a
// css string (blue center → gold → red edges)
function slotTint(i, n) {
  const d = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  let c1, c2, t;
  if (d < 0.5) { t = d / 0.5; c1 = [63, 127, 174]; c2 = [199, 154, 84]; }
  else { t = (d - 0.5) / 0.5; c1 = [199, 154, 84]; c2 = [255, 90, 74]; }
  return (lerp(c1[0], c2[0], t) << 16) | (lerp(c1[1], c2[1], t) << 8) | lerp(c1[2], c2[2], t);
}

export async function createPlinkoScene({ wrap, world, slotLabel, onLost }) {
  // shared engine util: webgl-only Application (autoStart:false, dpr cap +
  // 2.2MP clamp), canvas mounted into wrap, context-loss watchdog (3s grace,
  // then onLost hands rendering back to the caller's live Canvas2D fallback).
  // Throws when WebGL is unavailable.
  const { app, fit, destroy: destroyApp } = await createPixiApp({ wrap, onLost });
  let destroyed = false;

  // ── baked textures (owned — destroyed with the scene) ────────────────────
  const ownTex = [];
  const own = (t) => { ownTex.push(t); return t; };

  // white dot — sparks, tinted per particle
  const dotTex = own(textureFromCanvas(bake(20, 20, (g, w, h) => {
    g.fillStyle = "#ffffff";
    g.beginPath(); g.arc(w / 2, h / 2, 8, 0, 7); g.fill();
  })));
  // soft white radial glow — sun pulse (grey tint) + peg hit (gold tint);
  // the canvas shadowBlur breathing becomes alpha animation on this sprite
  const glowTex = own(textureFromCanvas(bake(GLOW_R * 2, GLOW_R * 2, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, GLOW_R);
    gr.addColorStop(0, "rgba(255,255,255,.85)");
    gr.addColorStop(0.35, "rgba(255,255,255,.35)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  })));
  // gold hit-outline ring: baked once, SCALED to r + 5*hit per frame
  const outTex = own(textureFromCanvas(bake(OUT_CS, OUT_CS, (g, w, h) => {
    g.strokeStyle = "#f0d99a"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(w / 2, h / 2, OUT_R, 0, 7); g.stroke();
  })));
  // sun peg body (moon-grey mini-star)
  const sunTex = own(textureFromCanvas(bake(BR * 2 + 4, BR * 2 + 4, (g, w, h) => {
    const cx = w / 2, cy = h / 2, r = BR;
    const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.12, cx, cy, r);
    gr.addColorStop(0, "#f2f3f6"); gr.addColorStop(0.6, "#c9cdd8"); gr.addColorStop(1, "#8f95a6");
    g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fillStyle = gr; g.fill();
  })));
  // gold orb with its CONSTANT glow (shadowBlur 12) baked straight in
  const ballTex = own(textureFromCanvas(bake(BALL_CS, BALL_CS, (g, w, h) => {
    const cx = w / 2, cy = h / 2, r = BALL_R;
    const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.15, cx, cy, r);
    gr.addColorStop(0, "#fdf3d0"); gr.addColorStop(0.55, "#e7c476"); gr.addColorStop(1, "#a9843e");
    g.shadowColor = "rgba(240,217,154,.8)"; g.shadowBlur = 24; // device px (2x bake)
    g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fillStyle = gr; g.fill();
  })));

  // planet bodies + saturn rings — lazily baked once per hue triple (5 hues)
  const planetTexMap = new Map(), ringTexMap = new Map();
  const planetTexFor = (hue) => {
    const k = hue.join();
    let t = planetTexMap.get(k);
    if (!t) {
      const [cr, cg, cb] = hue;
      t = own(textureFromCanvas(bake(BR * 2 + 4, BR * 2 + 4, (g, w, h) => {
        const cx = w / 2, cy = h / 2, r = BR;
        const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
        gr.addColorStop(0, `rgba(${Math.min(255, cr + 55)},${Math.min(255, cg + 55)},${Math.min(255, cb + 55)},1)`);
        gr.addColorStop(0.65, `rgb(${cr},${cg},${cb})`);
        gr.addColorStop(1, `rgb(${cr >> 1},${cg >> 1},${cb >> 1})`);
        g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fillStyle = gr; g.fill();
      })));
      planetTexMap.set(k, t);
    }
    return t;
  };
  const RING_CW = Math.ceil(BR * 3.8 + 8), RING_CH = Math.ceil(BR * 1.1 + 10);
  const ringTexFor = (hue) => {
    const k = hue.join();
    let t = ringTexMap.get(k);
    if (!t) {
      const [cr, cg, cb] = hue;
      t = own(textureFromCanvas(bake(RING_CW, RING_CH, (g, w, h) => {
        g.beginPath(); g.ellipse(w / 2, h / 2, BR * 1.9, BR * 0.55, 0, 0, 7);
        g.strokeStyle = `rgb(${cr},${cg},${cb})`; g.lineWidth = BR * 0.2; g.stroke();
      })));
      ringTexMap.set(k, t);
    }
    return t;
  };

  // ── scene graph, back to front (mirrors draw() order) ────────────────────
  const stage = app.stage;
  const pegC = stage.addChild(new Container());   // static, rebuilt on geom()
  const slotC = stage.addChild(new Container());  // static, rebuilt on geom()/table
  const ballC = stage.addChild(new Container());
  const sparkC = stage.addChild(new Container());
  const popC = stage.addChild(new Container());

  // ── pools (preallocated, geometric growth, cull by .visible) ─────────────
  function poolGet(pool, i, create) {
    if (i >= pool.length) {
      const target = Math.max(i + 1, pool.length ? pool.length * 2 : 8);
      while (pool.length < target) { const o = create(); o.visible = false; pool.push(o); }
    }
    return pool[i];
  }
  const hideRest = (pool, from) => { for (let j = from; j < pool.length; j++) pool[j].visible = false; };
  const mkBall = () => { const s = ballC.addChild(new Sprite(ballTex)); s.anchor.set(0.5); return s; };
  const mkSpark = () => { const s = sparkC.addChild(new Sprite(dotTex)); s.anchor.set(0.5); return s; };
  const mkPop = () => {
    // white fill + .tint for the win-green / neutral-grey swap (re-raster free)
    const t = popC.addChild(new Text({
      text: "", style: { fontFamily: "DM Sans", fontSize: 22, fontWeight: "700", fill: 0xffffff },
    }));
    t.anchor.set(0.5); t._txt = ""; return t;
  };
  const ballPool = []; for (let i = 0; i < 12; i++) ballPool.push(mkBall());
  const sparkPool = []; for (let i = 0; i < 40; i++) sparkPool.push(mkSpark());
  const popPool = []; for (let i = 0; i < 8; i++) popPool.push(mkPop());
  ballPool.forEach((s) => (s.visible = false));
  sparkPool.forEach((s) => (s.visible = false));
  popPool.forEach((s) => (s.visible = false));

  // ── static peg layer (rebuilt only when geom() makes new pegRows) ────────
  let pegNodes = [];
  let lastPegRows = null;
  function rebuildPegs() {
    lastPegRows = world.pegRows;
    for (const n of pegNodes) n.c.destroy({ children: true }); // shared textures kept
    pegC.removeChildren();
    pegNodes = [];
    for (const row of world.pegRows || []) for (const p of row) {
      const c = pegC.addChild(new Container());
      c.position.set(p.x, p.y);
      // glow behind the body: sun pulse (grey) or hit flash (gold)
      const glow = c.addChild(new Sprite(glowTex));
      glow.anchor.set(0.5);
      glow.scale.set(0.5 * (p.r * 3) / GLOW_R); // glow radius = 3× peg radius
      let body, ring = null, glowGold = false;
      if (p.kind === "sun") {
        glow.tint = 0xdcdee8; // rgba(220,222,232,.5) shadow → alpha-animated glow
        body = c.addChild(new Sprite(sunTex));
      } else {
        glow.tint = 0xf0d99a; glow.alpha = 0; glowGold = true;
        body = c.addChild(new Sprite(planetTexFor(p.hue)));
        if (p.kind === "ring") {
          ring = c.addChild(new Sprite(ringTexFor(p.hue)));
          ring.anchor.set(0.5); ring.rotation = p.tilt;
          ring.alpha = 0.4; ring.scale.set(0.5 * p.r / BR);
        }
      }
      body.anchor.set(0.5); body.scale.set(0.5 * p.r / BR); // 2x bake → 0.5 base
      const out = c.addChild(new Sprite(outTex));
      out.anchor.set(0.5); out.visible = false;
      pegNodes.push({ c, p, body, ring, glow, glowGold, out, hot: false });
    }
  }

  // ── static slot row (rebuilt on geom() OR a new payout table) ────────────
  // Rounded rects baked at the CURRENT slot size (all slots share one set of
  // textures), tinted per slot; the ≥10x steady glow and the kick glow are the
  // same baked blur sprite with animated alpha instead of shadowBlur.
  let slotNodes = [];
  let slotTexList = [];
  let lastSlots = null, lastTable = null, lastSlotH = 0;
  function rebuildSlots() {
    lastSlots = world.slots; lastTable = world.table; lastSlotH = world.slotH;
    for (const s of slotNodes) s.c.destroy({ children: true });
    slotC.removeChildren();
    slotNodes = [];
    const oldTex = slotTexList; slotTexList = [];
    for (const t of oldTex) t.destroy(true);
    const slots = world.slots || [], n = slots.length, tb = world.table || [];
    if (!n) return;
    const sw = slots[0].w, rw = sw - 5, rh = world.slotH || 40, rad = Math.min(9, rw * 0.22);
    if (!(rw > 1) || !(rh > 1)) return;
    const oT = (t) => { slotTexList.push(t); return t; };
    const rr = (g, x, y, w2, h2) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w2, h2, rad); else g.rect(x, y, w2, h2); };
    // white fill (tinted per slot with the blue→gold→red gradient color)
    const fillTex = oT(textureFromCanvas(bake(rw, rh, (g) => { rr(g, 0, 0, rw, rh); g.fillStyle = "#ffffff"; g.fill(); })));
    // the glass overlay: white top sheen → black bottom shade (untinted)
    const gradTex = oT(textureFromCanvas(bake(rw, rh, (g) => {
      const grd = g.createLinearGradient(0, 0, 0, rh);
      grd.addColorStop(0, "rgba(255,255,255,.28)");
      grd.addColorStop(0.28, "rgba(255,255,255,0)");
      grd.addColorStop(1, "rgba(0,0,0,.38)");
      rr(g, 0, 0, rw, rh); g.fillStyle = grd; g.fill();
    })));
    // white outline, alpha-animated on kick (.22 idle → .4+kick*.6)
    const strokeTex = oT(textureFromCanvas(bake(rw + 4, rh + 4, (g) => {
      rr(g, 2, 2, rw, rh); g.strokeStyle = "#ffffff"; g.lineWidth = 1.5; g.stroke();
    })));
    // baked blur halo (canvas shadowBlur 12/18·kick → this sprite's alpha)
    const glowSTex = oT(textureFromCanvas(bake(rw + SLOT_GP * 2, rh + SLOT_GP * 2, (g) => {
      g.shadowColor = "#ffffff"; g.shadowBlur = 28; // device px (2x bake)
      rr(g, SLOT_GP, SLOT_GP, rw, rh); g.fillStyle = "#ffffff"; g.fill();
    })));
    for (let i = 0; i < n; i++) {
      const c = slotC.addChild(new Container());
      c.position.set(slots[i].x + 2.5, world.slotY);
      const tint = slotTint(i, n);
      const mult = tb.length ? tb[Math.min(i, tb.length - 1)] : 0;
      const always = tb.length > 0 && mult >= 10; // ≥10x slots glow steadily
      const glow = c.addChild(new Sprite(glowSTex));
      glow.position.set(-SLOT_GP, -SLOT_GP);
      glow.width = rw + SLOT_GP * 2; glow.height = rh + SLOT_GP * 2;
      glow.tint = tint; glow.alpha = always ? 0.65 : 0;
      const fill = c.addChild(new Sprite(fillTex));
      fill.tint = tint; fill.width = rw; fill.height = rh;
      const grad = c.addChild(new Sprite(gradTex));
      grad.width = rw; grad.height = rh;
      const stroke = c.addChild(new Sprite(strokeTex));
      stroke.position.set(-2, -2); stroke.width = rw + 4; stroke.height = rh + 4;
      stroke.alpha = 0.22;
      const label = tb.length ? slotLabel(mult) : "";
      // long labels ("1000x") squeezed exactly like the canvas path
      const fs = Math.max(9, Math.min(16, sw * 0.28) * (label.length > 4 ? 0.8 : 1));
      const t = c.addChild(new Text({
        text: label, style: { fontFamily: "DM Sans", fontSize: fs, fontWeight: "700", fill: 0x06080d },
      }));
      t.alpha = 0.92; // rgba(6,8,13,.92)
      t.anchor.set(0.5); t.position.set(rw / 2, rh / 2 + 1.5);
      slotNodes.push({ c, glow, stroke, i, always, hot: false });
    }
  }

  // ── render: called ONLY by the caller's parked rAF loop ──────────────────
  function render() {
    if (destroyed) return;
    // geom()/table effects hand the world brand-new arrays — identity change
    // is the rebuild signal (the caller marks dirty + re-arms the loop, so a
    // frame is guaranteed to arrive here and pick it up)
    if (world.pegRows !== lastPegRows) rebuildPegs();
    // table identity changes on every drop response even when the values are
    // unchanged — a full slot rebuild (texture bakes + label rasters) mid-
    // animation is the most expensive thing this file can do, so a new
    // identity only counts as a change when the VALUES differ
    let tableDirty = world.table !== lastTable;
    if (tableDirty && Array.isArray(world.table) && Array.isArray(lastTable) &&
        world.table.length === lastTable.length) {
      tableDirty = false;
      for (let i = 0; i < world.table.length; i++) {
        if (world.table[i] !== lastTable[i]) { tableDirty = true; break; }
      }
      if (!tableDirty) lastTable = world.table; // adopt the new identity, no rebuild
    }
    if (world.slots !== lastSlots || tableDirty || world.slotH !== lastSlotH) rebuildSlots();

    const tnow = performance.now() / 1000;

    // pegs: only suns (pulse) and hit pegs mutate; a peg cooling to rest gets
    // one final reset write (n.hot) and then costs nothing
    for (let i = 0; i < pegNodes.length; i++) {
      const n = pegNodes[i], p = n.p;
      if (p.kind === "sun") {
        const pulse = 0.5 + 0.5 * Math.sin(tnow * 1.6 + p.spin);
        n.glow.alpha = 0.18 + 0.18 * pulse + p.hit * 0.5; // blur 3+3·pulse+16·hit → alpha
      }
      if (p.hit > 0) {
        n.hot = true;
        const r = p.r + p.hit * 2.2;
        n.body.scale.set(0.5 * r / BR);
        if (n.glowGold) n.glow.alpha = p.hit;
        if (n.ring) { n.ring.alpha = 0.4 + p.hit * 0.6; n.ring.scale.set(0.5 * r / BR); }
        n.out.visible = true;
        n.out.alpha = p.hit * 0.7;
        n.out.scale.set(0.5 * (r + 5 * p.hit) / OUT_R);
      } else if (n.hot) {
        n.hot = false;
        n.body.scale.set(0.5 * p.r / BR);
        if (n.glowGold) n.glow.alpha = 0;
        if (n.ring) { n.ring.alpha = 0.4; n.ring.scale.set(0.5 * p.r / BR); }
        n.out.visible = false;
      }
    }

    // slots: the kick bounce (y offset + stroke flash + glow) — same decay
    for (let i = 0; i < slotNodes.length; i++) {
      const s = slotNodes[i];
      const kick = world.slotKick[s.i] || 0;
      s.c.y = world.slotY + kick * 7;
      if (kick > 0 || s.hot) {
        s.hot = kick > 0;
        s.stroke.alpha = kick > 0 ? 0.4 + kick * 0.6 : 0.22;
        s.glow.alpha = s.always ? 0.65 : kick;
      }
    }

    // gold orbs (pooled)
    const balls = world.balls;
    const bScale = 0.5 * (world.ballR || 6) / BALL_R;
    let bi = 0;
    for (; bi < balls.length; bi++) {
      const b = balls[bi];
      const s = poolGet(ballPool, bi, mkBall);
      s.visible = true;
      s.scale.set(bScale);
      s.position.set(b.x, b.y);
    }
    hideRest(ballPool, bi);

    // sparks + landing popups (pooled)
    const fx = world.fx;
    let si = 0, pi = 0;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i], k = f.t / f.life;
      if (f.kind === "spark") {
        const s = poolGet(sparkPool, si++, mkSpark);
        s.visible = true;
        s.alpha = 1 - k;
        s.tint = colNum(f.col);
        s.width = s.height = 5.2 * (1 - k * 0.5); // diameter 2·2.6·(1-k/2)
        s.position.set(f.x, f.y);
      } else {
        const t = poolGet(popPool, pi++, mkPop);
        if (t._txt !== f.text) { t._txt = f.text; t.text = f.text; }
        t.visible = true;
        t.alpha = 1 - k;
        t.tint = f.good ? 0x7ef0c0 : 0x8a94a8; // win green / neutral grey
        t.position.set(f.x, f.y - 40 * k);
      }
    }
    hideRest(sparkPool, si);
    hideRest(popPool, pi);

    app.renderer.render(app.stage); // exactly one render; caller's loop drives us
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    // Texts and layer nodes go with the stage; the canvas textures are ours
    // (built without the global cache) — destroy them after the app.
    destroyApp(); // clears the loss watchdog, removes listeners + canvas, destroys the stage
    for (const t of ownTex) t.destroy(true);
    for (const t of slotTexList) t.destroy(true);
  }

  return { kind: "webgl", fit, render, destroy };
}
