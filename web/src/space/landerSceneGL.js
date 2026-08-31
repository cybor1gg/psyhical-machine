// STAR LANDER — PixiJS (WebGL) scene renderer. A scene-graph port of the
// Canvas2D draw() in LanderSpace.jsx, visually identical, driven by the
// SAME refs each frame. This module renders ONLY — physics, economy and
// DOM UI stay in LanderSpace. If WebGL is unavailable createLanderScene()
// throws and the caller keeps the Canvas2D path.
//
// Performance contract (cabinet fleet, Firefox on Fedora 44):
//   • no per-frame allocations in render(): every trail/fx/pop visual is
//     pooled (geometric growth), culling is .visible, never add/remove
//   • Text re-rasterises only when its string or font size changes; color
//     swaps go through .tint (free) over a white fill
//   • Graphics is used ONLY for the 3 void wave lines (cleared + rebuilt);
//     everything else is textured sprites baked once
//   • one render per rAF, no internal ticker — the caller's loop (and its
//     idle frame-skipping) stays in charge
import {
  Application, Container, Sprite, Graphics, Text, Texture,
  CanvasSource, CanvasTextMetrics, Assets,
} from "pixi.js";

// same dpr policy as LanderSpace.fit(): cap 1.5, clamp backing store ~2.2MP
function calcDpr(w, h) {
  let dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const px = w * h * dpr * dpr;
  if (px > 2.2e6) dpr *= Math.sqrt(2.2e6 / px);
  return dpr;
}

const texFromCanvas = (c) => new Texture({ source: new CanvasSource({ resource: c }) });

// small 2x-baked helper canvases (same style as makeSprites)
function bake(w, h, drawFn) {
  const c = document.createElement("canvas");
  c.width = w * 2; c.height = h * 2;
  const g = c.getContext("2d");
  g.scale(2, 2);
  drawFn(g, w, h);
  return c;
}

const WAVE_COL = 0x965adc;            // rgba(150,90,220)
const WAVE_A = [0.16, 0.115, 0.07];
const WAVE_W = [7, 5, 3];
const RING_R = 84;                    // baked ring radius (midlife of 8..168)
const RING_CS = RING_R * 2 + 10;      // canvas CSS size (radius + stroke pad)

// hex string -> number, memoised (fx colors are a tiny fixed set)
const colCache = new Map();
function colNum(col) {
  let v = colCache.get(col);
  if (v === undefined) { v = parseInt(col.slice(1), 16); colCache.set(col, v); }
  return v;
}

// anchor a Text so position.y is the alphabetic BASELINE (canvas fillText
// semantics) and position.x the center (textAlign 'center')
function baselineAnchor(t) {
  const m = CanvasTextMetrics.measureText(t.text || "0", t.style);
  t.anchor.set(0.5, m.height > 0 ? m.fontProperties.ascent / m.height : 0.8);
}

export async function createLanderScene({ wrap, sprites, phys, gemColor, fmtMoney, onLost }) {
  if (!wrap) throw new Error("lander-gl: no wrap element");
  const rect = wrap.getBoundingClientRect();
  const w0 = Math.max(1, rect.width), h0 = Math.max(1, rect.height);

  const app = new Application();
  // preference 'webgl' — NEVER webgpu: one deterministic graphics mode for
  // the whole fleet. Throws when WebGL cannot be created (caller falls back).
  await app.init({
    preference: "webgl",
    autoStart: false,
    sharedTicker: false,
    backgroundAlpha: 0,
    antialias: true,
    resolution: calcDpr(w0, h0),
    autoDensity: true,
    width: w0,
    height: h0,
  });

  let destroyed = false;
  wrap.appendChild(app.canvas); // .ln-scene canvas CSS overlays it like the 2D one

  // ── runtime WebGL context loss (the 24/7 kiosk failure mode) ─────────────
  // pixi preventDefault()s 'webglcontextlost' but only restores contexts it
  // force-lost itself; after a spontaneous driver reset, recovery depends on
  // the browser volunteering 'webglcontextrestored'. Give it a grace window —
  // if the event never comes the context is dead for good, and onLost hands
  // rendering back to the caller's Canvas2D fallback instead of freezing on
  // the last presented frame.
  let lostTimer = 0;
  const handleLost = () => {
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => {
      if (!destroyed && onLost) onLost();
    }, 3000);
  };
  const handleRestored = () => clearTimeout(lostTimer);
  app.canvas.addEventListener("webglcontextlost", handleLost);
  app.canvas.addEventListener("webglcontextrestored", handleRestored);

  // ── textures ─────────────────────────────────────────────────────────────
  const ownTex = [];
  const own = (t) => { ownTex.push(t); return t; };
  const gemTex = {};
  for (const t of Object.keys(sprites.gem)) gemTex[t] = own(texFromCanvas(sprites.gem[t]));
  const mineTex = own(texFromCanvas(sprites.mine));
  const padTex = own(texFromCanvas(sprites.pad));
  const haloTex = own(texFromCanvas(sprites.halo));
  const nebTex = sprites.neb.map((c) => own(texFromCanvas(c)));
  const coinTex = own(texFromCanvas(sprites.coin));
  const puffTex = own(texFromCanvas(sprites.puff));

  // white dot (pad blink lights + fx sparks, tinted per use)
  const dotTex = own(texFromCanvas(bake(16, 16, (g, w, h) => {
    g.fillStyle = "#ffffff";
    g.beginPath(); g.arc(w / 2, h / 2, 7.2, 0, 7); g.fill();
  })));
  // mine-hit ring: baked once at its midlife radius and SCALED per frame
  // (never redrawn) — the stroke width breathes a little with the scale
  const ringTex = own(texFromCanvas(bake(RING_CS, RING_CS, (g, w, h) => {
    g.strokeStyle = "#ff9c86"; g.lineWidth = 3;
    g.beginPath(); g.arc(w / 2, h / 2, RING_R, 0, 7); g.stroke();
  })));
  // the void band's 3-stop vertical gradient, baked to a strip and stretched
  const voidTex = own(texFromCanvas((() => {
    const c = document.createElement("canvas");
    c.width = 4; c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "rgba(32,14,64,0)");
    grad.addColorStop(0.25, "rgba(32,14,64,.55)");
    grad.addColorStop(1, "rgba(6,2,14,.96)");
    g.fillStyle = grad; g.fillRect(0, 0, 4, 128);
    return c;
  })()));

  // ── scene graph, back to front (mirrors draw() order) ────────────────────
  const stage = app.stage;

  // 8 nebulae — same deterministic config formulas as LanderSpace's nebRef
  const nebCfg = Array.from({ length: 8 }, (_, i) => ({
    x: (i * 953) % 5000, yf: 0.08 + ((i * 37) % 60) / 100, r: 60 + ((i * 91) % 150), v: i % 2,
  }));
  const nebC = stage.addChild(new Container());
  const nebSpr = nebCfg.map((n) => {
    const s = nebC.addChild(new Sprite(nebTex[n.v]));
    s.anchor.set(0.5); s.alpha = 0.8; s.width = s.height = n.r * 2;
    return s;
  });

  const voidSpr = stage.addChild(new Sprite(voidTex));
  const waveG = stage.addChild(new Graphics());

  const worldC = stage.addChild(new Container()); // everything gated on `sim`
  worldC.visible = false;

  const mkText = (fill, weight) => new Text({
    text: "", style: { fontFamily: "DM Sans", fontSize: 12, fontWeight: weight, fill },
  });

  const makePad = (label, withHalo) => {
    const c = worldC.addChild(new Container());
    const halo = withHalo ? c.addChild(new Sprite(haloTex)) : null;
    const pad = c.addChild(new Sprite(padTex));
    const lights = Array.from({ length: 5 }, () => {
      const s = c.addChild(new Sprite(dotTex));
      s.anchor.set(0.5);
      return s;
    });
    const text = c.addChild(mkText("#5d6a80", "400"));
    text.text = label;
    return { c, halo, pad, lights, text };
  };
  const padLaunch = makePad("LAUNCH", false);
  const padDock = makePad("DOCK", true);

  const evC = worldC.addChild(new Container());   // rebuilt per map
  const trailC = worldC.addChild(new Container());
  const shipSpr = worldC.addChild(new Sprite(Texture.EMPTY));
  shipSpr.anchor.set(0.55, 0.5);                  // canvas offsets -sw*0.55/-sh*0.5
  shipSpr.visible = false;
  const moneyT = worldC.addChild(mkText(0xffffff, "700")); // tinted per pop state
  const multT = worldC.addChild(mkText("#9fe8c8", "700"));
  moneyT.visible = multT.visible = false;

  const fxC = stage.addChild(new Container());    // particles above everything
  const sparkC = fxC.addChild(new Container());
  const coinC = fxC.addChild(new Container());
  const ringC = fxC.addChild(new Container());
  const popC = fxC.addChild(new Container());

  // ── pools (preallocated, geometric growth, cull by .visible) ─────────────
  function poolGet(pool, i, create) {
    if (i >= pool.length) {
      const target = Math.max(i + 1, pool.length ? pool.length * 2 : 8);
      while (pool.length < target) { const o = create(); o.visible = false; pool.push(o); }
    }
    return pool[i];
  }
  const hideRest = (pool, from) => { for (let j = from; j < pool.length; j++) pool[j].visible = false; };
  const mkPuff = () => { const s = trailC.addChild(new Sprite(puffTex)); s.anchor.set(0.5); return s; };
  const mkSpark = () => { const s = sparkC.addChild(new Sprite(dotTex)); s.anchor.set(0.5); s.width = s.height = 4.8; return s; };
  const mkCoin = () => { const s = coinC.addChild(new Sprite(coinTex)); s.anchor.set(0.5); s.width = s.height = 18; return s; };
  const mkRing = () => { const s = ringC.addChild(new Sprite(ringTex)); s.anchor.set(0.5); return s; };
  const mkPop = () => {
    const t = popC.addChild(new Text({
      text: "", style: { fontFamily: "DM Sans", fontSize: 20, fontWeight: "700", fill: 0xffffff },
    }));
    t._txt = ""; return t;
  };
  const trailPool = []; for (let i = 0; i < 32; i++) trailPool.push(mkPuff());
  const sparkPool = []; for (let i = 0; i < 48; i++) sparkPool.push(mkSpark());
  const coinPool = []; for (let i = 0; i < 16; i++) coinPool.push(mkCoin());
  const ringPool = []; for (let i = 0; i < 4; i++) ringPool.push(mkRing());
  const popPool = []; for (let i = 0; i < 8; i++) popPool.push(mkPop());
  trailPool.forEach((s) => (s.visible = false));
  sparkPool.forEach((s) => (s.visible = false));
  coinPool.forEach((s) => (s.visible = false));
  ringPool.forEach((s) => (s.visible = false));
  popPool.forEach((s) => (s.visible = false));

  // ── the ship sprite (async; hidden until the texture is real) ────────────
  let shipTex = null;
  Assets.load("/space/gems/shuttle.png").then((tex) => {
    if (destroyed || !tex || tex.destroyed) return;
    shipTex = tex;
    shipSpr.texture = tex;
    sizeShip();
  }).catch(() => { /* ship stays hidden — same as canvas before img.complete */ });

  // ── scale-dependent layout (fit-time only, never per frame) ──────────────
  let evNodes = [];
  let curSim = null;
  let lastScale = 0;
  function sizeShip() {
    if (!shipTex) return;
    const sw = 96 * lastScale;
    shipSpr.width = sw;
    shipSpr.height = sw * (shipTex.height / shipTex.width);
  }
  function layoutPad(p, scale) {
    const padW = 200 * scale;
    const padY = phys.PAD_Y * scale;
    if (p.halo) {
      p.halo.position.set(-120 * scale, padY - 42 * scale);
      p.halo.width = 240 * scale; p.halo.height = 90 * scale;
    }
    p.pad.position.set(-padW / 2, padY - 8 * scale);
    p.pad.width = padW; p.pad.height = 60 * scale;
    for (let b = 0; b < 5; b++) {
      p.lights[b].position.set(-padW / 2 + (b + 0.5) * (padW / 5), padY - 3 * scale);
      p.lights[b].width = p.lights[b].height = 4.8 * scale;
    }
    p.text.style.fontSize = Math.max(9, 11 * scale);
    p.text.position.set(0, padY + 24 * scale);
    baselineAnchor(p.text);
  }
  function applyScale(scale) {
    lastScale = scale;
    layoutPad(padLaunch, scale);
    layoutPad(padDock, scale);
    sizeShip();
    moneyT.style.fontSize = 26 * Math.max(0.8, scale);
    baselineAnchor(moneyT);
    multT.style.fontSize = Math.max(11, 14 * scale);
    baselineAnchor(multT);
    for (const n of evNodes) {
      if (n.kind === "pick") {
        n.spr.width = n.spr.height = 62 * scale;
        n.label.style.fontSize = Math.max(10, 13 * scale);
        n.label.position.set(0, 30 * scale);
        baselineAnchor(n.label);
      } else {
        n.spr.width = n.spr.height = 74 * scale;
      }
    }
  }
  applyScale(h0 / phys.H);

  // ── per-map event layer ──────────────────────────────────────────────────
  function setMap(sim) {
    if (destroyed) return;
    for (const n of evNodes) n.c.destroy({ children: true }); // shared textures kept
    evC.removeChildren();
    evNodes = [];
    curSim = sim || null;
    if (!sim) { worldC.visible = false; return; }
    for (let i = 0; i < sim.map.ev.length; i++) {
      const e = sim.map.ev[i];
      const c = evC.addChild(new Container());
      c.visible = false;
      if (e.kind === "pick") {
        const spr = c.addChild(new Sprite(gemTex[e.t]));
        spr.anchor.set(0.5);
        const label = c.addChild(mkText(gemColor[e.t], "700"));
        label.text = e.t.replace("x", "×");
        evNodes.push({ c, spr, label, e, kind: "pick" });
      } else {
        const spr = c.addChild(new Sprite(mineTex));
        spr.anchor.set(0.5);
        evNodes.push({ c, spr, label: null, e, kind: "mine" });
      }
    }
    applyScale(lastScale); // sizes + label fonts for the fresh nodes
  }

  // ── per-frame state caches (Text re-rasterises only on change) ───────────
  let lastMoneyVal = NaN, lastMult = NaN;

  function render(fr) {
    if (destroyed) return;
    const sim = fr.sim || null;
    const T = fr.time;
    const w = app.screen.width, h = app.screen.height;
    const scale = h / phys.H;
    if (scale !== lastScale) applyScale(scale);
    // defensive: a round can start before the async init resolved and the
    // caller's setMap call was skipped — sync the event layer off the frame
    if (sim !== curSim) setMap(sim);

    const wx = sim ? sim.S.wx : 0;
    const shipX = w * 0.3;
    const off = shipX - wx * scale;

    // nebulae, 0.45x parallax — verbatim modulo math from draw()
    for (let i = 0; i < nebCfg.length; i++) {
      const n = nebCfg[i];
      const sxp = shipX + (n.x - wx * 0.45 * scale) % (w + 600) - 300;
      const x = ((sxp % (w + 600)) + (w + 600)) % (w + 600) - 300;
      nebSpr[i].position.set(x, n.yf * h);
    }

    // void band + 3 sine wave lines
    const vy = phys.VOID_Y * scale;
    voidSpr.position.set(0, vy - 30 * scale);
    voidSpr.width = w;
    voidSpr.height = h - vy + 30 * scale;
    waveG.clear();
    for (let i = 0; i < 3; i++) {
      for (let x = 0; x <= w; x += 26) {
        const yy = vy + (10 + i * 14) * scale + Math.sin(x * 0.014 + T * (1.1 + i * 0.4) + i * 2 - wx * 0.004) * 7 * scale;
        if (x === 0) waveG.moveTo(x, yy); else waveG.lineTo(x, yy);
      }
      waveG.stroke({ width: WAVE_W[i] * scale, color: WAVE_COL, alpha: WAVE_A[i] });
    }

    worldC.visible = !!sim;
    if (sim) {
      const map = sim.map;
      const padW = 200 * scale;
      const placePad = (p, worldX) => {
        const x = worldX * scale + off;
        if (x < -padW || x > w + padW) { p.c.visible = false; return; }
        p.c.visible = true;
        p.c.x = x;
        if (p.halo) p.halo.alpha = 0.75 + Math.sin(T * 2.4) * 0.25;
        for (let b = 0; b < 5; b++) {
          p.lights[b].tint = Math.floor(T * 3 + b) % 2 === 0 ? 0xf0d99a : 0x6b5a2e;
        }
      };
      placePad(padLaunch, 60);
      placePad(padDock, map.len);

      // events (bob + spin), culled at the same ±60px margin
      for (let i = 0; i < evNodes.length; i++) {
        const n = evNodes[i];
        if (sim.done[i]) { n.c.visible = false; continue; }
        const e = n.e;
        const x = e.x * scale + off;
        if (x < -60 || x > w + 60) { n.c.visible = false; continue; }
        n.c.visible = true;
        const bob = Math.sin(T * 2 + e.x * 0.01) * 5 * scale;
        n.c.position.set(x, e.yf * phys.H * scale + bob);
        n.spr.rotation = n.kind === "pick" ? Math.sin(T * 1.6 + e.x) * 0.12 : T * 0.45;
      }

      // engine trail
      const trail = fr.trail;
      for (let i = 0; i < trail.length; i++) {
        const p = trail[i];
        const s = poolGet(trailPool, i, mkPuff);
        const r = p.r * (1 + p.t * 2.4) * scale;
        s.visible = true;
        s.alpha = (1 - p.t / p.life) * 0.8;
        s.position.set(p.x, p.y);
        s.width = s.height = r * 2;
      }
      hideRest(trailPool, trail.length);

      // the ship
      if (shipTex) {
        shipSpr.visible = true;
        shipSpr.position.set(shipX, sim.S.y * scale);
        shipSpr.rotation = fr.ang;
      } else {
        shipSpr.visible = false;
      }

      // money above the ship — pop drives .scale, not font size
      const showMoney = fr.phase === "flying" || fr.phase === "landed";
      moneyT.visible = multT.visible = showMoney;
      if (showMoney) {
        const val = Math.round(fr.bet * sim.S.counter * 100) / 100;
        if (val !== lastMoneyVal) {
          lastMoneyVal = val;
          moneyT.text = fmtMoney(val);
          baselineAnchor(moneyT);
        }
        const popS = (26 + fr.pop * 8) / 26;
        moneyT.scale.set(popS);
        moneyT.tint = fr.pop > 0.4 ? 0xfdf3d0 : 0xf0d99a;
        moneyT.position.set(shipX, sim.S.y * scale - 46 * scale);
        if (sim.S.counter !== lastMult) {
          lastMult = sim.S.counter;
          multT.text = "×" + sim.S.counter.toFixed(2);
          baselineAnchor(multT);
        }
        multT.position.set(shipX, sim.S.y * scale - 28 * scale);
      }
    } else {
      hideRest(trailPool, 0);
    }

    // fx above everything
    const fx = fr.fx;
    let si = 0, ci = 0, ri = 0, pi = 0;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i];
      const a = 1 - f.t / f.life;
      if (f.kind === "spark") {
        const s = poolGet(sparkPool, si++, mkSpark);
        s.visible = true; s.alpha = a; s.tint = colNum(f.col);
        s.position.set(f.x, f.y);
      } else if (f.kind === "coin") {
        const s = poolGet(coinPool, ci++, mkCoin);
        s.visible = true; s.alpha = Math.min(1, a * 2);
        s.position.set(f.x, f.y);
      } else if (f.kind === "ring") {
        const s = poolGet(ringPool, ri++, mkRing);
        const r = 8 + f.t * 160;
        s.visible = true; s.alpha = a;
        s.width = s.height = RING_CS * (r / RING_R);
        s.position.set(f.x, f.y);
      } else if (f.kind === "pop") {
        const t = poolGet(popPool, pi++, mkPop);
        if (t._txt !== f.text) { t._txt = f.text; t.text = f.text; baselineAnchor(t); }
        t.visible = true; t.alpha = Math.min(1, a * 1.6); t.tint = colNum(f.col);
        t.position.set(f.x, f.y - f.t * 34);
      }
    }
    hideRest(sparkPool, si);
    hideRest(coinPool, ci);
    hideRest(ringPool, ri);
    hideRest(popPool, pi);

    app.renderer.render(app.stage); // exactly one render; caller's rAF drives us
  }

  function fit() {
    if (destroyed) return;
    const r = wrap.getBoundingClientRect();
    const fw = Math.max(1, r.width), fh = Math.max(1, r.height);
    app.renderer.resize(fw, fh, calcDpr(fw, fh));
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(lostTimer);
    app.canvas.removeEventListener("webglcontextlost", handleLost);
    app.canvas.removeEventListener("webglcontextrestored", handleRestored);
    // Texts and event nodes go with the stage; shared canvas textures are
    // ours (built without the global cache), destroy them explicitly. The
    // shuttle texture lives in the Assets cache and is left alone so a
    // remount (React StrictMode) gets a live texture back.
    shipSpr.texture = Texture.EMPTY;
    app.destroy(true, { children: true });
    for (const t of ownTex) t.destroy(true);
  }

  return { kind: "webgl", fit, setMap, render, destroy };
}
