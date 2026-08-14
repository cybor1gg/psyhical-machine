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
  } catch { /* no storage — stay on the default */ }

  if (forced) { apply(forced); return; }

  // Nothing else. The tier is no longer chosen or changed automatically.
  //
  // It used to measure fps at boot and then keep watching, stepping down a
  // tier after a couple of slow seconds. On a machine that dipped once, the
  // scene changed mid-session: `minimal` swaps the sun video for a static
  // gradient disc that is BIGGER than the sun it replaces and strips the
  // starfields, so the background appeared to vanish and a huge frozen sun
  // took its place. A transient dip should never repaint the whole cabinet.
  //
  // The scene is also far cheaper than when that safety net was written -
  // no backdrop filters, no background-position repaints, no animated blur,
  // half the GPU memory and a sun that costs a third of what it did - so
  // `high` is the right default everywhere. ?q=lite / ?q=minimal still work
  // for a cabinet that genuinely needs them, and they stick.

}
