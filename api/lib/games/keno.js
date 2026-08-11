// Keno rules — pure functions, no I/O.
//
// The player picks 1–10 numbers from 1..40; the house draws 10. Payout is a
// table lookup by how many picks hit. Hit counts follow the exact
// hypergeometric distribution:
//   P(h hits | p picks) = C(p, h) · C(40 − p, 10 − h) / C(40, 10)
//
// PROVABLY FAIR DRAW — 10 nonces, drawing WITHOUT replacement (the same
// removal rule as mines):
//   the i-th roll picks remaining[floor(roll_i × remaining.length)]
//   from the ascending list of numbers 1..40 not yet drawn.
//
// PAYOUTS: design-system tables (5 risk flavours × 10 pick counts), rescaled
// so each table's EXACT EV equals (1 − edge):
//   scaled_h = raw_h × (1 − edge) / rawEV(risk, picks)
// truncated to 4 dp (EV can only land a hair BELOW target, never above) and
// clamped to maxWinMultiplier. RTP = 1 − houseEdge at every risk/pick-count —
// which is why this game's RTP is operator-configurable.

import { truncate } from "../money.js";
import { binom } from "./plinko.js";

export const NUMBERS = 40;
export const DRAWS = 10;
export const MAX_PICKS = 10;
export const RISKS = ["classic", "low", "medium", "high", "extreme"];

export const RAW_TABLES = {
  classic: {
    1: [0, 3.6], 2: [0, 1.5, 9], 3: [0, 1, 3, 25], 4: [0, 0.5, 2, 8, 55],
    5: [0, 0.5, 1.5, 4, 14, 80], 6: [0, 0.5, 1, 3, 8, 30, 95],
    7: [0, 0.5, 1, 2, 5, 15, 50, 100], 8: [0, 0.5, 1, 1.5, 3, 8, 25, 70, 100],
    9: [0, 0.5, 1, 1.2, 2, 4, 12, 35, 80, 100], 10: [0, 0, 1, 1.2, 1.5, 2.5, 6, 18, 45, 90, 100],
  },
  low: {
    1: [0, 1.85], 2: [0, 2, 3.8], 3: [0, 1.1, 1.38, 26], 4: [0, 0, 2.2, 7.9, 90],
    5: [0, 0, 1.5, 4.2, 13, 300], 6: [0, 0, 1.1, 2, 6.2, 100, 700],
    7: [0, 0, 1.1, 1.6, 3.5, 15, 225, 700], 8: [0, 0, 1.1, 1.5, 2, 5.5, 39, 100, 800],
    9: [0, 0, 1.1, 1.3, 1.7, 2.5, 7.5, 50, 250, 1000], 10: [0, 0, 1.1, 1.2, 1.3, 1.8, 3.5, 13, 50, 250, 1000],
  },
  medium: {
    1: [0, 1.9], 2: [0, 1.8, 5.1], 3: [0, 0, 2.8, 50], 4: [0, 0, 1.7, 10, 100],
    5: [0, 0, 1.4, 4, 14, 390], 6: [0, 0, 0, 3, 9, 180, 710],
    7: [0, 0, 0, 2, 7, 30, 400, 800], 8: [0, 0, 0, 2, 4, 11, 67, 400, 900],
    9: [0, 0, 0, 2, 2.5, 5, 15, 100, 500, 1000], 10: [0, 0, 0, 1.6, 2, 4, 7, 26, 100, 500, 1000],
  },
  high: {
    1: [0, 3.96], 2: [0, 0, 17.1], 3: [0, 0, 0, 81.5], 4: [0, 0, 0, 10, 259],
    5: [0, 0, 0, 4.5, 48, 450], 6: [0, 0, 0, 0, 11, 350, 710],
    7: [0, 0, 0, 0, 7, 90, 400, 800], 8: [0, 0, 0, 0, 5, 20, 270, 600, 900],
    9: [0, 0, 0, 0, 4, 11, 56, 500, 800, 1000], 10: [0, 0, 0, 0, 3.5, 8, 13, 63, 500, 800, 1000],
  },
  extreme: {
    1: [0, 3.96], 2: [0, 0, 22], 3: [0, 0, 0, 130], 4: [0, 0, 0, 14, 500],
    5: [0, 0, 0, 5, 90, 1100], 6: [0, 0, 0, 0, 20, 700, 2400],
    7: [0, 0, 0, 0, 10, 130, 900, 3500], 8: [0, 0, 0, 0, 7, 35, 500, 1500, 5000],
    9: [0, 0, 0, 0, 5, 18, 100, 1000, 3000, 7500], 10: [0, 0, 0, 0, 4, 12, 25, 150, 1500, 5000, 10000],
  },
};

export function hitProbability(picks, hits) {
  return (binom(picks, hits) * binom(NUMBERS - picks, DRAWS - hits)) / binom(NUMBERS, DRAWS);
}

export function rawEV(risk, picks) {
  const t = RAW_TABLES[risk][picks];
  return t.reduce((s, m, h) => s + m * hitProbability(picks, h), 0);
}

// The table a round actually pays — exact-EV scaled to (1 − edge).
export function scaledTable(risk, picks, houseEdge, maxWinMultiplier = Infinity) {
  const scale = (1 - houseEdge) / rawEV(risk, picks);
  return RAW_TABLES[risk][picks].map((m) => Math.min(truncate(m * scale, 4), maxWinMultiplier));
}

// rolls (10 floats, draw order) → drawn numbers 1..40, without replacement.
export function drawnFromRolls(rolls) {
  const remaining = Array.from({ length: NUMBERS }, (_, i) => i + 1);
  return rolls.map((f) => {
    const idx = Math.floor(f * remaining.length);
    const n = remaining[idx];
    remaining.splice(idx, 1);
    return n;
  });
}

export function parseRisk(raw) {
  return RISKS.includes(raw) ? raw : null;
}

// 1–10 distinct integers in 1..40, else null.
export function parsePicks(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PICKS) return null;
  const set = new Set();
  for (const v of raw) {
    if (!Number.isInteger(v) || v < 1 || v > NUMBERS || set.has(v)) return null;
    set.add(v);
  }
  return [...set];
}
