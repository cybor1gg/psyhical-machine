// Chicken Cross rules — pure functions, no I/O.
//
// The road has `lanes` traffic lanes (set by difficulty). The chicken crosses
// left to right, one lane per step; each lane is either clear or deadly. Cross
// a clear lane to grow the multiplier, step into a deadly one to bust. Cash
// out any time after the first lane; crossing ALL lanes auto-cashes at the
// final rung.
//
// PROVABLY FAIR LAYOUT — one nonce per lane:
//
//   roll   = HMAC_SHA256(serverSeed, clientSeed:nonce) → float in [0,1)
//   deadly = roll < death           (death chance set by difficulty)
//
// Lanes are independent, every arrangement is equally likely, and anyone can
// recompute the whole road from the revealed seed with one comparison per lane.
//
// DRAW ORDER (published): nonce n = lane 1 (leftmost), n+1 = lane 2,
// … n+lanes−1 = the final lane. All lanes are committed in one atomic claim
// at bet time and kept server-side until the round settles.
//
// Difficulties match the design system's Chicken Cross exactly:
//   easy 24 lanes / 5% death · medium 22 / 12% · hard 18 / 24% · daredevil 13 / 45%
//
// MULTIPLIER after crossing n lanes = truncate((1 − edge) / (1 − death)^n, 2)
// — the cumulative survival odds priced to (1 − edge), truncated toward zero
// (never rounded up) and clamped to the liability cap. EV of cashing at any
// lane = P(survive n) × m(n) ≤ 1 − houseEdge, so RTP = 1 − houseEdge at every
// cashout point on every difficulty — which is why this game's RTP is
// operator-configurable.

import { truncate } from "../money.js";

export const DIFFICULTIES = {
  easy:      { lanes: 24, death: 0.05 },
  medium:    { lanes: 22, death: 0.12 },
  hard:      { lanes: 18, death: 0.24 },
  daredevil: { lanes: 13, death: 0.45 },
};

// How many lanes a difficulty's road has.
export function lanesFor(difficulty) {
  return DIFFICULTIES[difficulty].lanes;
}

// Is a lane deadly? Exactly `death` of the roll space — one comparison.
export function laneDeadly(roll, death) {
  return roll < death;
}

// The full multiplier ladder (index i = multiplier after crossing i+1 lanes):
// cumulative survival odds priced to (1 − edge), truncated to 2 decimals and
// clamped to the liability cap so the UI never promises more than the round
// can pay.
export function ladder(difficulty, houseEdge, maxWinMultiplier = Infinity) {
  const { lanes, death } = DIFFICULTIES[difficulty];
  const s = 1 - death;
  const out = [];
  for (let n = 1; n <= lanes; n++) {
    out.push(Math.min(truncate((1 - houseEdge) / Math.pow(s, n), 2), maxWinMultiplier));
  }
  return out;
}

// Missing difficulty defaults to "easy" (the verifier's convention);
// anything else must name a real difficulty or it's a caller error (null).
export function parseDifficulty(raw) {
  if (raw === undefined || raw === null) return "easy";
  return DIFFICULTIES[raw] ? raw : null;
}
