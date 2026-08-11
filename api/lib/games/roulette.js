// European (single-zero) roulette rules — pure functions, no I/O.
//
// One nonce → pocket 0..36:  pocket = floor(roll × 37).  37 equally likely
// pockets, one green zero, so the house edge is exactly 1/37 ≈ 2.70% on
// EVERY bet type (the payouts below all pay true-odds-minus-the-zero). This
// is a RULES-priced game — the edge is the single zero, not a tunable number.
//
// DRAW ORDER (published): nonce n → the winning pocket. Nothing else drawn.
//
// A round can carry many simultaneous bets (a chip on red, a chip on 17, …).
// Each bet returns `mult × its stake` on a win (mult INCLUDES the stake), 0
// otherwise; total payout is the sum. All bet shapes are validated server-
// side — the client can't invent a bet type or an oversized multiplier.

export const POCKETS = 37;
export const RED_SET = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function pocketFromRoll(roll) {
  return Math.floor(roll * POCKETS); // 0..36
}
export function isRed(n) { return RED_SET.has(n); }
export function pocketColor(n) { return n === 0 ? "green" : RED_SET.has(n) ? "red" : "black"; }

// Return multiplier (incl. stake) for a single bet given the winning pocket,
// or 0 for a loss. Straight 36×, splits/streets/corners/lines pay 36/size,
// even-money 2×, dozen/column 3×.
export function betMultiplier(bet, r) {
  switch (bet.type) {
    case "straight": return bet.n === r ? 36 : 0;
    case "red": return r !== 0 && RED_SET.has(r) ? 2 : 0;
    case "black": return r !== 0 && !RED_SET.has(r) ? 2 : 0;
    case "odd": return r !== 0 && r % 2 === 1 ? 2 : 0;
    case "even": return r !== 0 && r % 2 === 0 ? 2 : 0;
    case "low": return r >= 1 && r <= 18 ? 2 : 0;
    case "high": return r >= 19 && r <= 36 ? 2 : 0;
    case "dozen": return r >= bet.n * 12 - 11 && r <= bet.n * 12 ? 3 : 0;
    // column 1 = {1,4,..34} (r%3==1), column 2 (r%3==2), column 3 (r%3==0)
    case "column": return r !== 0 && r % 3 === (bet.n === 3 ? 0 : bet.n) ? 3 : 0;
    // grouped inside bet (split/street/corner/line): true odds 36/size
    case "inside": return Array.isArray(bet.ns) && bet.ns.includes(r) ? 36 / bet.ns.length : 0;
    default: return 0;
  }
}

// Validate ONE bet's shape (not the stake — the route checks money). Returns
// true only for a well-formed bet the engine can price.
export function validBet(bet) {
  if (!bet || typeof bet !== "object") return false;
  switch (bet.type) {
    case "red": case "black": case "odd": case "even": case "low": case "high":
      return true;
    case "straight":
      return Number.isInteger(bet.n) && bet.n >= 0 && bet.n <= 36;
    case "dozen": case "column":
      return Number.isInteger(bet.n) && bet.n >= 1 && bet.n <= 3;
    case "inside": {
      if (!Array.isArray(bet.ns) || bet.ns.length < 2 || bet.ns.length > 6) return false;
      if (new Set(bet.ns).size !== bet.ns.length) return false;
      return bet.ns.every((x) => Number.isInteger(x) && x >= 0 && x <= 36);
    }
    default:
      return false;
  }
}
