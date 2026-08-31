// THE SHARED SKY — PixiJS (WebGL) port of the CSS scene in SpaceBackground.jsx.
// One canvas replaces ~25 composited CSS layers: the two drifting star tiles,
// the static twinkles, the drifting solar system (baked ray shafts, corona,
// glow discs, the alpha sun video, 7 planets), the shooting stars and the
// vignette. Visually identical to the CSS scene — except the sun's glow discs
// and ray shafts get their ORIGINAL scale+opacity breathing back (the handoff
// keyframes), which CSS had to park because scaling a blurred layer re-runs
// the blur every frame. In WebGL the blur was baked once, so scale is free.
//
// No game loop exists behind the backdrop, so this scene drives its OWN rAF
// (paused entirely while document.hidden) and renders at resolutionScale
// 0.75 — the sky is soft, upscaling is invisible, and the fill-rate drop is
// the win CSS compositing could not give us. If WebGL is unavailable
// createSkyScene() throws and the caller keeps the CSS scene as the live
// fallback; onLost() hands back to it after a dead context.
import { Container, Sprite, TilingSprite, Texture, Matrix, VideoSource } from "pixi.js";
import { createPixiApp, textureFromCanvas } from "./pixiApp";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ── keyframe tables (from space.css / the design handoff), flat [t,v,...] ──
// segments interpolate with a smoothstep ≈ CSS ease-in-out (the sheet's
// per-segment timing function); linear ones are handled inline.
const K_TWINKLE = [0, 0.35, 0.5, 0.8, 1, 0.35];                                        // mnTwinkle 5.5s
const K_BURN_O = [0, 0.75, 0.5, 1, 1, 0.75];                                           // bjSunBurn opacity
const K_BURN_S = [0, 1, 0.5, 1.14, 1, 1];                                              // bjSunBurn scale (handoff, restored)
const K_RAYS_O = [0, 0.4, 0.16, 0.85, 0.34, 0.55, 0.55, 0.95, 0.74, 0.5, 0.88, 0.75, 1, 0.4];   // bjRaysGrow 7.3s
const K_RAYS_S = [0, 0.86, 0.16, 1.08, 0.34, 0.94, 0.55, 1.18, 0.74, 0.9, 0.88, 1.04, 1, 0.86]; // (handoff, restored)
const K_CORONA = [0, 0.78, 0.3, 1, 0.6, 0.66, 0.8, 0.92, 1, 0.78];                     // kbCoronaPulse 4.2s
const K_DRIFT_X = [0, 0, 0.18, -0.26, 0.38, -0.52, 0.55, -0.7, 0.72, -0.48, 0.88, -0.18, 1, 0]; // bjSunDrift, vw
const K_DRIFT_Y = [0, 0, 0.18, 0.16, 0.38, 0, 0.55, 0.22, 0.72, 0.38, 0.88, 0.2, 1, 0];         //            vh

function easeInOut(u) { return u * u * (3 - 2 * u); } // ≈ cubic-bezier(.42,0,.58,1)
function kf(arr, p) {
  for (let i = 2; i < arr.length; i += 2) {
    if (p <= arr[i]) {
      const t0 = arr[i - 2], v0 = arr[i - 1], t1 = arr[i], v1 = arr[i + 1];
      return v0 + (v1 - v0) * easeInOut(t1 > t0 ? (p - t0) / (t1 - t0) : 1);
    }
  }
  return arr[arr.length - 1];
}

// ── static camera pose ─────────────────────────────────────────────────────
// perspective(1100px) rotateX(5deg) rotateY(-4deg) rotateZ(-1deg) scale(1.14)
// about the screen center. The linear part rides the container matrix, but
// the perspective divide is NOT negligible: w(p) = 1 − z(p)/1100 with
// z ≈ x·sin4° + y·sin5° (post-1.14) varies by ±8–13% across a 1080p screen.
// So every positioned item — the twinkles and the drifting solar anchor —
// is placed at p/w and locally scaled by 1/w, the exact projective image of
// the CSS plane at that point (this also restores the sun's ±4% size drift
// as bjSunDrift carries it across the screen). Only the two star TILES keep
// the affine approximation: a projective warp cannot ride a TilingSprite,
// and their random dot fields have no anchored feature — though individual
// corner stars do sit tens of px from their CSS spots at the CSS↔GL handover.
const CAM = (() => {
  const c1 = Math.cos(1 * DEG), s1 = Math.sin(1 * DEG);
  const c4 = Math.cos(4 * DEG), s4 = Math.sin(4 * DEG);
  const c5 = Math.cos(5 * DEG), s5 = Math.sin(5 * DEG);
  const S = 1.14;
  return {
    a: S * c4 * c1, c: S * c4 * s1,
    b: S * (-c5 * s1 - s4 * s5 * c1), d: S * (c5 * c1 - s4 * s5 * s1),
    // z(x,y) coefficients of the pose (x/y measured from the screen centre):
    // z = S·[(−x·s1 + y·c1)·s5 + (x·c1 + y·s1)·s4·c5]
    zx: S * (-s1 * s5 + c1 * s4 * c5), zy: S * (c1 * s5 + s1 * s4 * c5),
  };
})();
// perspective divide factor of the pose at a point relative to screen centre
const camW = (rx, ry) => 1 - (CAM.zx * rx + CAM.zy * ry) / 1100;
const camMatrix = new Matrix();

// ── bakes (all one-time; blurred layers at 1x — they are soft by nature —
//    planets at 2x for their crisp rims). ctx.filter takes CSS filter
//    syntax, so blur values are copied verbatim from the stylesheet; the
//    planets' inset box-shadow blur b maps to filter blur(b/2). ────────────
function raw(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"));
  return c;
}

// one star dot per tile — radial-gradient(circle, color r0px, transparent r1px)
function bakeStarTile(tile, col, r0, r1) {
  return raw(tile, tile, (g) => {
    const c = tile / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, r1);
    grad.addColorStop(0, col); grad.addColorStop(r0 / r1, col); grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, tile, tile);
  });
}

// twinkle dot: 1px solid core fading out at 2px, white (tinted per star)
function bakeDot() {
  return raw(12, 12, (g) => {
    const grad = g.createRadialGradient(6, 6, 0, 6, 6, 4);
    grad.addColorStop(0, "#fff"); grad.addColorStop(0.5, "#fff"); grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 12, 12);
  });
}

// conic-gradient helper: CSS "from 0deg" starts at 12 o'clock
const conic = (g, cx, cy, stops) => {
  const grad = g.createConicGradient(-Math.PI / 2, cx, cy);
  for (let i = 0; i < stops.length; i += 2) grad.addColorStop(stops[i], stops[i + 1]);
  return grad;
};

const RAYS_CS = 460; // 420 box + blur bleed pad
function bakeRays() {
  const tmp = raw(RAYS_CS, RAYS_CS, (g) => {
    const c = RAYS_CS / 2;
    const T = "rgba(255,190,90,0)";
    g.fillStyle = conic(g, c, c, [
      0, T, 38 / 360, T, 44 / 360, "rgba(255,190,90,.3)", 50 / 360, "rgba(255,190,90,.3)", 58 / 360, T,
      102 / 360, T, 110 / 360, "rgba(255,205,115,.22)", 114 / 360, "rgba(255,205,115,.22)", 122 / 360, T,
      168 / 360, T, 176 / 360, "rgba(255,180,80,.28)", 183 / 360, "rgba(255,180,80,.28)", 192 / 360, T,
      244 / 360, T, 252 / 360, "rgba(255,200,100,.24)", 256 / 360, "rgba(255,200,100,.24)", 264 / 360, T,
      316 / 360, T, 322 / 360, "rgba(255,190,90,.2)", 325 / 360, "rgba(255,190,90,.2)", 332 / 360, T, 1, T,
    ]);
    g.fillRect(0, 0, RAYS_CS, RAYS_CS);
    // maskImage: radial-gradient(circle, transparent 18%, #000 26%, transparent 64%)
    // — default farthest-corner sizing on the 420px box
    const fc = 210 * Math.SQRT2;
    g.globalCompositeOperation = "destination-in";
    const m = g.createRadialGradient(c, c, 0, c, c, fc);
    m.addColorStop(0, "rgba(0,0,0,0)"); m.addColorStop(0.18, "rgba(0,0,0,0)");
    m.addColorStop(0.26, "#000"); m.addColorStop(0.64, "rgba(0,0,0,0)"); m.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = m; g.fillRect(0, 0, RAYS_CS, RAYS_CS);
  });
  return raw(RAYS_CS, RAYS_CS, (g) => { g.filter = "blur(10px)"; g.drawImage(tmp, 0, 0); });
}

const CORONA_CS = 252; // 204 circle + blur bleed pad
function bakeCorona() {
  const tmp = raw(CORONA_CS, CORONA_CS, (g) => {
    const c = CORONA_CS / 2;
    g.beginPath(); g.arc(c, c, 102, 0, 7); g.clip(); // border-radius:50%
    g.fillStyle = conic(g, c, c, [
      0, "rgba(255,150,50,.5)", 0.12, "rgba(255,200,90,.06)", 0.24, "rgba(255,170,60,.45)",
      0.38, "rgba(255,210,110,.08)", 0.52, "rgba(255,150,50,.5)", 0.66, "rgba(255,200,90,.06)",
      0.78, "rgba(255,170,60,.42)", 0.9, "rgba(255,210,110,.08)", 1, "rgba(255,150,50,.5)",
    ]);
    g.fillRect(0, 0, CORONA_CS, CORONA_CS);
  });
  return raw(CORONA_CS, CORONA_CS, (g) => { g.filter = "blur(14px)"; g.drawImage(tmp, 0, 0); });
}

// glow disc: radial gradient (farthest-corner stops) clipped to its circle,
// statically blurred. stops = [pos, color, ...]; size = the CSS box.
function bakeGlow(size, blur, stops) {
  const cs = size + blur * 4; // bleed pad
  const tmp = raw(cs, cs, (g) => {
    const c = cs / 2, fc = (size / 2) * Math.SQRT2;
    g.beginPath(); g.arc(c, c, size / 2, 0, 7); g.clip();
    const grad = g.createRadialGradient(c, c, 0, c, c, fc);
    for (let i = 0; i < stops.length; i += 2) grad.addColorStop(stops[i], stops[i + 1]);
    g.fillStyle = grad; g.fillRect(0, 0, cs, cs);
  });
  const canvas = raw(cs, cs, (g) => { g.filter = `blur(${blur}px)`; g.drawImage(tmp, 0, 0); });
  return { canvas, cs };
}

// ── planets (sizes / gradients / shadows verbatim from SpaceBackground) ────
// off = planet-center offset from the orbit wheel's center, from the CSS
// left/top/right/bottom box math. odur/sdur = orbit / self-spin periods.
const PLANETS = [
  { odur: 13, orev: 0, d: 14, off: [-130, 7], sdur: 6, srev: 0, c: ["#cfd2da", "#6f7585", "#3c4150"], cp: 0.7, sh: [-3, -2, 6, 0.55] },
  { odur: 20, orev: 1, d: 20, off: [10, -190], sdur: 9, srev: 1, c: ["#f0d3a8", "#b98a4e", "#6b4a22"], cp: 0.65, sh: [-4, -3, 7, 0.55] },
  { odur: 30, orev: 0, d: 26, off: [260, -7.8], sdur: 8, srev: 0, c: ["#bdd4f5", "#4f6ea6", "#253a63"], cp: 0.65, sh: [-5, -3, 8, 0.6], hi: 1 },
  { odur: 42, orev: 1, d: 24, off: [-178.4, -340], sdur: 11, srev: 0, c: ["#f4b09a", "#b55f42", "#63301f"], cp: 0.65, sh: [-4, -3, 8, 0.6] },
  { odur: 58, orev: 0, d: 40, off: [340, -324], sdur: 14, srev: 0, c: ["#ecd2a8", "#a3763e", "#57390f"], cp: 0.65, sh: [-7, -5, 12, 0.6], ring: 1 },
  { odur: 80, orev: 1, d: 30, off: [-359.4, 471], sdur: 10, srev: 1, c: ["#b5e6d6", "#4d8f7a", "#234a3d"], cp: 0.65, sh: [-5, -4, 9, 0.6] },
  { odur: 105, orev: 0, d: 22, off: [73, -620], sdur: 11, srev: 0, c: ["#cdb9ec", "#7a5fae", "#3e2d63"], cp: 0.65, sh: [-4, -3, 8, 0.6] },
];

function bakePlanet(p) {
  const pad = p.ring ? 30 : 4; // the ringed one needs room for the ring span
  const cs = p.d + pad * 2;
  const canvas = raw(cs * 2, cs * 2, (g) => {
    const D = 2, c = cs, R = (p.d * D) / 2;
    // radial-gradient(circle at 32% 28%, c1, c2 cp, c3) — farthest-corner
    const gx = c - R + 0.32 * p.d * D, gy = c - R + 0.28 * p.d * D;
    const grad = g.createRadialGradient(gx, gy, 0, gx, gy, 0.9904 * p.d * D);
    grad.addColorStop(0, p.c[0]); grad.addColorStop(p.cp, p.c[1]); grad.addColorStop(1, p.c[2]);
    g.fillStyle = grad;
    g.beginPath(); g.arc(c, c, R, 0, 7); g.fill();
    // inset box-shadow ox oy b: dark fill of everything outside the circle
    // shifted by the offset, blurred (σ=b/2 → filter blur(b/2), = b at 2x)
    const [ox, oy, blur, sa] = p.sh;
    g.save();
    g.beginPath(); g.arc(c, c, R, 0, 7); g.clip();
    g.filter = `blur(${blur}px)`;
    g.beginPath();
    g.rect(-c, -c, cs * D + c * 2, cs * D + c * 2);
    g.arc(c + ox * D, c + oy * D, R, 0, 7);
    g.fillStyle = `rgba(0,0,0,${sa})`;
    g.fill("evenodd");
    g.restore();
    if (p.hi) { // highlight span: 8x5 ellipse at (3,3), white .35, blur(1px)
      g.save(); g.filter = "blur(2px)"; g.fillStyle = "rgba(255,255,255,.35)";
      g.beginPath(); g.ellipse(c - R + 7 * D, c - R + 5.5 * D, 4 * D, 2.5 * D, 0, 0, 7); g.fill();
      g.restore();
    }
    if (p.ring) { // 66x10 + 2px border ⇒ centerline ellipse 34x6, rot −18°,
      // its box center sits (+2,+2) off the planet's (left:-13/top:15 math)
      g.save(); g.translate(c + 2 * D, c + 2 * D); g.rotate(-18 * DEG);
      g.strokeStyle = "rgba(220,195,150,.45)"; g.lineWidth = 2 * D;
      g.beginPath(); g.ellipse(0, 0, 34 * D, 6 * D, 0, 0, 7); g.stroke();
      g.restore();
    }
  });
  return { canvas, cs };
}

// shooting star streak: linear-gradient(90deg, color, transparent), w×2px
const bakeStreak = (w, col, colT) => raw(w * 2, 4, (g) => {
  const grad = g.createLinearGradient(0, 0, w * 2, 0);
  grad.addColorStop(0, col); grad.addColorStop(1, colT);
  g.fillStyle = grad; g.fillRect(0, 0, w * 2, 4);
});

// vignette: radial-gradient(120% 82% at 50% 42%, transparent 42%, rgba(3,4,7,.7))
// baked on a normalized square (all lengths are %), stretched to the screen
function bakeVignette() {
  const N = 512;
  return raw(N, N, (g) => {
    const rx = 1.2 * N, ry = 0.82 * N;
    g.translate(0.5 * N, 0.42 * N); g.scale(1, ry / rx);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    grad.addColorStop(0, "rgba(3,4,7,0)"); grad.addColorStop(0.42, "rgba(3,4,7,0)");
    grad.addColorStop(1, "rgba(3,4,7,.7)");
    g.fillStyle = grad; g.fillRect(-N, -N * 2, N * 2, N * 4);
  });
}

const SHOOT_ROT = 148 * DEG;
const SHOOT_DX = Math.cos(SHOOT_ROT), SHOOT_DY = Math.sin(SHOOT_ROT);
// mnShoot: translateX 0→820 over the 0–9% window, opacity 0→.9 (2%) →0 (9%)
function shootFrame(s, local, period) {
  if (local < 0) { s.visible = false; return; } // initial animation-delay
  const p = (local / period) % 1;
  if (p >= 0.09) { s.visible = false; return; }
  s.visible = true;
  const d = 820 * (p / 0.09);
  s.position.set(s._bx + SHOOT_DX * d, s._by + SHOOT_DY * d);
  s.alpha = p < 0.02 ? 0.9 * (p / 0.02) : 0.9 * (1 - (p - 0.02) / 0.07);
}

export async function createSkyScene({ wrap, fastDur = 12, onLost }) {
  // sky renders at 0.75x internal resolution: it is all soft gradients, the
  // upscale is invisible, and full-screen fill drops ~44%
  const { app, fit: appFit, destroy: destroyApp } = await createPixiApp({ wrap, onLost, resolutionScale: 0.75 });

  let destroyed = false;
  const ownTex = [];
  const own = (t) => { ownTex.push(t); return t; };

  // ── textures ─────────────────────────────────────────────────────────────
  const deepTex = own(textureFromCanvas(bakeStarTile(260, "rgba(255,255,255,.55)", 1, 1.7)));
  const fastTex = own(textureFromCanvas(bakeStarTile(420, "rgba(255,255,255,.7)", 1, 1.5)));
  const dotTex = own(textureFromCanvas(bakeDot()));
  const raysTex = own(textureFromCanvas(bakeRays()));
  const coronaTex = own(textureFromCanvas(bakeCorona()));
  const halo = bakeGlow(224, 9, [0, "rgba(255,175,75,0)", 0.34, "rgba(255,175,75,0)", 0.42, "rgba(255,175,75,.32)", 0.56, "rgba(255,145,55,.12)", 0.7, "rgba(255,145,55,0)", 1, "rgba(255,145,55,0)"]);
  const glowB = bakeGlow(176, 9, [0, "rgba(255,140,50,.55)", 0.6, "rgba(255,150,60,.15)", 0.72, "rgba(255,150,60,0)", 1, "rgba(255,150,60,0)"]);
  const glowA = bakeGlow(160, 6, [0, "rgba(255,220,140,.5)", 0.7, "rgba(255,220,140,0)", 1, "rgba(255,220,140,0)"]);
  const haloTex = own(textureFromCanvas(halo.canvas));
  const glowBTex = own(textureFromCanvas(glowB.canvas));
  const glowATex = own(textureFromCanvas(glowA.canvas));
  const vignetteTex = own(textureFromCanvas(bakeVignette()));
  const streak1Tex = own(textureFromCanvas(bakeStreak(150, "rgba(255,255,255,.95)", "rgba(255,255,255,0)")));
  const streak2Tex = own(textureFromCanvas(bakeStreak(120, "rgba(240,217,154,.9)", "rgba(240,217,154,0)")));

  // ── the sun video (alpha webm) as a live WebGL texture ───────────────────
  // same file + cache-buster as the CSS path; muted looping element, kept
  // playing by the same pragmatic handlers, paused whenever the page hides.
  const vid = document.createElement("video");
  vid.muted = true; vid.defaultMuted = true; vid.loop = true;
  vid.playsInline = true; vid.setAttribute("playsinline", "");
  vid.preload = "auto"; vid.autoplay = true;
  vid.src = "/space/sun.webm?v=6";
  // The VideoSource is created only once the element ALREADY has data:
  // constructed earlier (autoLoad), its internal ready-promise outlives a
  // StrictMode unmount and dereferences the destroyed source — the uncaught
  // "null.videoWidth" rejection. With data present there is no pending
  // promise to orphan.
  let sunTex = null;
  const onSunReady = () => {
    vid.removeEventListener("canplay", onSunReady);
    if (destroyed) return;
    sunTex = own(new Texture({
      // updateFPS 0 → requestVideoFrameCallback: one texture upload per real
      // ~30fps video frame, not per rendered frame
      source: new VideoSource({ resource: vid, autoLoad: false, autoPlay: false, updateFPS: 0, muted: true, loop: true, playsinline: true }),
    }));
    sunSpr.texture = sunTex;
  };
  if (vid.readyState >= 3) onSunReady();
  else vid.addEventListener("canplay", onSunReady);
  const onPause = () => { if (!destroyed && !document.hidden) vid.play().catch(() => {}); };
  vid.addEventListener("pause", onPause);
  const boot = () => { if (!destroyed && !document.hidden) vid.play().catch(() => {}); };
  document.addEventListener("pointerdown", boot);
  vid.play().catch(() => {});

  // ── scene graph (paint order = the CSS DOM order) ────────────────────────
  const stage = app.stage;
  const camC = stage.addChild(new Container()); // the fx-cam static pose

  const deep = camC.addChild(new TilingSprite({ texture: deepTex }));
  deep.alpha = 0.5;

  const twinkleC = camC.addChild(new Container());
  const TWINKLES = [
    [0.15, 0.22, 0xf0d99a, 0.55], [0.68, 0.14, 0xffffff, 0.45], [0.84, 0.66, 0x2ee6a6, 0.4],
    [0.32, 0.8, 0xf0d99a, 0.45], [0.52, 0.46, 0xffffff, 0.3],
  ];
  const twinkles = TWINKLES.map(([, , tint, a]) => {
    const s = twinkleC.addChild(new Sprite(dotTex));
    s.anchor.set(0.5); s.width = s.height = 6; s.tint = tint; s.alpha = a;
    return s;
  });

  const solarC = camC.addChild(new Container()); // drifts on bjSunDrift
  const raysSpr = solarC.addChild(new Sprite(raysTex));
  raysSpr.anchor.set(0.5);
  const haloSpr = solarC.addChild(new Sprite(haloTex));
  haloSpr.anchor.set(0.5);
  const coronaSpr = solarC.addChild(new Sprite(coronaTex));
  coronaSpr.anchor.set(0.5); coronaSpr.width = coronaSpr.height = CORONA_CS;
  const glowBSpr = solarC.addChild(new Sprite(glowBTex));
  glowBSpr.anchor.set(0.5);
  const glowASpr = solarC.addChild(new Sprite(glowATex));
  glowASpr.anchor.set(0.5);
  const sunSpr = solarC.addChild(new Sprite(Texture.EMPTY)); // video texture arrives on canplay
  sunSpr.anchor.set(0.5); sunSpr.visible = false; // shown at first decoded frame
  let sunSized = false;

  const planets = PLANETS.map((p) => {
    const wheel = solarC.addChild(new Container());
    const { canvas, cs } = bakePlanet(p);
    const spr = wheel.addChild(new Sprite(own(textureFromCanvas(canvas))));
    spr.anchor.set(0.5); spr.width = spr.height = cs;
    spr.position.set(p.off[0], p.off[1]);
    return { wheel, spr, ov: (p.orev ? -1 : 1) * (TAU / p.odur), sv: (p.srev ? -1 : 1) * (TAU / p.sdur) };
  });

  const fast = camC.addChild(new TilingSprite({ texture: fastTex })); // over the sun, like the CSS
  fast.alpha = 0.55;

  const shoot1 = stage.addChild(new Sprite(streak1Tex)); // outside the cam rig
  const shoot2 = stage.addChild(new Sprite(streak2Tex));
  for (const s of [shoot1, shoot2]) { s.anchor.set(0.5); s.rotation = SHOOT_ROT; s.visible = false; }
  shoot1.width = 150; shoot1.height = 2;
  shoot2.width = 120; shoot2.height = 2;

  const vignette = stage.addChild(new Sprite(vignetteTex));

  // ── layout (screen-size dependent; fit-time only) ────────────────────────
  const L = { W: 0, H: 0, solarX: 0, solarY: 0 };
  function layout() {
    const W = app.screen.width, H = app.screen.height;
    L.W = W; L.H = H;
    // the fx-cam rig box: inset -6% around the viewport
    const rigX = -0.06 * W, rigY = -0.06 * H, rigW = 1.12 * W, rigH = 1.12 * H;
    camMatrix.set(CAM.a, CAM.b, CAM.c, CAM.d,
      W / 2 - CAM.a * (W / 2) - CAM.c * (H / 2),
      H / 2 - CAM.b * (W / 2) - CAM.d * (H / 2));
    camC.setFromMatrix(camMatrix);
    deep.position.set(rigX, rigY); deep.setSize(rigW, rigH);
    fast.position.set(rigX, rigY); fast.setSize(rigW, rigH);
    for (let i = 0; i < twinkles.length; i++) {
      // per-position perspective divide: place at p/w, scale by 1/w — the
      // exact CSS screen spot (up to ~65px off under the old affine drop)
      const rx = rigX + TWINKLES[i][0] * rigW - W / 2;
      const ry = rigY + TWINKLES[i][1] * rigH - H / 2;
      const tw = camW(rx, ry);
      twinkles[i].position.set(W / 2 + rx / tw, H / 2 + ry / tw);
      twinkles[i].width = twinkles[i].height = 6 / tw;
    }
    L.solarX = rigX + 0.84 * rigW; // the solar system's 84% / 26% anchor
    L.solarY = rigY + 0.26 * rigH;
    shoot1._bx = 0.72 * W + 75; shoot1._by = 0.08 * H + 1;
    shoot2._bx = 0.34 * W + 60; shoot2._by = 0.02 * H + 1;
    vignette.setSize(W, H);
  }
  layout();

  // ── the frame loop (this scene's own; nothing else drives a rAF here) ────
  function update(t) {
    const pd = (t / 16) % 1;                     // kbTile260: one tile down-right / 16s
    deep.tilePosition.set(pd * 260, pd * 260);
    const pf = (t / fastDur) % 1;                // kbTile420: one tile down-left
    fast.tilePosition.set(-pf * 420, pf * 420);
    // the layer's opacity:.5 is dead CSS — the running animation overrides it
    twinkleC.alpha = kf(K_TWINKLE, (t / 5.5) % 1);

    const dp = (t / 70) % 1;                     // bjSunDrift waypoints (vw/vh)
    // the divide follows the drift: z changes with x, so the CSS sun both
    // shifts AND breathes ~±4% in size across its journey — reproduce both
    const sqx = L.solarX + kf(K_DRIFT_X, dp) * L.W - L.W / 2;
    const sqy = L.solarY + kf(K_DRIFT_Y, dp) * L.H - L.H / 2;
    const sw = camW(sqx, sqy);
    solarC.position.set(L.W / 2 + sqx / sw, L.H / 2 + sqy / sw);
    solarC.scale.set(1 / sw);

    raysSpr.rotation = ((t / 60) % 1) * TAU;
    const rp = (t / 7.3) % 1;
    raysSpr.alpha = kf(K_RAYS_O, rp);
    raysSpr.width = raysSpr.height = RAYS_CS * kf(K_RAYS_S, rp);

    const hp = (t / 3) % 1;                      // bjSunBurn 3s
    haloSpr.alpha = kf(K_BURN_O, hp);
    haloSpr.width = haloSpr.height = halo.cs * kf(K_BURN_S, hp);
    coronaSpr.rotation = ((t / 15) % 1) * TAU;
    coronaSpr.alpha = kf(K_CORONA, (t / 4.2) % 1);
    const bp = (t / 3.4) % 1;                    // bjSunBurn 3.4s
    glowBSpr.alpha = kf(K_BURN_O, bp);
    glowBSpr.width = glowBSpr.height = glowB.cs * kf(K_BURN_S, bp);
    const ap = 1 - (t / 2.1) % 1;                // bjSunBurn 2.1s reverse
    glowASpr.alpha = kf(K_BURN_O, ap);
    glowASpr.width = glowASpr.height = glowA.cs * kf(K_BURN_S, ap);

    if (!sunSized && vid.readyState >= 2 && vid.videoWidth) {
      // object-fit: contain in the 300×300 box (scale is texture-pixel = video-pixel)
      sunSpr.scale.set(Math.min(300 / vid.videoWidth, 300 / vid.videoHeight));
      sunSpr.visible = true;
      sunSized = true;
    }

    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      p.wheel.rotation = t * p.ov;
      p.spr.rotation = t * p.sv;
    }

    shootFrame(shoot1, t, 14);
    shootFrame(shoot2, t - 8, 23);               // 8s animation-delay
  }

  let raf = 0;
  const t0 = performance.now();
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    update((now - t0) / 1000);
    app.renderer.render(app.stage);
  };
  raf = requestAnimationFrame(tick);

  // paused ENTIRELY while hidden: no rAF, and the video stops decoding too.
  // Time is wall-clock, so on return everything has drifted on — exactly
  // like the CSS animations it replaces.
  const onVis = () => {
    if (destroyed) return;
    if (document.hidden) {
      cancelAnimationFrame(raf); raf = 0;
      vid.pause();
    } else {
      vid.play().catch(() => {});
      if (!raf) raf = requestAnimationFrame(tick);
    }
  };
  document.addEventListener("visibilitychange", onVis);

  function fit() {
    if (destroyed) return;
    appFit();
    layout();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf); raf = 0;
    document.removeEventListener("visibilitychange", onVis);
    document.removeEventListener("pointerdown", boot);
    vid.removeEventListener("pause", onPause);
    vid.removeEventListener("canplay", onSunReady);
    vid.pause();
    destroyApp();                    // watchdog + listeners + canvas + stage
    for (const t of ownTex) t.destroy(true); // incl. sunTex → its VideoSource
    vid.removeAttribute("src"); vid.load();  // release the decoder
  }

  return { kind: "webgl", fit, destroy };
}
