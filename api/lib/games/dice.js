// Dice rules — pure functions, no I/O.
//
// One roll decides everything: the float from the fairness chain maps to an
// integer 0..9999, rendered as 0.00–99.99 (exactly 10,000 equally likely
// outcomes — no rounding bias at the boundaries).
//
// The player picks a TARGET (2.00–98.00) and a DIRECTION:
//   over  → win when roll >  target   (winning outcomes: 9999 − target×100)
//   under → win when roll <  target   (winning outcomes: target×100)
//
// payout multiplier = (1 − houseEdge) / winChance, truncated to 4 dp — so the
// RTP is exactly (1 − houseEdge) at every target, which is why this game's
// RTP is operator-configurable.
//
// DRAW ORDER (published): nonce n → the roll. Nothing else is drawn.

import { truncate } from "../money.js";

export const MIN_TARGET = 200;   // 2.00, in hundredths
export const MAX_TARGET = 9800;  // 98.00

// float [0,1) → integer roll 0..9999 (display: roll/100)
export function rollFromFloat(f) {
  return Math.floor(f * 10000);
}

export function winOutcomes(target100, over) {
  return over ? 9999 - target100 : target100;
}

export function winChance(target100, over) {
  return winOutcomes(target100, over) / 10000;
}

export function multiplierFor(target100, over, houseEdge, maxWinMultiplier = Infinity) {
  return Math.min(truncate((1 - houseEdge) / winChance(target100, over), 4), maxWinMultiplier);
}

export function isWin(roll100, target100, over) {
  return over ? roll100 > target100 : roll100 < target100;
}

// Validate + normalise a client target (accepts "50", 50, 49.99 → hundredths).
export function parseTarget(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const t100 = Math.round(n * 100);
  if (t100 < MIN_TARGET || t100 > MAX_TARGET) return null;
  return t100;
}
