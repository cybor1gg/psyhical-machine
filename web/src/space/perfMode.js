// Graphics tiers for weak cabinets. There is no engine to swap in — the
// browser IS the engine — so this does what an engine's settings menu would:
// measure the machine once, then run the whole app in "lite" if it can't
// hold frame rate. Lite mode is applied as <html class="perf-lite">; CSS and
// the canvas games read it and drop decorative cost (fewer backdrop layers,
// downscaled sky, smaller particle caps, idle throttles).
//
// Order of authority:
//   1. cabinet.config.json { "graphics": "lite" | "high" }  — operator pins it
//   2. localStorage space_gfx ("lite" | "high")             — sticky probe result
//   3. auto-probe: ~1.2s of rAF frame times on the live scene; median frame
//      over 20ms (≈ under 50fps) ⇒ lite, and the verdict is stored.
// A probe only ever runs when the tab is visible; hidden panes freeze rAF.

const KEY = "space_gfx";
const listeners = new Set();

export function isLite() {
  return document.documentElement.classList.contains("perf-lite");
}

export function onPerfMode(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function apply(lite) {
  const had = isLite();
  document.documentElement.classList.toggle("perf-lite", lite);
  if (had !== lite) listeners.forEach((cb) => cb(lite));
}

function probe() {
  if (document.hidden) {
    document.addEventListener("visibilitychange", function once() {
      if (!document.hidden) { document.removeEventListener("visibilitychange", once); probe(); }
    });
    return;
  }
  const deltas = [];
  let last = 0;
  const tick = (t) => {
    if (last) deltas.push(t - last);
    last = t;
    if (deltas.length < 70) { requestAnimationFrame(tick); return; }
    deltas.sort((a, b) => a - b);
    const median = deltas[Math.floor(deltas.length / 2)];
    const lite = median > 20;
    try { window.localStorage.setItem(KEY, lite ? "lite" : "high"); } catch { /* fine */ }
    apply(lite);
  };
  requestAnimationFrame(tick);
}

export function initPerfMode() {
  // sticky verdict first, so a known-slow machine never flashes the heavy sky
  let stored = null;
  try { stored = window.localStorage.getItem(KEY); } catch { /* fine */ }
  if (stored === "lite") apply(true);

  fetch("/cabinet.config.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      const pin = cfg && cfg.graphics;
      if (pin === "lite" || pin === "high") { apply(pin === "lite"); return; }
      // auto: re-probe each boot (hardware doesn't change, drivers do), but
      // let the scene settle first so we measure cruise, not page load
      setTimeout(probe, 2500);
    })
    .catch(() => setTimeout(probe, 2500));
}
