// Dragon Tower rules — pure functions, no I/O.
//
// The tower has ROWS rows. Each row shows `tiles` tiles; `safe` of them are
// eggs, the rest hide dragons. Pick an egg to climb, hit a dragon to bust.
// Cash out any time after the first climbed row.
//
// PROVABLY FAIR LAYOUT — the "singleton rule". Every difficulty has either
// exactly ONE dragon per row (easy/medium/hard) or exactly ONE safe tile
// (expert/master). One nonce per row:
//
//   roll  = HMAC_SHA256(serverSeed, clientSeed:nonce) → float in [0,1)
//   index = floor(roll × tiles)
//
// That index IS the dragon when dragons are the singleton, or IS the safe
// tile when eggs are the singleton. All arrangements are equally likely and
// anyone can recompute every row from the revealed seed.
//
// DRAW ORDER (published): nonce n = row 1 (bottom), n+1 = row 2, … n+8 = row 9.
// All nine rows are committed in one atomic claim at bet time and kept
// server-side until the round settles.
//
// Multiplier per row = (1 − houseEdge) / P(safe), compounded with 4-decimal
// truncation exactly like hilo. RTP = 1 − houseEdge at every difficulty —
// which is why this game's RTP is operator-configurable.

import { rollNumber } from "../fair.js";
import { truncate } from "../money.js";

export const ROWS = 9;

export const DIFFICULTIES = {
  easy:   { tiles: 4, safe: 3 },
  medium: { tiles: 3, safe: 2 },
  hard:   { tiles: 2, safe: 1 },
  expert: { tiles: 3, safe: 1 },
  master: { tiles: 4, safe: 1 },
};

// Dragon tile indexes for one row.
export function rowDragons(serverSeed, clientSeed, nonce, difficulty) {
  const { tiles, safe } = DIFFICULTIES[difficulty];
  const index = Math.floor(rollNumber(serverSeed, clientSeed, nonce) * tiles);
  if (tiles - safe === 1) return [index];                       // one dragon
  return Array.from({ length: tiles }, (_, i) => i).filter((i) => i !== index); // one egg
}

export function stepMultiplier(difficulty, houseEdge) {
  const { tiles, safe } = DIFFICULTIES[difficulty];
  return truncate((1 - houseEdge) / (safe / tiles), 4);
}

// The full multiplier ladder (index k = multiplier after climbing k+1 rows),
// compounded with per-step truncation and clamped to the liability cap so
// the UI can never promise more than the round can pay.
export function ladder(difficulty, houseEdge, maxWinMultiplier = Infinity) {
  const step = stepMultiplier(difficulty, houseEdge);
  const out = [];
  let m = 1;
  for (let k = 0; k < ROWS; k++) {
    m = Math.min(truncate(m * step, 4), maxWinMultiplier);
    out.push(m);
  }
  return out;
}
