// Star Cluster's music — procedural, scheduled on the shared AudioContext.
// Nothing is downloaded and nothing is decoded: every cue is a handful of
// oscillator notes with exponential envelopes, so the whole "soundtrack"
// costs less CPU than one decoded MP3 and works on the weakest cabinet.
//
// One musical home: A minor pentatonic (A–C–D–E–G) for the base game, its
// relative major for triumph. Every cue lands in that scale so overlapping
// cues never clash.
import { ctx, vg, getVol, boomNoise } from "./spaceAudio";

// frequency of scale degree n (0-based) over a root, minor pentatonic
const PENTA = [1, 6 / 5, 27 / 20, 3 / 2, 9 / 5];
const degree = (root, n) => root * PENTA[((n % 5) + 5) % 5] * Math.pow(2, Math.floor(n / 5));

// one enveloped oscillator note at absolute context time t
function note(C, t, f, { d = 0.2, type = "triangle", v = 0.07, glide = 0, lp = 0 } = {}) {
  const o = C.createOscillator(), g = C.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + d);
  o.connect(g);
  if (lp) {
    const F = C.createBiquadFilter();
    F.type = "lowpass"; F.frequency.value = lp;
    g.connect(F); F.connect(C.destination);
  } else {
    g.connect(C.destination);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v * vg()), t + 0.018);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.start(t); o.stop(t + d + 0.03);
}

const quiet = () => getVol() === 0;
const now = (C) => C.currentTime + 0.02;

let loopTimer = null;
let loopBar = 0;

export const bnMusic = {
  // spin press: a quick ascending pluck run — energy without weight
  spin() {
    if (quiet()) return;
    try {
      const C = ctx(), t = now(C);
      [0, 1, 2, 4].forEach((n, k) =>
        note(C, t + k * 0.07, degree(220, n), { d: 0.16, type: "triangle", v: 0.055 }));
    } catch { /* audio unavailable */ }
  },

  // a tumble win: a chord stab that climbs with every consecutive tumble
  tumble(i) {
    if (quiet()) return;
    try {
      const C = ctx(), t = now(C);
      const root = degree(220, Math.min(i, 7));
      note(C, t, root, { d: 0.34, type: "triangle", v: 0.08 });
      note(C, t, root * 1.5, { d: 0.34, type: "triangle", v: 0.055 });
      note(C, t + 0.05, root * 2, { d: 0.3, type: "sine", v: 0.05 });
    } catch { /* audio unavailable */ }
  },

  // the counter ticking up: a soft shimmer that rises with it
  shimmer(ms) {
    if (quiet()) return;
    try {
      const C = ctx(), t = now(C), steps = 6, dur = Math.min(ms, 1400) / 1000;
      for (let k = 0; k < steps; k++)
        note(C, t + (k * dur) / steps, degree(880, k), { d: 0.09, type: "sine", v: 0.03 });
    } catch { /* audio unavailable */ }
  },

  // the cluster bursting
  pop() {
    if (quiet()) return;
    try {
      const C = ctx(), t = now(C);
      note(C, t, 150, { d: 0.3, type: "sine", v: 0.14, glide: 46 });
      boomNoise(0.16, 0.3, 2200, 300);
      [7, 5, 3].forEach((n, k) =>
        note(C, t + 0.05 + k * 0.06, degree(440, n), { d: 0.12, type: "sine", v: 0.035 }));
    } catch { /* audio unavailable */ }
  },

  // the scatter celebration: a long riser under quickening chimes
  riser(sec = 1.4) {
    if (quiet()) return;
    try {
      const C = ctx(), t = now(C);
      note(C, t, 130, { d: sec, type: "sawtooth", v: 0.05, glide: 520, lp: 900 });
      note(C, t, 65, { d: sec, type: "sine", v: 0.08, glide: 130 });
      let at = 0;
      for (let k = 0; k < 9; k++) {
        note(C, t + at, degree(440, k), { d: 0.1, type: "triangle", v: 0.04 });
        at += 0.19 - k * 0.014;             // the chimes close in
      }
    } catch { /* audio unavailable */ }
  },

  // the feature is won: a proper fanfare, relative major
  fanfare() {
    if (quiet()) return;
    try {
      const C = ctx(), t = now(C);
      const CH = [[261.6, 329.6, 392], [349.2, 440, 523.3], [392, 493.9, 587.3], [523.3, 659.3, 784]];
      CH.forEach((chord, k) =>
        chord.forEach((f) =>
          note(C, t + k * 0.21, f, { d: k === 3 ? 0.8 : 0.24, type: "triangle", v: 0.06 })));
      note(C, t + 0.63, 1046.5, { d: 0.8, type: "sine", v: 0.045 });
    } catch { /* audio unavailable */ }
  },

  // BIG/MEGA/COSMIC: an ascending run into a held wide chord
  bigWin() {
    if (quiet()) return;
    try {
      const C = ctx(), t = now(C);
      for (let k = 0; k < 8; k++)
        note(C, t + k * 0.09, degree(220, k), { d: 0.16, type: "triangle", v: 0.06 });
      const T = t + 0.78;
      [220, 277.2, 329.6, 440, 554.4].forEach((f, k) =>
        note(C, T, f * (k > 2 ? 1.003 : 1), { d: 1.4, type: k < 2 ? "sine" : "triangle", v: 0.055 }));
    } catch { /* audio unavailable */ }
  },

  // the free-spins loop: bass pulse + arpeggio + off-beat ticks, one bar
  // scheduled at a time. An interval only ARMS the bar; all timing is the
  // audio clock's, so jank never detunes it.
  loopStart() {
    if (loopTimer) return;
    loopBar = 0;
    const BAR = 1.68;                       // ~143bpm, 8 sixteenths
    const bass = [0, 0, -2, 3];             // A, A, G, D — rotates per bar
    const arm = () => {
      if (quiet()) { loopBar++; return; }
      try {
        const C = ctx(), t = now(C), b = loopBar++;
        const root = degree(110, bass[b % 4]);
        note(C, t, root, { d: 0.5, type: "sine", v: 0.085, lp: 280 });
        note(C, t + BAR / 2, root, { d: 0.4, type: "sine", v: 0.06, lp: 280 });
        for (let k = 0; k < 8; k++) {
          const step = [0, 2, 4, 7, 4, 2, 5, 4][k] + (b % 4 === 3 ? 1 : 0);
          note(C, t + (k * BAR) / 8, degree(440, step), { d: 0.11, type: "triangle", v: 0.028 });
        }
        for (let k = 1; k < 8; k += 2)
          note(C, t + (k * BAR) / 8, 3400, { d: 0.03, type: "sine", v: 0.016 });
      } catch { /* audio unavailable */ }
    };
    arm();
    loopTimer = setInterval(arm, 1680);
  },

  loopStop() {
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  },
};
