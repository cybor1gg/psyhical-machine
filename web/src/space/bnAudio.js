// Star Cluster's sample deck — the real recordings, decoded once on the
// shared AudioContext. Every player falls back to the procedural cues in
// bnMusic while a buffer is still loading, so the game is never silent —
// sample() returns false when it could not play and the caller beeps instead.
import { ctx, vg, getVol } from "./spaceAudio";

const BASE = "/space/audio/";
const buffers = new Map();                 // name -> AudioBuffer | Promise

function load(name) {
  const have = buffers.get(name);
  if (have) return Promise.resolve(have);
  const p = fetch(BASE + name + ".ogg")
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
    .then((ab) => ctx().decodeAudioData(ab))
    .then((buf) => { buffers.set(name, buf); return buf; })
    .catch(() => { buffers.delete(name); return null; });
  buffers.set(name, p);
  return p;
}

// warmed as soon as the screen mounts — 26 files, ~870KB all told
export function preloadSamples() {
  [
    "click", "spin", "tumble", "toggle", "scatter",
    "reel-land-1", "reel-land-2", "reel-land-3", "reel-land-4", "reel-land-5", "reel-land-6",
    "win-chain-1", "win-chain-3", "win-chain-6",
    "scatter-rise-1", "scatter-rise-2", "scatter-rise-3", "scatter-rise-4", "scatter-rise-5",
    "freespins-hit", "buy-freespins", "nova-orb", "megawin", "cosmicwin",
    "music-base-loop", "music-freespins-loop",
  ].forEach(load);
}

// plays a one-shot; true = handled (played, or muted), false = not loaded yet
export function sample(name, { v = 1, rate = 1, cut = 0 } = {}) {
  if (getVol() === 0) return true;
  const buf = buffers.get(name);
  if (!(buf instanceof AudioBuffer)) { load(name); return false; }
  try {
    const C = ctx(), t = C.currentTime;
    const s = C.createBufferSource(), g = C.createGain();
    s.buffer = buf; s.playbackRate.value = rate;
    s.connect(g); g.connect(C.destination);
    const dur = cut ? Math.min(cut, buf.duration) : buf.duration;
    g.gain.setValueAtTime(v * vg(), t);
    if (cut && dur > 0.15) {               // early fade so a cut never clicks
      g.gain.setValueAtTime(v * vg(), t + dur - 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    s.start(t); s.stop(t + dur + 0.02);
    return true;
  } catch { return true; }
}

// ── the music: one loop at a time, crossfaded, volume kept in sync ────────
const MUSIC_V = { "music-base-loop": 0.3, "music-freespins-loop": 0.42 };
let cur = null;                            // { src, gain, name }
let want = null;
let volSync = null;

export function music(mode) {              // "base" | "feature" | null
  want = mode === "base" ? "music-base-loop" : mode === "feature" ? "music-freespins-loop" : null;
  ensure();
}

function ensure() {
  if (cur && cur.name === want) return;
  if (cur) {
    const old = cur; cur = null;
    try {
      const C = ctx();
      old.gain.gain.setValueAtTime(Math.max(0.0001, old.gain.gain.value), C.currentTime);
      old.gain.gain.exponentialRampToValueAtTime(0.0001, C.currentTime + 0.6);
      old.src.stop(C.currentTime + 0.7);
    } catch { /* already gone */ }
  }
  if (!want) {
    if (volSync) { clearInterval(volSync); volSync = null; }
    return;
  }
  const w = want;
  load(w).then((buf) => {
    if (!buf || want !== w || cur) return;
    try {
      const C = ctx();
      const src = C.createBufferSource(), g = C.createGain();
      src.buffer = buf; src.loop = true;
      src.connect(g); g.connect(C.destination);
      g.gain.setValueAtTime(0.0001, C.currentTime);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, (MUSIC_V[w] ?? 0.35) * vg()), C.currentTime + 0.7);
      src.start();
      cur = { src, gain: g, name: w };
    } catch { /* audio unavailable */ }
  });
  // the volume buttons must reach a loop that is already playing
  if (!volSync) {
    volSync = setInterval(() => {
      if (!cur) return;
      try {
        const C = ctx();
        const target = Math.max(0.0001, (MUSIC_V[cur.name] ?? 0.35) * vg());
        cur.gain.gain.setTargetAtTime(target, C.currentTime, 0.25);
      } catch { /* audio unavailable */ }
    }, 600);
  }
}
