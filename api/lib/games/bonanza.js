// SUGAR RUSH — a pay-anywhere tumbling slot in the Sweet Bonanza mould.
//
// RULES (the whole game, in one place):
//   • 6 reels × 5 rows. There are no paylines: a symbol pays on COUNT, from
//     8 of a kind anywhere on the grid.
//   • Every winning symbol is removed, everything above drops down, and fresh
//     symbols fill the gaps. That is a TUMBLE, and it repeats until a drop
//     makes no win. Wins from every tumble in a spin add together.
//   • 4+ scatters anywhere pay a bonus AND award 10 free spins.
//   • During free spins, multiplier bombs land on the grid. When a tumble
//     sequence ends, every bomb on screen is summed and the whole sequence's
//     win is multiplied by it. Bombs do not apply in the base game.
//   • 3 scatters during free spins retrigger 5 more.
//
// RTP is a real dial. Symbol weights fix the SHAPE of the game (how often it
// pays, how big the tail is); the paytable is then scaled so the measured
// return lands exactly on 1 − houseEdge. Same idea as plinko's scaledTable,
// but the base return has to be measured rather than derived — a tumbling
// pay-anywhere game has no closed form. See BASE_RTP below.

export const COLS = 6;
export const ROWS = 5;
export const CELLS = COLS * ROWS;
export const MIN_CLUSTER = 8;
export const FREE_SPINS = 10;
export const RETRIGGER_SPINS = 5;
export const SCATTER = "scatter";

// Eight paying symbols plus the scatter. Weights are draw weights, not
// probabilities — they are normalised at draw time.
export const SYMBOLS = [
  { id: "banana", kind: "low", weight: 190 },
  { id: "grape", kind: "low", weight: 180 },
  { id: "plum", kind: "low", weight: 170 },
  { id: "melon", kind: "low", weight: 160 },
  { id: "blue", kind: "high", weight: 120 },
  { id: "green", kind: "high", weight: 105 },
  { id: "purple", kind: "high", weight: 90 },
  { id: "heart", kind: "high", weight: 70 },
  { id: SCATTER, kind: "scatter", weight: 30 },
];

// Multiplier of the TOTAL bet, by how many of the symbol landed.
// [8..9, 10..11, 12+]
export const PAYS = {
  banana: [0.4, 0.9, 4],
  grape: [0.5, 1.0, 5],
  plum: [0.8, 1.2, 8],
  melon: [1.0, 1.5, 10],
  blue: [1.5, 2.0, 12],
  green: [2.0, 5.0, 15],
  purple: [2.5, 10, 25],
  heart: [10, 25, 50],
};

// Scatters pay on count too, and are what start the free spins.
export const SCATTER_PAYS = { 4: 3, 5: 5, 6: 100 };

// Bombs that land during free spins, and how often each one does.
export const BOMB_VALUES = [
  { mult: 2, weight: 240 }, { mult: 3, weight: 190 }, { mult: 4, weight: 145 },
  { mult: 5, weight: 120 }, { mult: 6, weight: 95 }, { mult: 8, weight: 78 },
  { mult: 10, weight: 62 }, { mult: 12, weight: 46 }, { mult: 15, weight: 36 },
  { mult: 20, weight: 27 }, { mult: 25, weight: 20 }, { mult: 50, weight: 11 },
  { mult: 100, weight: 6 },
];
const BOMB_CHANCE_PER_TUMBLE = 0.55; // chance a free-spin drop carries a bomb

// Measured return of the RAW paytable above: the mean of five INDEPENDENT
// 6M-spin runs, 30M spins in all (1.0971, 1.0882, 1.0985, 1.0912, 1.0940 —
// sd 0.0042, so the mean is good to about +/-0.2 points).
//
// It takes that many because the tail is heavy: a 100x bomb on a long tumble
// chain is rare and huge, so the estimate wanders for a long time. 1M-spin
// runs disagreed by more than a full point, which is enough to miss a target
// RTP by more than any operator would accept. Streams must also be separate —
// runs sharing a stream share their sampling error and will agree with each
// other while both being wrong.
// Re-measure whenever a weight, a pay or the bomb table changes:
//   for s in 111 222 333 444 555; do node scripts/bonanza-rtp.mjs 1000000 - $s; done
export const BASE_RTP = 1.0938;

const TOTAL_WEIGHT = SYMBOLS.reduce((s, x) => s + x.weight, 0);
const BOMB_WEIGHT = BOMB_VALUES.reduce((s, x) => s + x.weight, 0);

/** The pay tier index for a count: 8-9 → 0, 10-11 → 1, 12+ → 2. */
export function payTier(count) {
  if (count >= 12) return 2;
  if (count >= 10) return 1;
  return count >= MIN_CLUSTER ? 0 : -1;
}

/**
 * The paytable actually used, scaled so the game returns exactly
 * (1 − houseEdge). Payouts stay in the same proportion to one another, so the
 * game keeps its shape — only the overall return moves.
 */
export function scaledPays(houseEdge) {
  const k = (1 - houseEdge) / BASE_RTP;
  const out = {};
  for (const [id, tiers] of Object.entries(PAYS)) out[id] = tiers.map((v) => v * k);
  const scatter = {};
  for (const [n, v] of Object.entries(SCATTER_PAYS)) scatter[n] = v * k;
  return { symbols: out, scatter, factor: k };
}

const pickWeighted = (list, total, roll) => {
  let acc = roll * total;
  for (const item of list) { acc -= item.weight; if (acc <= 0) return item; }
  return list[list.length - 1];
};

/** One symbol id from a [0,1) roll. */
export function symbolFor(roll) { return pickWeighted(SYMBOLS, TOTAL_WEIGHT, roll).id; }
export function bombFor(roll) { return pickWeighted(BOMB_VALUES, BOMB_WEIGHT, roll).mult; }

/** Count every symbol on the grid. Grid is a flat array of ids, length CELLS. */
export function countSymbols(grid) {
  const counts = new Map();
  for (const id of grid) counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
}

/**
 * Which symbols win on this grid, and what they pay (as a multiple of total
 * bet). Scatters pay but are NOT removed by a tumble — they sit still, exactly
 * like the original.
 */
export function evaluate(grid, pays) {
  const counts = countSymbols(grid);
  const wins = [];
  let total = 0;
  for (const [id, count] of counts) {
    if (id === SCATTER) continue;
    const tier = payTier(count);
    if (tier < 0) continue;
    const amount = pays.symbols[id][tier];
    wins.push({ id, count, mult: amount });
    total += amount;
  }
  return { wins, total, scatters: counts.get(SCATTER) || 0 };
}

/**
 * Run one spin to completion: the first drop, then every tumble it causes.
 * `next()` must return a fresh [0,1) roll each call — that is the provably
 * fair chain, so the whole spin is reproducible from the seed pair.
 *
 * Returns the full choreography the screen replays, plus the win in multiples
 * of the total bet.
 */
export function spin({ next, pays, freeSpin = false }) {
  const grid = Array.from({ length: CELLS }, () => symbolFor(next()));
  const steps = [];
  const bombs = [];
  let sequenceWin = 0;

  // scatters are counted on the FIRST drop only, as in the original
  const opening = evaluate(grid, pays);
  const scatters = opening.scatters;

  let work = grid.slice();
  let guard = 0;
  for (;;) {
    if (++guard > 60) break; // a tumble chain cannot run forever
    const res = evaluate(work, pays);
    if (!res.wins.length) {
      steps.push({ grid: work.slice(), wins: [], win: 0, bomb: null });
      break;
    }
    sequenceWin += res.total;

    // during free spins a drop can carry a multiplier bomb
    let bomb = null;
    if (freeSpin && next() < BOMB_CHANCE_PER_TUMBLE) {
      bomb = bombFor(next());
      bombs.push(bomb);
    }

    const winning = new Set(res.wins.map((w) => w.id));
    const cleared = work.map((id) => (winning.has(id) ? null : id));
    steps.push({ grid: work.slice(), wins: res.wins, win: res.total, cleared: cleared.slice(), bomb });

    // gravity: survivors fall to the bottom of their column, new symbols above
    const nextGrid = new Array(CELLS).fill(null);
    for (let c = 0; c < COLS; c++) {
      const keep = [];
      for (let r = ROWS - 1; r >= 0; r--) {
        const v = cleared[r * COLS + c];
        if (v !== null) keep.push(v);
      }
      for (let r = ROWS - 1, k = 0; r >= 0; r--, k++) {
        nextGrid[r * COLS + c] = k < keep.length ? keep[k] : symbolFor(next());
      }
    }
    work = nextGrid;
  }

  // bombs multiply the WHOLE sequence, once it has finished tumbling
  const bombTotal = bombs.reduce((s, b) => s + b, 0);
  const multiplier = freeSpin && bombTotal > 0 ? bombTotal : 1;
  const scatterPay = pays.scatter[scatters] || 0;

  return {
    steps,
    scatters,
    scatterPay,
    bombs,
    multiplier,
    baseWin: sequenceWin,
    win: sequenceWin * multiplier + scatterPay,
    triggered: scatters >= 4,
  };
}

/** A whole round: the paid spin, then any free spins it won. */
export function playRound({ next, houseEdge, maxWinMultiplier = Infinity }) {
  const pays = scaledPays(houseEdge);
  const base = spin({ next, pays, freeSpin: false });
  const rounds = [base];
  let total = base.win;

  let remaining = base.triggered ? FREE_SPINS : 0;
  let awarded = remaining;
  let guard = 0;
  while (remaining > 0) {
    if (++guard > 500) break;
    remaining--;
    const fs = spin({ next, pays, freeSpin: true });
    rounds.push(fs);
    total += fs.win;
    if (fs.scatters >= 3) { remaining += RETRIGGER_SPINS; awarded += RETRIGGER_SPINS; }
  }

  return {
    rounds,
    freeSpinsAwarded: awarded,
    totalMultiplier: Math.min(total, maxWinMultiplier),
    cappedAt: total > maxWinMultiplier ? maxWinMultiplier : null,
    payFactor: pays.factor,
  };
}
