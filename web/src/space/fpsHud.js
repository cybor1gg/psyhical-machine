// The cabinet's pocket dyno. Five taps in the top-left corner (within 2s)
// toggle a tiny frame-rate readout — median fps, p95 frame time, running
// CSS animations — so anyone standing at a machine can judge rendering
// health in ten seconds, no dev tools. Plain DOM on purpose: it must not
// touch React, and its own cost must be ~zero (one rAF, one text write
// every half second, no layout reads).
let hud = null;
let raf = 0;

function start() {
  hud = document.createElement("div");
  hud.style.cssText =
    "position:fixed;left:8px;top:8px;z-index:99999;padding:6px 10px;" +
    "border-radius:8px;background:rgba(0,0,0,.72);color:#7ef0c0;" +
    "font:700 12px/1.5 monospace;pointer-events:none;white-space:pre";
  document.body.appendChild(hud);

  const deltas = [];
  let last = 0, lastText = 0;
  const tick = (t) => {
    raf = requestAnimationFrame(tick);
    if (last) {
      deltas.push(t - last);
      if (deltas.length > 120) deltas.shift();
    }
    last = t;
    if (t - lastText < 500 || deltas.length < 30) return;
    lastText = t;
    const s = [...deltas].sort((a, b) => a - b);
    const med = s[s.length >> 1];
    const p95 = s[Math.floor(s.length * 0.95)];
    // __renderers is stamped by each Pixi scene (pixiApp setRenderer):
    // e.g. "sky:webgl lobby:webgl bonanza:dom" — dom/canvas2d = fallback active
    const R = window.__renderers || {};
    const rend = Object.keys(R).map((k) => `${k}:${R[k]}`).join(" ");
    const errs = (window.__errLog || []).length;
    hud.textContent =
      `${(1000 / med).toFixed(0)} fps  med ${med.toFixed(1)}ms  p95 ${p95.toFixed(1)}ms\n` +
      `anims ${document.getAnimations().length}  dpr ${(window.devicePixelRatio || 1).toFixed(2)}` +
      (errs ? `  errs ${errs}` : "") +
      (rend ? `\n${rend}` : "");
  };
  raf = requestAnimationFrame(tick);
}

function stop() {
  cancelAnimationFrame(raf);
  if (hud) hud.remove();
  hud = null;
}

export function initFpsHud() {
  // rolling error log — surfaced as a count in the readout, inspectable as
  // window.__errLog. On a kiosk with no dev tools this is the only witness.
  window.__errLog = [];
  const logErr = (m) => { if (window.__errLog.length < 20) window.__errLog.push(String(m).slice(0, 200)); };
  window.addEventListener("error", (e) => logErr(e.message));
  window.addEventListener("unhandledrejection", (e) => logErr((e.reason && e.reason.message) || e.reason));

  let taps = 0, first = 0;
  document.addEventListener("pointerdown", (e) => {
    if (e.clientX > 80 || e.clientY > 80) return;
    const now = performance.now();
    if (now - first > 2000) { taps = 0; first = now; }
    if (++taps >= 5) { taps = 0; hud ? stop() : start(); }
  }, { passive: true });
}
