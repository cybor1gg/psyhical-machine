// STAR LANDER — the gravity crash game from the design handoff. The player
// bets, presses LAUNCH, and the ship flies fully autonomously: it sinks
// under gravity, gems boost it up and grow the counter (+1 +2 x2 x3 x5),
// plasma mines halve the counter and shove it down. Reach the docking
// station and the counter pays; touch the void first and the bet is lost.
// THE OUTCOME IS EMERGENT FROM PHYSICS, not pre-scripted: the server draws
// the event map from the provably-fair chain and runs the exact
// deterministic simulation the client replays (lander-physics.js, one file,
// two copies). Nothing is decided on the client.
//
// THE RTP DIAL is the design's own `generosity` prop (gem density). There is
// no closed form over a physics sim, so the dial is a MEASURED curve:
// EV(generosity) anchors below come from Monte Carlo over the real
// simulation, and generosityFor() interpolates the edge onto it. Re-measure
// whenever any physics constant or spawn rule changes:
//   node scripts/lander-rtp.mjs 300000 <generosity>
import { getGameConfig } from "../config.js";
import { generateMap, simulate, PHYS } from "./lander-physics.js";

// measured EV anchors: [generosity, expected return per 1 bet] — each is
// 2M pooled rounds (8 independent 250k-seed streams) over the real
// simulation (scripts/lander-rtp.mjs), high-drama profile: hot multiplier
// gems, minefield gauntlet on final approach, counter cap 500. At the
// stock 3.5% edge the dial sits at gen ≈ 0.71 — landings ~1-in-15, mean
// flight ~12.3s of sim, a fifth of all flights peak past x20 mid-air and
// ~1-in-23 passes x100. The x80+ tail makes single 250k streams ±2%, so
// only POOLED multi-seed numbers are meaningful here.
// the two anchors bracketing the stock dial are DEFINITIVE: 8M pooled
// rounds each (16 seeds x 500k) — the stock dial interpolates only
// between them. Outer anchors (2M pooled each) serve operator overrides.
export const EV_ANCHORS = [
  [0.55, 0.6607],
  [0.62, 0.7783],
  [0.70, 0.9387],
  [0.73, 1.0165],
  [0.78, 1.1639],
  [0.85, 1.3225],
];

/** the generosity that returns exactly (1 - houseEdge), off the measured curve */
export function generosityFor(houseEdge) {
  const target = 1 - houseEdge;
  const A = EV_ANCHORS;
  if (target <= A[0][1]) return A[0][0];
  for (let i = 1; i < A.length; i++) {
    if (target <= A[i][1]) {
      const [g0, e0] = A[i - 1], [g1, e1] = A[i];
      return g0 + ((target - e0) / (e1 - e0)) * (g1 - g0);
    }
  }
  return A[A.length - 1][0];
}

/** One full round: map from the roll stream, outcome from the simulation. */
export function playRound({ next, houseEdge, maxWinMultiplier = PHYS.COUNTER_CAP }) {
  const gen = generosityFor(houseEdge);
  const map = generateMap(next, gen);
  const result = simulate(map);
  const mult = Math.min(result.multiplier, maxWinMultiplier);
  return { map, ...result, multiplier: mult };
}

/** What the client may know before betting — published on /table. */
export async function landerTable() {
  const config = await getGameConfig("lander");
  return {
    gems: ["+1", "+2", "x2", "x3", "x5"],
    generosity: Math.round(generosityFor(config.houseEdge) * 1000) / 1000,
    maxWinMultiplier: config.maxWinMultiplier ?? PHYS.COUNTER_CAP,
    minBet: config.minBet,
    maxBet: config.maxBet,
    rtp: 1 - config.houseEdge,
  };
}
