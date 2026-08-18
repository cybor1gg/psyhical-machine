// STAR LANDER's flight physics — THE shared deterministic core.
// >>> THIS IS THE CLIENT COPY of api/lib/games/lander-physics.js <<<
// >>> Never edit here alone: change the api file and re-copy.     <<<
//
// This exact file is COPIED to web/src/space/landerPhysics.js. The server
// simulates a round to settle it; the client re-simulates the same map for
// the picture. Both must agree to the last bit, so:
//   • everything runs in a CANONICAL 500-unit-tall space (the design's
//     k = h/500 with k pinned to 1) — canvas size never touches outcomes
//   • fixed timestep (1/120s); speed modes consume MORE STEPS PER FRAME,
//     never a different dt, so every speed replays the identical flight
//   • only arithmetic and Math.exp/atan2 on V8 both sides — bit-stable
// If you edit one copy, edit the other. The frame comes from the design
// handoff (design_handoff_star_lander/README.md), but the numbers are OUR
// MEASURED long-flight profile: the handoff's constants killed most flights
// inside 6 seconds, so gravity is soft (58, terminal 95), worlds run
// 4200-6300 units, the launch climbs near the ceiling, and the gem mix is
// tamed (multiplier gems rarer) with 7-11 mines to bleed the counter the
// extra hang-time grows. Measured result: ~10.5s mean flight, landings
// ~1-in-10, EV curve crossing 96.5% at generosity ~0.40 (dense fields).
// Re-run scripts/lander-rtp.mjs after ANY change here.
export const PHYS = {
  H: 500,                 // canonical world height
  DT: 1 / 120,            // fixed timestep, seconds
  SPEED_X: 300,           // horizontal px/s
  GRAV: 58,
  TERM_FALL: 95,
  LAUNCH_Y: 0.62 * 500,
  LAUNCH_VY: -160,
  CEIL: 34,
  VOID_Y: 0.84 * 500,     // crash at y >= VOID_Y - 8 before the final zone
  PAD_Y: 0.66 * 500,
  FINAL_ZONE: 220,        // inside len-220 the ship is safe and eases down
  MINE_VY: 175,
  MINE_DRAG: 0.45,        // horizontal slow, decaying exp(-1.4/s)
  HIT_X: 34,
  HIT_Y: 60,
  BOOST: { "+1": 90, "+2": 108, "x2": 128, "x3": 148, "x5": 172 },
  COUNTER_CAP: 250,
  MAX_SIM_S: 60,          // hard guard; a round is ~18-26s of sim time
};

/**
 * The event map, drawn entirely from `next()` (floats in [0,1)) — on the
 * server that is the provably-fair chain. `generosity` is the RTP dial
 * (0.1–0.9): it thins or thickens the gem field, exactly the prototype's
 * landChance prop.
 */
export function generateMap(next, generosity) {
  const gen = Math.min(0.9, Math.max(0.1, generosity));
  const len = 4200 + next() * 2100;
  const ev = [];
  for (let x = 520; x < len - 500; x += 240 + next() * 170) {
    if (next() < 0.42 - gen * 0.35) continue;
    const r = next();
    const t = r < 0.50 ? "+1" : r < 0.76 ? "+2" : r < 0.90 ? "x2" : r < 0.97 ? "x3" : "x5";
    ev.push({ x, kind: "pick", t, yf: 0.1 + next() * 0.52 });
  }
  const nr = 7 + Math.floor(next() * 5);
  for (let i = 0; i < nr; i++) {
    ev.push({ x: 900 + next() * (len - 1400), kind: "mine", yf: 0.14 + next() * 0.5 });
  }
  ev.sort((a, b) => a.x - b.x);
  return { len, ev, gen };
}

/**
 * A step-by-step simulation of one map. The server runs it to completion in
 * a tight loop; the client consumes the SAME steps at animation pace. One
 * code path, one outcome.
 */
export function createSim(map) {
  const P = PHYS;
  const DRAG_DECAY = Math.exp(-1.4 * P.DT);     // per-step constant, both sides
  const done = new Array(map.ev.length).fill(false);
  const S = {
    wx: 0, y: P.LAUNCH_Y, vy: P.LAUNCH_VY, drag: 0,
    counter: 1, t: 0, over: false, landed: false,
    hits: [],
  };

  function step() {
    if (S.over) return null;
    S.t += P.DT;
    S.drag *= DRAG_DECAY;
    const spd = P.SPEED_X * (1 - P.MINE_DRAG * S.drag);
    S.wx += spd * P.DT;

    if (S.wx > map.len - P.FINAL_ZONE) {
      S.vy = 0;
      S.y += (P.PAD_Y - 4 - S.y) * Math.min(1, P.DT * 6);
    } else {
      S.vy = Math.min(P.TERM_FALL, S.vy + P.GRAV * P.DT);
      S.y += S.vy * P.DT;
      if (S.y < P.CEIL) { S.y = P.CEIL; S.vy = Math.max(S.vy, 0); }
    }

    let hit = null;
    for (let i = 0; i < map.ev.length; i++) {
      if (done[i]) continue;
      const e = map.ev[i];
      if (S.wx > e.x + P.HIT_Y) { done[i] = true; continue; }
      if (Math.abs(S.wx - e.x) < P.HIT_X) {
        const ey = e.yf * P.H;
        if (Math.abs(S.y - ey) < P.HIT_Y) {
          done[i] = true;
          if (e.kind === "pick") {
            if (e.t === "+1") S.counter += 1;
            else if (e.t === "+2") S.counter += 2;
            else S.counter *= Number(e.t.slice(1));
            S.counter = Math.min(P.COUNTER_CAP, Math.round(S.counter * 100) / 100);
            S.vy = -P.BOOST[e.t];
          } else {
            S.counter = Math.max(0.5, Math.round(S.counter * 50) / 100);
            S.vy = P.MINE_VY;
            S.drag = 1;
          }
          hit = { i, e, ey, counter: S.counter };
          S.hits.push({ i, t: Math.round(S.t * 1000) / 1000, counter: S.counter });
        }
      }
    }

    if (S.wx <= map.len - P.FINAL_ZONE && S.y >= P.VOID_Y - 8) { S.over = true; S.landed = false; }
    else if (S.wx >= map.len) { S.wx = map.len; S.over = true; S.landed = true; }
    if (S.t >= P.MAX_SIM_S) { S.over = true; }
    return hit;
  }

  return { S, step, map, done };
}

/** The whole flight at once — how the server settles a round. */
export function simulate(map) {
  const sim = createSim(map);
  while (!sim.S.over) sim.step();
  const S = sim.S;
  return {
    landed: S.landed,
    counter: Math.round(S.counter * 100) / 100,
    multiplier: S.landed ? Math.round(S.counter * 100) / 100 : 0,
    hits: S.hits,
    durationS: Math.round(S.t * 100) / 100,
  };
}
