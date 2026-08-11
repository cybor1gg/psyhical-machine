// Mines rules — pure functions, no I/O.
//
// A square grid of `tiles` tiles (25/36/49/64 — 5×5 up to 8×8, default 5×5)
// hides K mines (player-chosen, 1 to tiles−1). Reveal gems to grow the
// multiplier, cash out any time after the first gem; hit a mine and the bet
// is gone.
//
// PROVABLY FAIR LAYOUT — drawing WITHOUT replacement. One nonce per mine:
//
//   roll_i = HMAC_SHA256(serverSeed, clientSeed:nonce+i) → float in [0,1)
//   the i-th mine takes remaining[floor(roll_i × remaining.length)],
//   where `remaining` is the ascending list 0..tiles−1 of tiles not yet taken.
//
// Every arrangement is equally likely, and anyone can replay the K draws
// from the revealed seed. All K mines are committed in one atomic claim at
// bet time and kept server-side until the round settles.
//
// MULTIPLIER: after n gems on a `tiles`-tile grid,
// m(n) = Π_{k=0..n-1} (1−edge) · (tiles−k)/(tiles−mines−k),
// compounded with 4-decimal truncation per step (same discipline as hilo and
// tower) and clamped to maxWinMultiplier. Each factor is (1−edge)/P(safe on
// that pick), so RTP = 1 − houseEdge at every cashout point — which is why
// this game's RTP is operator-configurable.
//
// DRAW ORDER (published): nonces n .. n+K−1 = mines 1..K, by the rule above.

import { truncate } from "../money.js";

export const TILES = 25;
export const MIN_MINES = 1;
export const MAX_MINES = 24;
export const GRID_SIZES = [16, 25, 36, 49, 64];

// rolls (floats, draw order) → mine tile indexes, without replacement.
export function minePositions(rolls, tiles = TILES) {
  const remaining = Array.from({ length: tiles }, (_, i) => i);
  const mines = [];
  for (const f of rolls) {
    const idx = Math.floor(f * remaining.length);
    mines.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return mines;
}

// Multiplier after `picks` safe reveals with `mines` mines on the board.
export function multiplierAfter(picks, mines, houseEdge, maxWinMultiplier = Infinity, tiles = TILES) {
  let m = 1;
  for (let k = 0; k < picks; k++) {
    m = Math.min(truncate(m * (1 - houseEdge) * ((tiles - k) / (tiles - mines - k)), 4), maxWinMultiplier);
  }
  return m;
}

// Full ladder (index n-1 = multiplier after n gems) for the UI.
export function ladder(mines, houseEdge, maxWinMultiplier = Infinity, tiles = TILES) {
  const gems = tiles - mines;
  return Array.from({ length: gems }, (_, n) => multiplierAfter(n + 1, mines, houseEdge, maxWinMultiplier, tiles));
}

export function parseGridSize(raw) {
  if (raw === undefined || raw === null) return TILES;
  const n = Number(raw);
  if (!GRID_SIZES.includes(n)) return null;
  return n;
}

export function parseMines(raw, tiles = TILES) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_MINES || n > tiles - 1) return null;
  return n;
}
