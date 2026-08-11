// Money/multiplier truncation shared by all games.
//
// Truncate to `dp` decimals — never rounds UP (the house edge must never be
// given back), but guards against binary-float error. A bare Math.floor is
// unsafe here: 1.1581 * 10000 is 11580.999999999998 in IEEE-754, so it would
// silently shave the last digit (1.1581 -> 1.1580) and pay a cent less than
// displayed. The 1e-9 nudge is ~5 orders of magnitude smaller than one 1/10000
// step, so it can only cancel representation error, never promote a value.
export function truncate(value, dp) {
  const f = 10 ** dp;
  return Math.floor(value * f + 1e-9) / f;
}
