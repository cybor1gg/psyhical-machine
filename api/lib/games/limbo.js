// Limbo rules — pure functions, no I/O.
//
// One roll produces a RESULT multiplier with the crash-style 1/x
// distribution:
//
//   result = truncate((1 − houseEdge) / (1 − float), 2)      (min 1.00)
//
// float is uniform in [0,1), so (1 − float) is uniform in (0,1] and
// P(result ≥ T) = (1 − houseEdge) / T for any target T. The player wins
// bet × T when result ≥ T, hence RTP = (1 − houseEdge) at every target —
// which is why this game's RTP is operator-configurable.
//
// The target is capped by GameConfig.maxWinMultiplier (liability cap), and
// the DISPLAYED result is capped at the same number so the UI never shows a
// multiplier the game could not pay.
//
// DRAW ORDER (published): nonce n → the roll. Nothing else is drawn.

import { truncate } from "../money.js";

export const MIN_TARGET = 1.01;

export function resultFromFloat(f, houseEdge, maxWinMultiplier = Infinity) {
  const raw = (1 - houseEdge) / (1 - f); // 1-f ∈ (0,1] — never divides by zero
  return Math.min(Math.max(1, truncate(raw, 2)), maxWinMultiplier);
}

export function winChance(target, houseEdge) {
  return Math.min(1, (1 - houseEdge) / target);
}

// Validate + normalise a client target to 2 dp.
export function parseTarget(raw, maxWinMultiplier) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const t = truncate(n, 2);
  if (t < MIN_TARGET || t > maxWinMultiplier) return null;
  return t;
}
