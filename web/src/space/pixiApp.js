// Shared PixiJS (WebGL) engine machinery for the cabinet's game surfaces —
// extracted from landerSceneGL.js, the template every GL scene follows.
// Target: Firefox on Fedora 44, identical kiosk fleet, 24/7 uptime, ONE
// graphics mode. Scenes render caller-driven (autoStart:false, no ticker)
// and keep their previous renderer alive as the fallback for init failure
// or permanent context loss.
import { Application, Texture, CanvasSource, CanvasTextMetrics } from "pixi.js";

// one dpr policy for every surface: cap 1.5, clamp backing store ~2.2MP.
// A 4K panel would otherwise clear+paint 6.6MP a frame — and cross the
// size at which the weakest cabinets stop keeping 60fps.
function calcDpr(w, h) {
  let dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const px = w * h * dpr * dpr;
  if (px > 2.2e6) dpr *= Math.sqrt(2.2e6 / px);
  return dpr;
}

// Creates + mounts a Pixi Application with the fleet's init policy and the
// context-loss watchdog. `resolutionScale` multiplies the dpr policy so a
// scene may render at e.g. 0.75x internal resolution and upscale — a real
// WebGL perf lever. Throws when WebGL cannot be created (caller keeps its
// live fallback). Returns { app, fit, destroy }.
export async function createPixiApp({ wrap, onLost, resolutionScale = 1 }) {
  if (!wrap) throw new Error("pixi-app: no wrap element");
  const rect = wrap.getBoundingClientRect();
  const w0 = Math.max(1, rect.width), h0 = Math.max(1, rect.height);

  const app = new Application();
  // preference 'webgl' — NEVER webgpu: one deterministic graphics mode for
  // the whole fleet. Throws when WebGL cannot be created.
  await app.init({
    preference: "webgl",
    autoStart: false,
    sharedTicker: false,
    backgroundAlpha: 0,
    antialias: true,
    resolution: calcDpr(w0, h0) * resolutionScale,
    autoDensity: true,
    width: w0,
    height: h0,
  });

  let destroyed = false;
  wrap.appendChild(app.canvas); // the surface's CSS overlays it like its 2D one

  // ── runtime WebGL context loss (the 24/7 kiosk failure mode) ─────────────
  // pixi preventDefault()s 'webglcontextlost' but only restores contexts it
  // force-lost itself; after a spontaneous driver reset, recovery depends on
  // the browser volunteering 'webglcontextrestored'. Give it a grace window —
  // if the event never comes the context is dead for good, and onLost hands
  // rendering back to the caller's live fallback instead of freezing on the
  // last presented frame.
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

  function fit() {
    if (destroyed) return;
    const r = wrap.getBoundingClientRect();
    const fw = Math.max(1, r.width), fh = Math.max(1, r.height);
    app.renderer.resize(fw, fh, calcDpr(fw, fh) * resolutionScale);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(lostTimer);
    app.canvas.removeEventListener("webglcontextlost", handleLost);
    app.canvas.removeEventListener("webglcontextrestored", handleRestored);
    app.destroy(true, { children: true }); // removes the canvas from `wrap`
  }

  return { app, fit, destroy };
}

// cache-free texture from a pre-baked canvas: built without the global
// texture cache so a scene owns (and must destroy) what it creates.
export const textureFromCanvas = (canvas) =>
  new Texture({ source: new CanvasSource({ resource: canvas }) });

// small 2x-baked helper canvas (same style as the surfaces' sprite factories)
export function bake(w, h, drawFn) {
  const c = document.createElement("canvas");
  c.width = w * 2; c.height = h * 2;
  const g = c.getContext("2d");
  g.scale(2, 2);
  drawFn(g, w, h);
  return c;
}

// anchor a Text so position.y is the alphabetic BASELINE (canvas fillText
// semantics) and position.x the center (textAlign 'center'). Call again
// after any change to the text string or font size.
export function baselineText(t) {
  const m = CanvasTextMetrics.measureText(t.text || "0", t.style);
  t.anchor.set(0.5, m.height > 0 ? m.fontProperties.ascent / m.height : 0.8);
}

// registry of each surface's ACTIVE renderer ("webgl" | "canvas2d"), read
// by the fps HUD. __lnRenderer is mirrored for the lander's legacy readers.
export function setRenderer(tag, kind) {
  window.__renderers = { ...(window.__renderers || {}), [tag]: kind };
  if (tag === "lander") window.__lnRenderer = kind;
}
