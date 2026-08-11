// Punto Banco (baccarat) rules — pure functions, no I/O.
//
// Card model shared with the other games: index 0..51, rank = index % 13
// (0=Two .. 12=Ace). Baccarat value: A=1, 2..9 = pip, 10/J/Q/K = 0; a hand's
// total is the sum mod 10. Both hands draw a fixed third card under the
// classic tableau (no player choice), so the outcome is pure chance — a
// RULES-priced game (the edge is the drawing rules + 5% banker commission,
// not a tunable number).
//
// DRAW ORDER (published) — SIX nonces claimed atomically, positional:
//   n   → Player card 1      n+1 → Player card 2
//   n+2 → Banker card 1      n+3 → Banker card 2
//   n+4 → Player third card  (used only if the player draws)
//   n+5 → Banker third card  (used only if the banker draws)
// Unused third-card slots are simply ignored — the assignment is fixed so
// anyone can recompute the round from the seed.
//
// PAYOUTS (multiplier incl. stake):
//   Player win  2.0×   Banker win 1.95× (0.95:1, the 5% commission)
//   Tie 9.0× on a Tie bet; on a tie, un-bet Player/Banker stakes PUSH (1.0×).

// Baccarat value of one card index: A=1, 2..9 pip, 10/J/Q/K = 0.
export function cardBaccValue(index) {
  const rank = index % 13; // 0=Two .. 8=Ten, 9=J, 10=Q, 11=K, 12=Ace
  if (rank === 12) return 1;          // Ace
  if (rank >= 8) return 0;            // Ten, J, Q, K
  return rank + 2;                    // Two..Nine
}
export function handTotal(indexes) {
  return indexes.reduce((t, i) => t + cardBaccValue(i), 0) % 10;
}

// Resolve a full coup from six pre-drawn card indexes (positional order above).
// Returns which cards were actually dealt + the winner. Pure — the route only
// moves money.
export function resolveCoup(cards) {
  const [p1, p2, b1, b2, p3slot, b3slot] = cards;
  const player = [p1, p2];
  const banker = [b1, b2];
  let pv = handTotal(player);
  let bv = handTotal(banker);

  let playerThird = null;
  // Naturals (8 or 9 on the first two cards) end the coup immediately.
  if (pv < 8 && bv < 8) {
    // Player draws on 0..5, stands on 6..7.
    if (pv <= 5) {
      player.push(p3slot);
      playerThird = cardBaccValue(p3slot); // value of the drawn third card (0..9)
    }
    // Banker's rule depends on the player's third-card VALUE (or lack of draw).
    bv = handTotal(banker);
    let bankerDraws;
    if (playerThird === null) {
      bankerDraws = bv <= 5; // player stood → banker draws to 5
    } else if (bv <= 2) {
      bankerDraws = true;
    } else if (bv === 3) {
      bankerDraws = playerThird !== 8;
    } else if (bv === 4) {
      bankerDraws = playerThird >= 2 && playerThird <= 7;
    } else if (bv === 5) {
      bankerDraws = playerThird >= 4 && playerThird <= 7;
    } else if (bv === 6) {
      bankerDraws = playerThird >= 6 && playerThird <= 7;
    } else {
      bankerDraws = false; // banker 7 stands
    }
    if (bankerDraws) banker.push(b3slot);
  }

  pv = handTotal(player);
  bv = handTotal(banker);
  const winner = pv > bv ? "player" : bv > pv ? "banker" : "tie";
  return { player, banker, playerValue: pv, bankerValue: bv, winner };
}

// Payout multiplier (incl. stake) for one bet given the coup winner.
// A tie PUSHES un-bet player/banker stakes (1.0×), pays a Tie bet 9.0×.
export function betMultiplier(betType, winner) {
  if (betType === "player") return winner === "player" ? 2.0 : winner === "tie" ? 1.0 : 0;
  if (betType === "banker") return winner === "banker" ? 1.95 : winner === "tie" ? 1.0 : 0;
  if (betType === "tie") return winner === "tie" ? 9.0 : 0;
  return 0;
}

export const BET_TYPES = ["player", "banker", "tie"];
