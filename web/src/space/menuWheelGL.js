// THE LOBBY WHEEL — PixiJS (WebGL) port of MenuPage's card carousel pixels.
// A scene-graph twin of the 14 [data-mt-i] DOM cards, driven every tick by
// the SAME wheel math in MenuPage (m.pos/vel/tween stay the authority there).
// This module renders ONLY — physics, taps, selection and every other DOM
// element stay in MenuPage. If WebGL is unavailable createMenuWheel() throws
// and the caller keeps the DOM style-writing path.
//
// Performance contract (cabinet fleet, Firefox on Fedora 44):
//   • everything is baked canvases → textures: rounded card base, diagonal
//     stripe overlay, two border/glow frames (gold ON vs #222b3a OFF) that
//     crossfade, and per-card cover jpgs re-baked with rounded corners
//     (cover-fit crop at bake time — no per-frame masks, no Graphics)
//   • zero per-frame allocations: setCard() writes sprite fields only
//   • caller-driven rendering: render() presents exactly one frame and
//     returns whether a crossfade / cover fade-in still needs frames, so
//     MenuPage's parked-loop throttle keeps working (parked ⇒ no render)
//   • .visible culling, zIndex sorting via sortableChildren (set once)
import { Container, Sprite, Assets } from "pixi.js";
import { createPixiApp, textureFromCanvas, bake } from "./pixiApp";

const ACCENT = "#d9b26a";
const RADIUS = 24;       // card border-radius (CSS: borderRadius 24)
const PAD = 72;          // frame texture padding: fits 0 22px 48px + 34px glow
const tint = (a) => `rgba(217, 178, 106, ${a})`;

// CSS sizing replicated: wrapper width min(366px, 33vw); button aspect 33/42
// capped at maxHeight 60vh (the aspect gives, the width stays — objectFit
// cover absorbs it, and our bakeCover does the same crop).
function calcCard() {
  const vw = window.innerWidth || 1, vh = window.innerHeight || 1;
  const w = Math.min(366, vw * 0.33);
  const h = Math.min(w * 42 / 33, vh * 0.6);
  return { w, h };
}

const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };

// dark rounded base: linear-gradient(180deg, #10141d 0%, #0a0d14 100%)
function bakeBase(w, h) {
  return bake(w, h, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#10141d");
    grad.addColorStop(1, "#0a0d14");
    g.fillStyle = grad;
    rr(g, 0, 0, w, h, RADIUS); g.fill();
  });
}

// repeating-linear-gradient(135deg, rgba(255,255,255,.04) 0 2px,
// transparent 2px 18px) — thin diagonal hairlines every 18px along the axis
function bakeStripe(w, h) {
  return bake(w, h, (g) => {
    rr(g, 0, 0, w, h, RADIUS); g.clip();
    g.strokeStyle = "rgba(255,255,255,.04)";
    g.lineWidth = 2;
    const step = 18 * Math.SQRT2; // 18px period measured along the 135° axis
    for (let c = step / 2; c < w + h; c += step) {
      g.beginPath();
      g.moveTo(c + 4, -4);
      g.lineTo(-4, c + 4);
      g.stroke();
    }
  });
}

// border + shadow/glow frame, padded so the halo lives outside the card.
// ON  = gold border, 0 22px 48px rgba(0,0,0,.62) + 0 0 34px gold glow +
//       inset 0 0 0 1px gold ring (the centred card's boxShadow/borderColor)
// OFF = #222b3a border, 0 12px 26px rgba(0,0,0,.5)
function bakeFrame(w, h, on) {
  return bake(w + PAD * 2, h + PAD * 2, (g) => {
    const x = PAD, y = PAD;
    const shadows = on
      ? [{ oy: 22, blur: 48, col: "rgba(0,0,0,.62)" }, { oy: 0, blur: 34, col: tint(0.22) }]
      : [{ oy: 12, blur: 26, col: "rgba(0,0,0,.5)" }];
    for (const s of shadows) {
      g.save();
      g.shadowOffsetY = s.oy; g.shadowBlur = s.blur; g.shadowColor = s.col;
      g.fillStyle = "#000";
      rr(g, x, y, w, h, RADIUS); g.fill();
      g.restore();
    }
    // punch the interior back out — only the halo outside the card remains
    // (the opaque card base + cover render underneath this frame sprite)
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = "#000";
    rr(g, x, y, w, h, RADIUS); g.fill();
    g.restore();
    // 2px border drawn inside the border box, like CSS
    g.strokeStyle = on ? ACCENT : "#222b3a";
    g.lineWidth = 2;
    rr(g, x + 1, y + 1, w - 2, h - 2, RADIUS - 1); g.stroke();
    if (on) { // inset 0 0 0 1px ring hugging the border from inside
      g.strokeStyle = tint(0.35);
      g.lineWidth = 1;
      rr(g, x + 2.5, y + 2.5, w - 5, h - 5, RADIUS - 2.5); g.stroke();
    }
  });
}

// the cover jpg (520x650 source) cropped cover-fit into the rounded card —
// corners are baked in, so no runtime mask is ever needed
function bakeCover(w, h, img) {
  return bake(w, h, (g) => {
    rr(g, 0, 0, w, h, RADIUS); g.clip();
    const sw = img.width || 520, sh = img.height || 650;
    const s = Math.max(w / sw, h / sh);
    g.drawImage(img, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
  });
}

export async function createMenuWheel({ wrap, games, onWake, onLost }) {
  // shared engine util: webgl-only, autoStart:false, dpr cap + 2.2MP clamp,
  // context-loss watchdog (3s grace → onLost). Throws when WebGL is out.
  const { app, fit: fitApp, destroy: destroyApp } = await createPixiApp({ wrap, onLost });

  // the port keeps all its DOM children (fallback cards, edge-fade overlays
  // at zIndex 300): slot the GL canvas above the hidden cards, under the fades
  app.canvas.style.position = "absolute";
  app.canvas.style.left = "0";
  app.canvas.style.top = "0";
  app.canvas.style.zIndex = "250";

  let destroyed = false;
  let { w: cw, h: ch } = calcCard();

  // ── size-dependent shared textures (rebaked only when the card size moves) ─
  let baseTex, stripeTex, frameOffTex, frameOnTex;
  const bakeShared = () => {
    const old = [baseTex, stripeTex, frameOffTex, frameOnTex];
    baseTex = textureFromCanvas(bakeBase(cw, ch));
    stripeTex = textureFromCanvas(bakeStripe(cw, ch));
    frameOffTex = textureFromCanvas(bakeFrame(cw, ch, false));
    frameOnTex = textureFromCanvas(bakeFrame(cw, ch, true));
    return old; // caller destroys AFTER sprites moved to the new ones
  };
  bakeShared();

  // ── the 14 cards, children stacked like the DOM (base, stripe, jpg, frame) ─
  const cardsC = app.stage.addChild(new Container());
  cardsC.sortableChildren = true; // zIndex works, set once

  const cards = games.map(() => {
    const c = cardsC.addChild(new Container());
    c.visible = false;
    const base = c.addChild(new Sprite(baseTex));
    const stripe = c.addChild(new Sprite(stripeTex));
    const cover = c.addChild(new Sprite());   // texture arrives async
    cover.visible = false;
    const frameOff = c.addChild(new Sprite(frameOffTex));
    const frameOn = c.addChild(new Sprite(frameOnTex));
    frameOn.alpha = 0;
    for (const s of [base, stripe, cover, frameOff, frameOn]) s.anchor.set(0.5);
    return { c, base, stripe, cover, frameOff, frameOn, on: false, mix: 0, coverK: 0, coverTex: null, img: null };
  });

  function applySizes() {
    const fw = cw + PAD * 2, fh = ch + PAD * 2;
    for (const cd of cards) {
      cd.base.width = cd.stripe.width = cw;
      cd.base.height = cd.stripe.height = ch;
      cd.frameOff.width = cd.frameOn.width = fw;
      cd.frameOff.height = cd.frameOn.height = fh;
      if (cd.coverTex) { cd.cover.width = cw; cd.cover.height = ch; }
    }
  }
  applySizes();

  function setCover(i) {
    const cd = cards[i];
    const old = cd.coverTex;
    cd.coverTex = textureFromCanvas(bakeCover(cw, ch, cd.img));
    cd.cover.texture = cd.coverTex;
    cd.cover.width = cw; cd.cover.height = ch;
    cd.cover.visible = true;
    if (old) old.destroy(true);
  }

  // covers load async — base + stripe show immediately, jpg fades in on load.
  // The Assets-cache texture itself is never attached to a sprite (we bake a
  // rounded copy), so there is nothing to detach on destroy and the cache
  // entry survives StrictMode remounts.
  for (let i = 0; i < games.length; i++) {
    Assets.load(`/space/games/${games[i].id}.jpg`).then((tex) => {
      if (destroyed || !tex) return;
      const img = tex.source && tex.source.resource;
      if (!img || !img.width) return;
      cards[i].img = img; // kept for re-bakes on resize
      setCover(i);
      if (onWake) onWake(); // un-park the wheel loop so the fade-in renders
    }).catch(() => { /* stripe placeholder stays — same as a broken <img> */ });
  }

  // ── per-tick card write: IDENTICAL math computed by the caller ───────────
  // (dx, dy) are offsets from the port centre — the DOM's
  // translate(-50%,-50%) translateX(d·st) translateY(-14·e2) — sc/alpha/z
  // are the same scale/opacity/zIndex values the style writes used.
  function setCard(i, vis, dx, dy, sc, alpha, z, on) {
    const cd = cards[i];
    cd.c.visible = vis;
    cd.on = on;
    if (!vis) return;
    cd.c.position.set(app.screen.width / 2 + dx, app.screen.height / 2 + dy);
    cd.c.scale.set(sc);
    cd.c.alpha = alpha;
    cd.c.zIndex = z;
  }

  // one frame; returns true while a crossfade / cover fade still animates so
  // the caller keeps ticking at 60fps until the last frame is presented
  let lastT = performance.now();
  function render() {
    if (destroyed) return false;
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    let busy = false;
    for (let i = 0; i < cards.length; i++) {
      const cd = cards[i];
      const target = cd.on ? 1 : 0;
      if (cd.mix !== target) {
        cd.mix += (target - cd.mix) * Math.min(1, dt * 14);
        if (Math.abs(cd.mix - target) < 0.02) cd.mix = target; else busy = true;
        cd.frameOn.alpha = cd.mix;
        cd.frameOff.alpha = 1 - cd.mix;
      }
      if (cd.coverTex && cd.coverK < 1) {
        cd.coverK = Math.min(1, cd.coverK + dt * 4);
        cd.cover.alpha = cd.coverK;
        if (cd.coverK < 1) busy = true;
      }
      // Alpha-compositing parity with the DOM's flattened group opacity:
      // Pixi multiplies container alpha down to EACH child and blends them
      // separately, so on a faded side card the opaque dark base+stripe
      // would add their own layers and kill the cover-flow ghost-through
      // of the neighbouring card's artwork. Once the cover has fully faded
      // in it is opaque and spans the whole rounded rect — base+stripe are
      // invisible in the DOM's flattened card, so drop them here too.
      const covered = cd.coverTex && cd.coverK >= 1;
      if (cd.base.visible === covered) {
        cd.base.visible = cd.stripe.visible = !covered;
      }
    }
    app.renderer.render(app.stage);
    return busy;
  }

  // caller's hit-testing needs the card box the sprites actually use
  const cardSize = () => ({ w: cw, h: ch });

  function fit() {
    if (destroyed) return;
    fitApp();
    const s = calcCard();
    if (s.w !== cw || s.h !== ch) { // fit-time only, never per frame
      cw = s.w; ch = s.h;
      const old = bakeShared();
      for (const cd of cards) {
        cd.base.texture = baseTex;
        cd.stripe.texture = stripeTex;
        cd.frameOff.texture = frameOffTex;
        cd.frameOn.texture = frameOnTex;
      }
      applySizes();
      for (let i = 0; i < cards.length; i++) if (cards[i].img) setCover(i);
      for (const t of old) if (t) t.destroy(true);
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    destroyApp(); // watchdog cleared, canvas removed, stage destroyed
    for (const t of [baseTex, stripeTex, frameOffTex, frameOnTex]) if (t) t.destroy(true);
    for (const cd of cards) if (cd.coverTex) cd.coverTex.destroy(true);
  }

  return { kind: "webgl", fit, setCard, render, cardSize, destroy };
}
