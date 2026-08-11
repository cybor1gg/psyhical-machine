// Cards: index 0-51. rank = index % 13 (0=Two ... 12=Ace), suit = floor(index / 13)
// ORDERING (v3, matching the design): ACE LOW, KING HIGH.
//   card value v = 1 (Ace) .. 13 (King)
// CALLS are dynamic per card and always come from the server:
//   normal card: "Higher or Same" P=(14-v)/13, "Lower or Same" P=v/13
//   King (v=13): "Same" P=1/13 (12.87x) and strict "Lower" P=12/13 (~1.07x)
//   Ace  (v=1):  strict "Higher" P=12/13 and "Same" P=1/13
// Probabilities are never 0 and never negative — the client only renders them.

export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
export const SUITS = ["\u2663", "\u2666", "\u2665", "\u2660"];

export function cardFromIndex(index) {
  return {
    index,
    rank: index % 13,
    label: RANKS[index % 13] + SUITS[Math.floor(index / 13)],
  };
}

// rank 0..12 (0=Two..11=King? no: 0=Two..8=Ten,9=J,10=Q,11=K,12=Ace) → value 1..13, Ace low.
export function cardValue(rank) {
  return rank === 12 ? 1 : rank + 2;
}

// Shared money truncation — see lib/money.js for why a bare Math.floor is
// unsafe. Re-exported here because hilo's multiplier math uses it everywhere.
export { truncate } from "../money.js";
import { truncate } from "../money.js";

export function multiplierFor(probability, houseEdge) {
  if (probability <= 0) return 0;
  const m = (1 - houseEdge) / probability;
  return truncate(m, 4); // truncate, never round UP
}

// The two calls offered for a given card. Always exactly two, ordered
// [high-side, low-side] so the UI can place them right/left consistently.
export function callsFor(rank, houseEdge) {
  const v = cardValue(rank);
  const mk = (choice, label, p) => ({
    choice,
    label,
    probability: p,
    multiplier: multiplierFor(p, houseEdge),
  });

  if (v === 13) {
    // King: nothing is higher — high side becomes "Same"
    return [mk("same", "Same", 1 / 13), mk("lower", "Lower", 12 / 13)];
  }
  if (v === 1) {
    // Ace: nothing is lower — low side becomes "Same"
    return [mk("higher", "Higher", 12 / 13), mk("same", "Same", 1 / 13)];
  }
  return [
    mk("higher", "Higher or Same", (14 - v) / 13),
    mk("lower", "Lower or Same", v / 13),
  ];
}

// Did this call win, given current and next values?
// On extremes the directional call is STRICT (that's why it was offered strict);
// on normal cards direction includes ties.
export function winForCall(choice, curV, nextV) {
  if (choice === "same") return nextV === curV;
  if (choice === "higher") return curV === 1 ? nextV > curV : nextV >= curV;
  if (choice === "lower") return curV === 13 ? nextV < curV : nextV <= curV;
  return false;
}
