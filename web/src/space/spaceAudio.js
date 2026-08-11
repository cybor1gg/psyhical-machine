// Shared WebAudio engine for the space theme — everything is synthesized,
// no samples (recipes from the design handoff). One AudioContext for the
// whole app so ambience survives navigation between menu and games.
//
// Volume is a 4-step cycle OFF → LOW → MEDIUM → HIGH (gains 0/.35/.65/1),
// persisted in localStorage and applied to both SFX and the ambient bed.
import { useSyncExternalStore } from "react";

const VOL_KEY = "space_vol";
const GAINS = [0, 0.35, 0.65, 1];
export const VOL_LABELS = ["OFF", "LOW", "MEDIUM", "HIGH"];

let vol = 2;
try { const s = Number(window.localStorage.getItem(VOL_KEY)); if ([0, 1, 2, 3].includes(s)) vol = s; } catch { /* default */ }
const volListeners = new Set();

export function getVol() { return vol; }
export function vg() { return GAINS[vol]; }
export function cycleVol() {
  vol = (vol + 1) % 4;
  try { window.localStorage.setItem(VOL_KEY, String(vol)); } catch { /* memory-only */ }
  setAmbGain();
  for (const fn of volListeners) fn();
  return vol;
}
export function useVol() {
  return useSyncExternalStore(
    (fn) => { volListeners.add(fn); return () => volListeners.delete(fn); },
    () => vol
  );
}

let AC = null;
export function ctx() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === "suspended") AC.resume();
  return AC;
}

// ── SFX primitives (each game composes its own kinds from these) ──────────
export function beep(type, f0, f1, volN, dur, at = 0) {
  const VG = vg();
  if (VG === 0) return;
  try {
    const C = ctx();
    const t = C.currentTime;
    const o = C.createOscillator(), g = C.createGain();
    o.type = type; o.connect(g); g.connect(C.destination);
    const s = t + at;
    o.frequency.setValueAtTime(f0, s);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, s + dur);
    g.gain.setValueAtTime(Math.max(0.0001, volN * VG), s);
    g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    o.start(s); o.stop(s + dur + 0.02);
  } catch { /* audio unavailable */ }
}

export function whoosh(f0, f1, volN, dur, at = 0) {
  const VG = vg();
  if (VG === 0) return;
  try {
    const C = ctx();
    const t = C.currentTime;
    const len = Math.floor(C.sampleRate * dur), buf = C.createBuffer(1, len, C.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = C.createBufferSource(); src.buffer = buf;
    const f = C.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.2;
    const s = t + at;
    f.frequency.setValueAtTime(f0, s); f.frequency.exponentialRampToValueAtTime(f1, s + dur);
    const g = C.createGain(); g.gain.setValueAtTime(volN * VG, s); g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    src.connect(f); f.connect(g); g.connect(C.destination); src.start(s); src.stop(s + dur);
  } catch { /* audio unavailable */ }
}

export function boomNoise(volN = 0.5, dur = 0.55, lpFrom = 1400, lpTo = 200) {
  const VG = vg();
  if (VG === 0) return;
  try {
    const C = ctx();
    const t = C.currentTime;
    const buf = C.createBuffer(1, Math.floor(C.sampleRate * dur), C.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = C.createBufferSource(); src.buffer = buf;
    const ng = C.createGain(); ng.gain.setValueAtTime(volN * VG, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const flt = C.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.setValueAtTime(lpFrom, t); flt.frequency.exponentialRampToValueAtTime(lpTo, t + dur);
    src.connect(flt); flt.connect(ng); ng.connect(C.destination); src.start(t); src.stop(t + dur);
  } catch { /* audio unavailable */ }
}

// Common composed effects shared by more than one screen.
export const sfx = {
  click: () => beep("square", 300, 170, 0.11, 0.08),
  tick: () => beep("triangle", 2100, 1500, 0.04, 0.055),
  select: () => { beep("sine", 523, 0, 0.07, 0.12); beep("sine", 784, 0, 0.07, 0.28, 0.09); },
  bet: () => { whoosh(300, 1600, 0.08, 0.3); beep("sawtooth", 180, 420, 0.12, 0.16); beep("triangle", 520, 780, 0.1, 0.18, 0.05); },
  cash: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => beep("sine", f, 0, 0.14, 0.32, i * 0.08)); whoosh(1200, 4200, 0.06, 0.5, 0.1); },
  boom: () => { boomNoise(); beep("sine", 160, 40, 0.35, 0.5); beep("square", 90, 30, 0.18, 0.45, 0.02); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => beep("sine", f, 0, 0.12, 0.3, i * 0.07)),
};

// ── ambient bed (drone + filtered noise shimmer + echoing pings) ──────────
let amb = null;      // master ambient gain node
let pingTimer = 0;

function setAmbGain() {
  try { if (amb && AC) amb.gain.linearRampToValueAtTime(0.28 * vg(), AC.currentTime + 0.4); } catch { /* fine */ }
}

export function startAmbient() {
  if (amb) { setAmbGain(); return; }
  try {
    const C = ctx();
    const m = C.createGain(); m.gain.value = 0; m.connect(C.destination);
    const flt = C.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 320; flt.connect(m);
    const mk = (type, f, g, dt) => { const o = C.createOscillator(), gg = C.createGain(); o.type = type; o.frequency.value = f; if (dt) o.detune.value = dt; gg.gain.value = g; o.connect(gg); gg.connect(flt); o.start(); };
    mk("sine", 55, 0.5); mk("sine", 82.5, 0.22, 6); mk("triangle", 110, 0.1, -8);
    const lfo = C.createOscillator(); lfo.frequency.value = 0.06;
    const lg = C.createGain(); lg.gain.value = 130; lfo.connect(lg); lg.connect(flt.frequency); lfo.start();
    const nb = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const ns = C.createBufferSource(); ns.buffer = nb; ns.loop = true;
    const bp = C.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 8;
    const ng = C.createGain(); ng.gain.value = 0.02;
    const nlfo = C.createOscillator(); nlfo.frequency.value = 0.11;
    const nlg = C.createGain(); nlg.gain.value = 0.013; nlfo.connect(nlg); nlg.connect(ng.gain); nlfo.start();
    ns.connect(bp); bp.connect(ng); ng.connect(m); ns.start();
    amb = m;
    setAmbGain();
    const ping = () => {
      try {
        if (vg() > 0 && !document.hidden) {
          const t2 = AC.currentTime, f = [520, 660, 780, 880, 1040][(Math.random() * 5) | 0];
          const o = AC.createOscillator(), g = AC.createGain(); o.type = "sine"; o.frequency.value = f;
          const dl = AC.createDelay(); dl.delayTime.value = 0.3;
          const fb = AC.createGain(); fb.gain.value = 0.38;
          g.gain.setValueAtTime(0.06, t2); g.gain.exponentialRampToValueAtTime(0.0001, t2 + 1.4);
          o.connect(g); g.connect(amb); g.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(amb);
          o.start(t2); o.stop(t2 + 1.5);
        }
      } catch { /* fine */ }
      pingTimer = setTimeout(ping, 6000 + Math.random() * 9000);
    };
    clearTimeout(pingTimer);
    pingTimer = setTimeout(ping, 3500);
  } catch { /* audio unavailable */ }
}

// Arm ambience on the first user gesture (autoplay policy). Idempotent.
let armed = false;
export function armAmbientOnGesture() {
  if (armed) return;
  armed = true;
  const boot = () => { startAmbient(); };
  document.addEventListener("pointerdown", boot, { once: false });
}
