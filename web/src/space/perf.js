// Adaptive quality — the cabinet must run on cheap hardware.
//
// The space scene is expensive by design: animated blur, screen-sized
// starfields, a video sun, seven orbiting planets and blurred panels. A weak
// integrated GPU (or a browser that fell back to software rendering) cannot
// hold 60fps with all of it. So we MEASURE the machine instead of guessing:
// the first seconds of real frame times decide the tier, and a sustained bad
// patch later can still drop it further. It never upgrades on its own —
// oscillating quality looks worse than a steady lower tier.
//
//   high    — everything (a normal PC)
//   lite    — no animated blur, fewer bodies, no backdrop blur
//   minimal — static sun, no starfield motion, no orbits: pure UI
//
// Override for testing:  ?q=high | ?q=lite | ?q=minimal   (sticks; ?q=auto
// clears it). The tier is also mirrored onto <html data-q="…"> so plain CSS
// can react to it.
import { useSyncExternalStore } from "react";

const KEY = "space_quality";
const TIERS = ["minimal", "lite", "high"];

let quality = "high";
const listeners = new Set();

function apply(q) {
  if (q === quality) return;
  quality = q;
  document.documentElement.setAttribute("data-q", q);
  for (const fn of listeners) fn();
}

export function getQuality() { return quality; }
export function useQuality() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => quality
  );
}

export function setQuality(q, { persist = true } = {}) {
  if (!TIERS.includes(q)) return;
  if (persist) { try { window.localStorage.setItem(KEY, q); } catch { /* memory only */ } }
  apply(q);
}

let started = false;

export function initQuality() {
  if (started) return;
  started = true;

  // 1. explicit override wins and sticks
  let forced = null;
  try {
    const p = new URLSearchParams(window.location.search).get("q");
    if (p === "auto") window.localStorage.removeItem(KEY);
    else if (TIERS.includes(p)) { window.localStorage.setItem(KEY, p); forced = p; }
    if (!forced) {
      const saved = window.localStorage.getItem(KEY);
      if (TIERS.includes(saved)) forced = saved;
    }
  } catch { /* no storage — measure instead */ }

  if (forced) { apply(forced); return; }

  // 2. a coarse first guess from the hardware, so a very weak box does not
  //    have to suffer a second of full quality before we notice
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (cores <= 2 || mem <= 2) apply("lite");

  // 3. then measure what the machine ACTUALLY delivers
  let frames = 0;
  let start = 0;
  let raf = 0;
  const WARMUP_MS = 1200;   // ignore the first moments (fonts, video, layout)
  const SAMPLE_MS = 2500;

  const tick = (t) => {
    if (!start) { start = t; raf = requestAnimationFrame(tick); return; }
    const elapsed = t - start;
    if (elapsed < WARMUP_MS) { raf = requestAnimationFrame(tick); return; }
    frames++;
    if (elapsed < WARMUP_MS + SAMPLE_MS) { raf = requestAnimationFrame(tick); return; }

    const fps = (frames * 1000) / (elapsed - WARMUP_MS);
    cancelAnimationFrame(raf);
    if (fps < 26) apply("minimal");
    else if (fps < 48) apply("lite");
    // a comfortable machine simply stays on high

    watch(fps);
  };
  raf = requestAnimationFrame(tick);
}

// Keep an eye on things afterwards: if the machine is drowning for a couple
// of seconds (a heavy game, a background update), step down one tier. Only
// ever downwards, and at most to `minimal`.
function watch() {
  let frames = 0;
  let windowStart = performance.now();
  let bad = 0;

  const loop = (t) => {
    frames++;
    const span = t - windowStart;
    if (span >= 2000) {
      const fps = (frames * 1000) / span;
      frames = 0;
      windowStart = t;
      if (fps < 24 && document.visibilityState === "visible") {
        bad++;
        if (bad >= 2) {
          bad = 0;
          const i = TIERS.indexOf(quality);
          if (i > 0) apply(TIERS[i - 1]);
        }
      } else if (fps > 40) bad = 0;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
