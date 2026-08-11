// MintBets sound engine — ES-module port of the design system's MintSound.
// Two paths, matching the design's audio spec:
//   • Real card samples (deal/flip/sweep) play raw through HTMLAudioElements,
//     so the recordings are heard exactly as captured.
//   • Synthesized ticks / bust / cashout run through a shared Web Audio master
//     bus with gentle glue compression and a subtle ambient delay tail.
//
// Usage: import { sound } from "../lib/sound";
//   sound.prime()      — call synchronously inside a user gesture (click handler)
//   sound.cardDeal()   — new card hits the table (start, skip)
//   sound.cardFlip()   — card reveal on a call
//   sound.tick(mult)   — win tick; pitch rises with the multiplier
//   sound.loss()       — bust
//   sound.cashOut()    — cashout celebration
//   sound.setMuted(b) / sound.isMuted()

let ctx = null;
let master = null;
let wetGain = null;
let muted = false;
let rollStop = null; // cancels the current wheel-roll playback

// ALL recordings play through Web Audio buffers — never HTMLAudioElements.
// Media elements were the iPhone jank: every .play() spins up a media
// pipeline on the main thread (a reliable frame hitch mid-animation), and
// iOS ignores HTMLAudio volume so fades didn't even work there. Buffers are
// decoded once and then play on the audio thread with sample-accurate gain
// envelopes at zero main-thread cost. Samples connect straight to the
// destination (not the master bus) so the recordings stay uncoloured by the
// compressor and ambient tail, matching the design system's intent.
const SAMPLE_URLS = {
  deal: "/sounds/card-deal.wav",
  flip: "/sounds/card-flip.wav",
  sweep: "/sounds/card-sweep.wav",
  roll: "/sounds/roulette-roll-v2.wav",
};
const sampleAB = {};   // name -> Promise<ArrayBuffer|null> (network fetch)
const sampleBuf = {};  // name -> AudioBuffer (decoded, ready to play)

function fetchSample(name) {
  if (!sampleAB[name]) {
    sampleAB[name] = fetch(SAMPLE_URLS[name])
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
  }
  return sampleAB[name];
}
// Warm at load: fetching is allowed before a user gesture, so the bytes are
// local by the first click and only the (fast) decode remains.
if (typeof window !== "undefined") Object.keys(SAMPLE_URLS).forEach(fetchSample);

function decodeSample(name) {
  if (sampleBuf[name]) return Promise.resolve(sampleBuf[name]);
  if (!ctx) return Promise.resolve(null);
  return fetchSample(name).then((ab) => {
    if (!ab || sampleBuf[name]) return sampleBuf[name] || null;
    return ctx.decodeAudioData(ab.slice(0)).then((b) => (sampleBuf[name] = b)).catch(() => null);
  });
}

function playSample(name, { gain = 0.8, rate = 1 } = {}) {
  if (muted) return;
  const a = ensure();
  if (!a) return;
  const go = (buf) => {
    if (!buf || muted) return;
    const src = a.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = a.createGain();
    g.gain.value = Math.min(1, Math.max(0, gain));
    src.connect(g).connect(a.destination);
    src.start();
  };
  if (sampleBuf[name]) { go(sampleBuf[name]); return; }
  // first play after load: decode then fire if it's still timely (<300ms)
  const t0 = performance.now();
  decodeSample(name).then((buf) => { if (performance.now() - t0 < 300) go(buf); });
}

function build(a) {
  master = a.createGain();
  master.gain.value = 0.9;
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 26;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  master.connect(comp).connect(a.destination);

  // subtle ambient tail — smooths everything, gives "space"
  const delay = a.createDelay(1.0);
  delay.delayTime.value = 0.16;
  const fb = a.createGain();
  fb.gain.value = 0.32;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2600;
  wetGain = a.createGain();
  wetGain.gain.value = 0.18;
  delay.connect(fb).connect(delay);
  delay.connect(lp).connect(comp);
  wetGain.connect(delay);
}

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    build(ctx);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function out(node, wet = 0.5) {
  node.connect(master);
  if (wetGain && wet > 0) {
    const send = ctx.createGain();
    send.gain.value = wet;
    node.connect(send).connect(wetGain);
  }
}

// short synthesized blip — used for win ticks
function blip(freq, { gain = 0.25, dur = 0.14, type = "sine", wet = 0.5 } = {}) {
  const a = ensure();
  if (!a || muted) return;
  const t = a.currentTime;
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  out(g, wet);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// general oscillator voice — the design system's tone(): optional pitch slide,
// attack shaping and scheduling delay. blip() stays for the legacy voices.
function tone({ freq = 440, type = "sine", dur = 0.2, gain = 0.1, slideTo = null, attack = 0.004, delay = 0, wet = 0.3 } = {}) {
  const a = ensure();
  if (!a || muted) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  out(g, wet);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// filtered noise burst — glass, cracks, whooshes
function noiseBurst({ dur = 0.3, gain = 0.2, cutoff = 2000, cutoffEnd = 300, band = false, q = 1, wet = 0.3, delay = 0 } = {}) {
  const a = ensure();
  if (!a || muted) return;
  const t = a.currentTime + delay;
  const len = Math.ceil(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = band ? "bandpass" : "lowpass";
  f.Q.value = q;
  f.frequency.setValueAtTime(cutoff, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, cutoffEnd), t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g);
  out(g, wet);
  src.start(t);
  src.stop(t + dur + 0.05);
}

export const sound = {
  // Call synchronously inside a click/tap handler (before any await) so the
  // AudioContext is created within a user gesture — required on mobile.
  prime() { ensure(); Object.keys(SAMPLE_URLS).forEach(decodeSample); },

  setMuted(b) { muted = !!b; },
  isMuted() { return muted; },
  toggleMuted() { muted = !muted; return muted; },

  cardDeal() { playSample("deal", { gain: 0.8, rate: 0.98 + Math.random() * 0.06 }); },
  cardSweep() { playSample("sweep", { gain: 0.5, rate: 1.06 }); },
  cardFlip() { playSample("flip", { gain: 0.75, rate: 0.98 + Math.random() * 0.06 }); },

  // Win tick — pitch climbs with the running multiplier (capped), like the design's count-up feel.
  tick(mult = 1) {
    const step = Math.min(12, Math.log2(Math.max(1, mult)) * 3);
    blip(520 * Math.pow(1.059, step), { gain: 0.22, dur: 0.12, type: "triangle" });
    setTimeout(() => blip(660 * Math.pow(1.059, step), { gain: 0.14, dur: 0.1, type: "sine" }), 50);
  },

  loss() {
    const a = ensure();
    if (!a || muted) return;
    const t = a.currentTime;
    const osc = a.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.32);
    const lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    osc.connect(lp).connect(g);
    out(g, 0.35);
    osc.start(t);
    osc.stop(t + 0.45);
  },

  cashOut() {
    playSample("sweep", { gain: 0.7 });
    // small rising arpeggio on top
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => blip(f, { gain: 0.16, dur: 0.16, type: "triangle" }), 60 + i * 70)
    );
  },

  // ── crystal set (Dragon Tower) — no cards here ─────────────────────────

  // Tiny press click, fired the instant a tile is tapped.
  tileTap() {
    blip(880, { gain: 0.06, dur: 0.05, type: "triangle", wet: 0.1 });
  },

  // Warm bell pluck for a safe gem — the design system's gem() voicing
  // (G5 body + octave shimmer + soft mallet click), pitched up a semitone
  // per climbed row so the tension rises with the tower.
  gemPing(step = 0) {
    const s = Math.pow(2, Math.min(step, 12) / 12);
    blip(783.99 * s, { gain: 0.11, dur: 0.42, type: "sine", wet: 0.55 });
    setTimeout(() => blip(1174.66 * s, { gain: 0.045, dur: 0.34, type: "sine", wet: 0.6 }), 5);
    blip(1567.98 * s, { gain: 0.02, dur: 0.16, type: "triangle", wet: 0.5 });
  },

  // Crystal shatter for the dragon: glassy crack + falling rumble.
  shatter() {
    noiseBurst({ dur: 0.09, gain: 0.16, cutoff: 8500, cutoffEnd: 3500, band: true, q: 5, wet: 0.15 });
    noiseBurst({ dur: 0.32, gain: 0.18, cutoff: 2400, cutoffEnd: 200, wet: 0.3, delay: 0.03 });
    const a = ensure();
    if (!a || muted) return;
    const t = a.currentTime;
    const osc = a.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.38);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.24, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc.connect(g);
    out(g, 0.2);
    osc.start(t);
    osc.stop(t + 0.5);
  },

  // ── casino chips + roulette + baccarat (design-system voices) ──────────

  // Light chip tap — a bet placed on the felt (Roulette / Baccarat).
  chip() {
    tone({ freq: 900, type: "sine", dur: 0.05, gain: 0.05, slideTo: 640, attack: 0.002, wet: 0.14 });
    noiseBurst({ dur: 0.04, gain: 0.04, cutoff: 5200, cutoffEnd: 2200, wet: 0.08, delay: 0.005 });
  },

  // Coins clinking — quick bright metallic pings on the roulette win popup.
  coins() {
    if (muted) return;
    const notes = [2637, 3136, 2349, 2960, 2794];
    for (let i = 0; i < 5; i++) {
      const d = i * 0.055 + Math.random() * 0.012;
      tone({ freq: notes[i] + Math.random() * 140, type: "triangle", dur: 0.11, gain: 0.075, attack: 0.001, wet: 0.4, delay: d });
      tone({ freq: notes[i] * 1.5, type: "sine", dur: 0.07, gain: 0.028, attack: 0.001, wet: 0.5, delay: d });
      noiseBurst({ dur: 0.012, gain: 0.025, cutoff: 9000, cutoffEnd: 5000, wet: 0.06, delay: d }); // tiny metallic tick
    }
    tone({ freq: 4400, type: "sine", dur: 0.3, gain: 0.03, attack: 0.002, wet: 0.6, delay: 0.12 }); // shimmer tail
  },

  // Baccarat win — heavy coins landing on a wooden table and rolling to rest,
  // the last one wobbling/spinning down (accelerating flutter of taps).
  baccWin() {
    if (muted) return;
    const drop = (t, f, vol) => {
      noiseBurst({ dur: 0.04, gain: vol, cutoff: f, cutoffEnd: f * 0.8, wet: 0.04, delay: t, band: true, q: 9 }); // metal tap
      tone({ freq: f * 0.5, type: "triangle", dur: 0.05, gain: vol * 0.5, attack: 0.0006, wet: 0.03, delay: t }); // coin body
      tone({ freq: 200 + Math.random() * 80, type: "sine", dur: 0.04, gain: vol * 0.35, slideTo: 120, wet: 0.03, delay: t }); // woody knock
    };
    drop(0.0, 2600, 0.13);
    drop(0.11, 3100, 0.11);
    drop(0.19, 2300, 0.09);
    const start = 0.3;
    for (let i = 0; i < 9; i++) {
      const t = start + i * (0.05 - i * 0.004); // gaps shrink → speeding up
      const vol = 0.06 * (1 - i / 11);
      noiseBurst({ dur: 0.018, gain: vol, cutoff: 2700, cutoffEnd: 2400, wet: 0.03, delay: t, band: true, q: 8 });
    }
  },

  // Rolling sound while the ball orbits — the real recording through Web
  // Audio: a gain envelope holds, then fades to silence by `dur`. No media
  // element, no fade interval — nothing runs on the main thread.
  wheelSpin(dur = 1.4) {
    if (muted) return;
    const a = ensure();
    if (!a) return;
    if (rollStop) { rollStop(); rollStop = null; }
    const start = (buf, offset = 0) => {
      if (!buf || muted) return;
      const t = a.currentTime;
      const remain = Math.max(0.3, dur - offset);
      const src = a.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = a.createGain();
      g.gain.setValueAtTime(0.32, t);
      g.gain.setValueAtTime(0.32, t + remain * 0.32);
      g.gain.linearRampToValueAtTime(0.0001, t + remain);
      src.connect(g).connect(a.destination);
      src.start(t, buf.duration > 0 ? offset % buf.duration : 0);
      src.stop(t + remain + 0.05);
      rollStop = () => {
        try {
          g.gain.cancelScheduledValues(a.currentTime);
          g.gain.setValueAtTime(0.0001, a.currentTime);
          src.stop();
        } catch { /* already stopped */ }
      };
    };
    if (sampleBuf.roll) { start(sampleBuf.roll); return; }
    // first spin after load: decode finishes in a few ms — join mid-roll
    const t0 = performance.now();
    decodeSample("roll").then((buf) => {
      const late = (performance.now() - t0) / 1000;
      if (late < dur * 0.6) start(buf, late);
    });
  },

  // Ball settles into the pocket — a single soft warm "plock" (synthesized,
  // deliberately quiet and low; replaced the recorded tap that read as harsh).
  ballLand() {
    if (muted) return;
    tone({ freq: 320, type: "sine", dur: 0.09, gain: 0.07, slideTo: 195, attack: 0.002, wet: 0.1 });
    tone({ freq: 640, type: "sine", dur: 0.04, gain: 0.015, attack: 0.001, wet: 0.15, delay: 0.004 });
  },

  // Barely-there muted thud for each ball hop before it settles — pitched a
  // touch lower and quieter with every bounce. Fired from the animation tick
  // at the exact touchdown, so sound and motion can't drift apart.
  ballHop(k = 0) {
    if (muted) return;
    const g = [0.045, 0.03, 0.02][Math.min(k, 2)];
    tone({ freq: 290 - k * 25, type: "sine", dur: 0.05, gain: g, slideTo: 180, attack: 0.001, wet: 0.08 });
  },

  // ── Chicken Cross (design-system voices, ported verbatim) ──────────────
  // Light, soft "puk-tup" hop — a gentle muted wood-block tap with a tiny pitch
  // lift; the landing tap is delayed to meet the sprite (~270ms hop arc).
  hop() {
    if (muted) return;
    tone({ freq: 300, type: "sine", dur: 0.09, gain: 0.038, slideTo: 470, attack: 0.003, wet: 0.12 }); // soft body
    tone({ freq: 150, type: "triangle", dur: 0.07, gain: 0.02, slideTo: 220, wet: 0.08 });             // low thump
    noiseBurst({ dur: 0.035, gain: 0.014, cutoff: 1200, cutoffEnd: 400, wet: 0.06 });                   // tiny scuff
    tone({ freq: 520, type: "sine", dur: 0.05, gain: 0.016, slideTo: 360, wet: 0.1, delay: 0.22 });    // landing tap
  },
  // Pedestrian-signal chirp — the walk lamp turning mint at round start.
  walk() {
    if (muted) return;
    tone({ freq: 1244.5, type: "sine", dur: 0.07, gain: 0.04, attack: 0.002, wet: 0.25 });
    tone({ freq: 1244.5, type: "sine", dur: 0.07, gain: 0.034, attack: 0.002, wet: 0.25, delay: 0.15 });
  },
  // Ambient car passing on a nearby lane — a doppler whoosh (tyre + engine),
  // panned to the side it drives past on. Kept low so traffic is atmosphere.
  // The whoosh TRACKS the car: near-silent while far, swelling only as it draws
  // level with the chicken. `prox` (0..1) = how close its lane is (louder);
  // `travelMs` matches the car's real on-screen travel time.
  carPass(pan = 0, prox = 0.5, travelMs = 3200) {
    if (muted) return;
    const a = ensure(); if (!a) return;
    const t0 = a.currentTime;
    const dur = Math.max(1.8, travelMs / 1000);
    const peak = 0.013 + Math.max(0, Math.min(1, prox)) * 0.055;
    const mid = dur * 0.5;
    // audible only alongside — a gaussian bell envelope, near-silent at the edges
    const env = a.createGain();
    const NB = 96, curve = new Float32Array(NB);
    for (let i = 0; i < NB; i++) { const x = (i / (NB - 1)) * 2 - 1; curve[i] = Math.max(0.0001, peak * Math.exp(-Math.pow(x * 2.6, 2))); }
    env.gain.setValueCurveAtTime(curve, t0, dur);
    // stereo sweep: comes in from one side, leaves on the other
    const side = pan >= 0 ? 1 : -1;
    if (a.createStereoPanner) {
      const p = a.createStereoPanner();
      p.pan.setValueAtTime(-0.92 * side, t0);
      p.pan.linearRampToValueAtTime(0.92 * side, t0 + dur);
      env.connect(p).connect(master);
    } else {
      env.connect(master);
    }
    if (wetGain) { const s = a.createGain(); s.gain.value = 0.05; env.connect(s).connect(wetGain); }
    // engine: low smooth rumble through a gently-opening lowpass
    const lp = a.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(240, t0);
    lp.frequency.linearRampToValueAtTime(720, t0 + mid);
    lp.frequency.linearRampToValueAtTime(220, t0 + dur);
    lp.connect(env);
    [[1, 0.5, "sine"], [1.5, 0.26, "triangle"], [2.02, 0.12, "sine"]].forEach(([mult, lvl, type]) => {
      const o = a.createOscillator(); o.type = type;
      const og = a.createGain(); og.gain.value = lvl;
      o.frequency.setValueAtTime(58 * mult, t0);
      o.frequency.linearRampToValueAtTime(50 * mult, t0 + dur);
      o.connect(og).connect(lp);
      o.start(t0); o.stop(t0 + dur + 0.05);
    });
    // tyre wash: soft band-passed noise riding the same envelope
    const frames = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, frames, a.sampleRate);
    const dch = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) dch[i] = (Math.random() * 2 - 1) * 0.6;
    const src = a.createBufferSource(); src.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(900, t0);
    bp.frequency.linearRampToValueAtTime(1500, t0 + mid);
    bp.frequency.linearRampToValueAtTime(700, t0 + dur);
    const tg = a.createGain(); tg.gain.value = 0.5;
    src.connect(bp).connect(tg).connect(env);
    src.start(t0); src.stop(t0 + dur);
  },
  // Safety bollards rising out of the road — hydraulic whir sweeping up, air
  // hiss, and a firm metal clunk as they lock at the top.
  bollardUp() {
    if (muted) return;
    tone({ freq: 110, type: "triangle", dur: 0.26, gain: 0.05, slideTo: 230, attack: 0.02, wet: 0.12 });  // hydraulic whir
    noiseBurst({ dur: 0.24, gain: 0.028, cutoff: 700, cutoffEnd: 1600, wet: 0.1 });                        // air hiss
    tone({ freq: 230, type: "triangle", dur: 0.07, gain: 0.09, slideTo: 150, attack: 0.001, wet: 0.12, delay: 0.25 }); // lock clunk
    noiseBurst({ dur: 0.045, gain: 0.06, cutoff: 3200, cutoffEnd: 900, wet: 0.08, delay: 0.25 });
  },
  // Car slamming into the bollards — sharp metal clang over a crumple crunch
  // and a heavy body thud. No bright tinkles: nothing that reads as a win chime.
  bollardCrash() {
    if (muted) return;
    tone({ freq: 430, type: "square", dur: 0.09, gain: 0.06, slideTo: 170, attack: 0.001, wet: 0.14 });   // clang edge
    noiseBurst({ dur: 0.13, gain: 0.15, cutoff: 2600, cutoffEnd: 480, wet: 0.12 });                        // crumple crunch
    tone({ freq: 150, type: "sine", dur: 0.42, gain: 0.24, slideTo: 46 });                                 // heavy thud
    tone({ freq: 96, type: "triangle", dur: 0.3, gain: 0.12, slideTo: 40 });
  },
  // Toxic manhole-gas death — NOT a crash/boom. A pressurised hiss venting out,
  // a wet sickly gurgle, and a woozy detuned tone bending down (poison/dizzy).
  explode() {
    if (muted) return;
    const a = ensure(); if (!a) return;
    const t0 = a.currentTime;
    // 1) pressurised gas vent — a long airy hiss that swells then tails off
    const dur = 1.15;
    const frames = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, frames, a.sampleRate);
    const dch = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) dch[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(2600, t0);
    bp.frequency.exponentialRampToValueAtTime(700, t0 + dur);
    const hg = a.createGain();
    hg.gain.setValueAtTime(0.0001, t0);
    hg.gain.exponentialRampToValueAtTime(0.14, t0 + 0.06);
    hg.gain.exponentialRampToValueAtTime(0.075, t0 + 0.45);
    hg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(hg);
    out(hg, 0.22);
    src.start(t0); src.stop(t0 + dur);
    // 2) wet sickly gurgle underneath — low warbling sine through a lowpass
    const gl = a.createBiquadFilter(); gl.type = "lowpass"; gl.frequency.value = 520; gl.Q.value = 4;
    const gg = a.createGain();
    gg.gain.setValueAtTime(0.0001, t0);
    gg.gain.exponentialRampToValueAtTime(0.085, t0 + 0.1);
    gg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    const bub = a.createOscillator(); bub.type = "sine";
    bub.frequency.setValueAtTime(150, t0);
    const lfo = a.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 11;
    const lfoG = a.createGain(); lfoG.gain.value = 42;
    lfo.connect(lfoG).connect(bub.frequency);
    bub.connect(gl).connect(gg);
    out(gg, 0.18);
    bub.start(t0); bub.stop(t0 + 0.95);
    lfo.start(t0); lfo.stop(t0 + 0.95);
    // 3) woozy "poison" tone — two detuned sines bending downward (dizzy)
    tone({ freq: 430, type: "sine", dur: 0.85, gain: 0.045, slideTo: 150, attack: 0.02, wet: 0.5, delay: 0.05 });
    tone({ freq: 442, type: "sine", dur: 0.85, gain: 0.04, slideTo: 138, attack: 0.02, wet: 0.5, delay: 0.05 });
  },
  // Soft cluck flourish on a successful cash-out (paired with coins()).
  cluck() {
    if (muted) return;
    tone({ freq: 720, type: "triangle", dur: 0.07, gain: 0.07, slideTo: 980, attack: 0.003, wet: 0.2 });
    tone({ freq: 980, type: "triangle", dur: 0.09, gain: 0.06, slideTo: 760, attack: 0.003, wet: 0.2, delay: 0.07 });
  },
  // Car impact when the chicken gets hit — the SAME smooth engine rumble as a
  // passing car, then just a heavy "bao" thud at the exact moment it connects.
  // Diegetic (it IS the car), deliberately nothing that reads as a defeat jingle.
  carCrash(lead = 0.45) {
    if (muted) return;
    const a = ensure(); if (!a) return;
    const t0 = a.currentTime;
    // approach rumble (identical voice family to carPass)
    const eng = a.createGain(); eng.gain.value = 1; eng.connect(master);
    const lp = a.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(360, t0);
    lp.frequency.linearRampToValueAtTime(820, t0 + lead * 0.8);
    lp.frequency.linearRampToValueAtTime(300, t0 + lead);
    lp.connect(eng);
    [[1, 0.07, "sine"], [1.5, 0.035, "triangle"], [2.0, 0.018, "sine"]].forEach(([mult, lvl, type]) => {
      const o = a.createOscillator(); o.type = type;
      const eg = a.createGain();
      eg.gain.setValueAtTime(0.0001, t0);
      eg.gain.exponentialRampToValueAtTime(lvl, t0 + lead * 0.6);
      eg.gain.exponentialRampToValueAtTime(0.0001, t0 + lead + 0.12);
      o.frequency.setValueAtTime(56 * mult, t0);
      o.frequency.linearRampToValueAtTime(50 * mult, t0 + lead);
      o.connect(eg).connect(lp);
      o.start(t0); o.stop(t0 + lead + 0.2);
    });
    // heavy thud at the exact moment of impact
    tone({ freq: 158, type: "sine", dur: 0.46, gain: 0.28, slideTo: 44, delay: lead });
    tone({ freq: 92, type: "triangle", dur: 0.38, gain: 0.16, slideTo: 36, delay: lead });
    noiseBurst({ dur: 0.16, gain: 0.13, cutoff: 1500, cutoffEnd: 300, wet: 0.12, delay: lead + 0.01 }); // crunch
  },

};
