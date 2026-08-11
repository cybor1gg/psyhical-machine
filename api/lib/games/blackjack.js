// Blackjack rules — PURE functions only (no DB, no I/O), so every rule is
// independently testable and the route layer stays a thin state machine.
//
// Card model shared with Hi-Lo: index 0..51, rank = index % 13 (0=Two..12=Ace),
// suit = floor(index / 13). Cards are drawn from the SAME provably-fair chain
// (HMAC(serverSeed, clientSeed:nonce) → 0..51), one nonce per card, each draw
// independent — an "infinite shoe". Duplicate cards are possible and normal,
// exactly like a many-deck pit game.
//
// DRAW ORDER (published convention — verifiers depend on it):
//   nonce n   → player card 1
//   nonce n+1 → player card 2
//   nonce n+2 → dealer up-card
//   nonce n+3 → dealer hole card  (committed here, revealed at stand)
//   then one nonce per hit / double card / dealer draw, in play order.
//
// House rules: dealer stands on ALL 17s (S17). Blackjack pays 3:2. Double on
// any first two cards (one card, then forced stand). No split/insurance yet —
// the state shape (hands could become an array) leaves room for split later.

import { cardFromIndex } from "./hilo.js";
export { cardFromIndex };

// Blackjack value of a single rank: 2..10 face value, J/Q/K = 10, Ace = 11
// (softness handled by handValue).
export function bjValue(rank) {
  if (rank === 12) return 11; // Ace
  if (rank >= 9) return 10;   // J, Q, K
  return rank + 2;            // Two..Ten
}

// Total of a hand with correct soft/hard ace handling: count every ace as 11,
// then demote aces (−10 each) while the hand would bust. `soft` means an ace
// is still counted as 11 — i.e. the hand can absorb a 10 without busting.
export function handValue(indexes) {
  let total = 0;
  let aces = 0;
  for (const i of indexes) {
    const v = bjValue(i % 13);
    total += v;
    if (v === 11) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

// A "natural": exactly two cards totalling 21. Beats any other 21.
export function isBlackjack(indexes) {
  return indexes.length === 2 && handValue(indexes).total === 21;
}

// Dealer drawing rule, S17: keep drawing while under 17. Pure decision —
// the route draws the actual cards (each consumes a nonce).
export function dealerShouldDraw(dealerIndexes) {
  return handValue(dealerIndexes).total < 17;
}

// Settle a finished round. Returns { result, payoutMult } where payoutMult is
// applied to the TOTAL stake (bet, or 2×bet after a double)…
//   result: "blackjack" | "win" | "push" | "lose" | "bust"
//   …except blackjack, which by convention pays 3:2 on the ORIGINAL bet and
//   can only occur on the first two cards (never after a double).
// `fromSplit`: a 2-card 21 in a split hand is plain 21, NOT a natural — the
// 3:2 premium belongs only to an original two-card deal.
export function settle(playerIndexes, dealerIndexes, fromSplit = false) {
  const p = handValue(playerIndexes).total;
  if (p > 21) return { result: "bust", payoutMult: 0 };

  const pBJ = !fromSplit && isBlackjack(playerIndexes);
  const dBJ = isBlackjack(dealerIndexes);

  if (pBJ && dBJ) return { result: "push", payoutMult: 1 };
  if (pBJ) return { result: "blackjack", payoutMult: 2.5 };
  if (dBJ) return { result: "lose", payoutMult: 0 };

  const d = handValue(dealerIndexes).total;
  if (d > 21) return { result: "win", payoutMult: 2 };
  if (p > d) return { result: "win", payoutMult: 2 };
  if (p < d) return { result: "lose", payoutMult: 0 };
  return { result: "push", payoutMult: 1 };
}

// A pair may split when both cards carry the same blackjack VALUE — K+10
// splits (both 10), 8+8 splits, A+A splits. Standard pit rule.
export function canSplitPair(indexes) {
  return indexes.length === 2 && bjValue(indexes[0] % 13) === bjValue(indexes[1] % 13);
}

export function isAce(index) {
  return index % 13 === 12;
}
