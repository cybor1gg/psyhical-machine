// Plinko rules — pure functions, no I/O.
//
// The ball falls through `rows` pin rows; at each row it goes left or right.
// Bucket = number of RIGHT bounces, so P(bucket k) = C(rows, k) / 2^rows —
// the exact binomial distribution, no physics fakery: the PATH the client
// animates is derived from the same rolls that decided the bucket.
//
// PROVABLY FAIR — one nonce per row:
//   direction_i = floor(roll_i × 2)   (0 = left, 1 = right)
//   bucket      = Σ direction_i
//
// PAYOUTS: the design-system tables give each bucket's flavour (edges huge,
// centre small). We rescale every table so its EXACT EV equals (1 − edge):
//   scaled_k = raw_k × (1 − edge) / rawEV
// then truncate to 4 dp (truncation can only push EV a hair BELOW target,
// never above) and clamp to maxWinMultiplier. RTP = 1 − houseEdge at every
// rows/risk choice — which is why this game's RTP is operator-configurable.

import { truncate } from "../money.js";

export const MIN_ROWS = 8;
export const MAX_ROWS = 16;
export const RISKS = ["low", "medium", "high"];

export const RAW_TABLES = {
  8:  { low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6], medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13], high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29] },
  9:  { low: [5.6, 2, 1.6, 1, 0.7, 0.7, 1, 1.6, 2, 5.6], medium: [18, 4, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4, 18], high: [43, 7, 2, 0.6, 0.2, 0.2, 0.6, 2, 7, 43] },
  10: { low: [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9], medium: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22], high: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76] },
  11: { low: [8.4, 3, 1.9, 1.3, 1, 0.7, 0.7, 1, 1.3, 1.9, 3, 8.4], medium: [24, 6, 3, 1.8, 0.7, 0.5, 0.5, 0.7, 1.8, 3, 6, 24], high: [120, 14, 5.2, 1.4, 0.4, 0.2, 0.2, 0.4, 1.4, 5.2, 14, 120] },
  12: { low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10], medium: [24, 5, 3, 1.6, 0.9, 0.7, 0.5, 0.7, 0.9, 1.6, 3, 5, 24], high: [58, 8, 3, 2, 0.7, 0.3, 0.2, 0.3, 0.7, 2, 3, 8, 58] },
  13: { low: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7, 0.7, 0.9, 1.2, 1.9, 3, 4, 8.1], medium: [43, 13, 6, 3, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3, 6, 13, 43], high: [260, 37, 11, 4, 1, 0.2, 0.2, 0.2, 0.2, 1, 4, 11, 37, 260] },
  14: { low: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.4, 1.9, 4, 7.1], medium: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58], high: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420] },
  15: { low: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7, 0.7, 1, 1.1, 1.5, 2, 3, 8, 15], medium: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3, 0.3, 0.5, 1.3, 3, 5, 11, 18, 88], high: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2, 0.2, 0.2, 0.5, 3, 8, 27, 83, 620] },
  16: { low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16], medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110], high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000] },
};

// C(n, k) — small n, exact in doubles.
export function binom(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - i + 1)) / i;
  return r;
}

export function bucketProbability(rows, k) {
  return binom(rows, k) / Math.pow(2, rows);
}

export function rawEV(rows, risk) {
  const t = RAW_TABLES[rows][risk];
  return t.reduce((s, m, k) => s + m * bucketProbability(rows, k), 0);
}

// The table a round actually pays — exact-EV scaled to (1 − edge).
export function scaledTable(rows, risk, houseEdge, maxWinMultiplier = Infinity) {
  const scale = (1 - houseEdge) / rawEV(rows, risk);
  return RAW_TABLES[rows][risk].map((m) => Math.min(truncate(m * scale, 4), maxWinMultiplier));
}

// rolls (floats, one per row) → per-row directions and the landing bucket.
export function pathFromRolls(rolls) {
  const directions = rolls.map((f) => Math.floor(f * 2)); // 0 = left, 1 = right
  return { directions, bucket: directions.reduce((s, d) => s + d, 0) };
}

export function parseRows(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_ROWS || n > MAX_ROWS) return null;
  return n;
}

export function parseRisk(raw) {
  return RISKS.includes(raw) ? raw : null;
}
