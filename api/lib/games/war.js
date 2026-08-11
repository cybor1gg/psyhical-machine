// Casino War rules — pure functions, no I/O.
//
// Card model shared with the other games: index 0..51, rank = index % 13
// (0=Two .. 12=Ace). War compares plain ranks, ACE HIGH — which the shared
// rank encoding already gives us for free. Suits never matter.
//
// DRAW ORDER (published convention — verifiers depend on it):
//   nonce n   → player card
//   nonce n+1 → dealer card
//   war: n+2  → player war card
//        n+3  → dealer war card
//
// Payouts (classic rules, infinite deck):
//   win               → 2× bet          (1:1)
//   lose              → 0
//   tie → surrender   → 0.5× bet back
//   tie → war, win    → 3× bet          (raise paid 1:1, original pushes)
//   tie → war, TIE    → 3× bet          (tie during war favours the player)
//   tie → war, lose   → 0               (both bets lost)
//   TIE side bet      → 11× tie bet on the first-deal tie (10:1), else lost
//
// House edge: main bet ≈ 2.96% (always warring), ≈ 3.85% surrendering;
// tie side bet ≈ 15.4%. All of it lives in the tie branch — the non-tie
// game is exactly fair.

import { cardFromIndex } from "./hilo.js";
import { truncate } from "../money.js";
export { cardFromIndex };

// Side-bet ladders (Rainbet-style): payout multiplier by CONSECUTIVE-tie
// streak (1..4). "10:1" means 10× winnings — the stake comes back on top,
// so the return is (PAYS+1)× the side bet. A streak survives across rounds:
// it grows on every tie (deal or war cards), and resets on any non-tie deal
// or a surrender. Four consecutive ties additionally pay a 10:1 bonus on the
// MAIN bet and end the round on the spot.
export const TIE_PAYS = [10, 30, 60, 300];      // same rank
export const CTIE_PAYS = [20, 125, 400, 1000];  // same rank AND same colour

export function warRank(index) {
  return index % 13; // 0=Two .. 12=Ace, ace high by construction
}

export function isRed(index) {
  const suit = Math.floor(index / 13); // 0♣ 1♦ 2♥ 3♠
  return suit === 1 || suit === 2;
}

// First showdown: "win" | "lose" | "tie" from the player's perspective.
export function compareCards(playerIndex, dealerIndex) {
  const p = warRank(playerIndex);
  const d = warRank(dealerIndex);
  return p > d ? "win" : p < d ? "lose" : "tie";
}

// War showdown: the player wins ties (that's the compensation for risking
// 2 units to win 1).
export function warOutcome(playerIndex, dealerIndex) {
  return warRank(playerIndex) >= warRank(dealerIndex) ? "war-win" : "war-lose";
}

// ── settlement resolvers (pure — routes only move money) ────────────────────

// Resolve the first deal. `streak` is the player's consecutive-tie count
// BEFORE this round. Returns either a settled outcome or the war decision.
export function resolveDeal({ playerIndex, dealerIndex, streak, main, tie, ctie }) {
  const outcome = compareCards(playerIndex, dealerIndex);
  if (outcome !== "tie") {
    return {
      settled: true,
      result: outcome,
      payout: outcome === "win" ? truncate(main * 2, 2) : 0,
      tieWin: 0, ctieWin: 0,
      newStreak: 0, // a non-tie deal breaks the streak
    };
  }

  const s = Math.min(streak + 1, 4);
  const tieWin = tie > 0 ? truncate(tie * (TIE_PAYS[s - 1] + 1), 2) : 0;
  const coloured = isRed(playerIndex) === isRed(dealerIndex);
  const ctieWin = ctie > 0 && coloured ? truncate(ctie * (CTIE_PAYS[s - 1] + 1), 2) : 0;

  if (s >= 4) {
    // four consecutive ties: 10:1 bonus on the main bet, round over
    return {
      settled: true,
      result: "bonus",
      payout: truncate(main * 11 + tieWin + ctieWin, 2),
      tieWin, ctieWin,
      newStreak: 0,
    };
  }
  return { settled: false, result: null, tieWin, ctieWin, newStreak: s };
}

// Resolve the war cards. Side wins were booked at the deal; a tie during war
// grows the streak further (and can complete the 4-tie bonus).
export function resolveWar({ playerIndex, dealerIndex, streak, main, tieWin, ctieWin }) {
  const sides = truncate(tieWin + ctieWin, 2);
  if (warRank(playerIndex) === warRank(dealerIndex)) {
    const s = Math.min(streak + 1, 4);
    if (s >= 4) {
      return { result: "bonus", payout: truncate(main * 10 + main * 3 + sides, 2), newStreak: 0 };
    }
    return { result: "war-win", payout: truncate(main * 3 + sides, 2), newStreak: s };
  }
  const won = warRank(playerIndex) > warRank(dealerIndex);
  return {
    result: won ? "war-win" : "war-lose",
    payout: truncate((won ? main * 3 : 0) + sides, 2),
    newStreak: streak, // war cards didn't tie; the deal's streak stands
  };
}
