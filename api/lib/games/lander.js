// STAR LANDER — an auto-resolving flight game in the Aviamasters family.
//
//   • The shuttle launches with the counter at x1.00 and flies a randomized
//     path of SEGMENTS. Each segment carries one event: an energy cell that
//     ADDS to the counter (+1 +2 +5 +10), a warp crystal that MULTIPLIES it
//     (x2 x3 x4 x5), or a meteor strike that HALVES it.
//   • There is no cashout. The flight ends on its own: DOCK on the landing
//     platform and the counter pays, or drift into the black hole and the
//     bet is lost. The player only watches.
//   • The whole round is resolved here, server-side, from the provably-fair
//     roll stream; the client replays the script and decides nothing.
//
// THE RTP DIAL, exactly:
// the terminal draw (dock vs black hole) is INDEPENDENT of how the counter
// evolved, so  EV = P(dock) x E[counter at terminal].  E[counter at terminal]
// is a fixed property of the event weights below — measured, not derived
// (LANDER_MEAN_COUNTER). The dial is therefore closed-form:
//
//     P(dock) = (1 - houseEdge) / LANDER_MEAN_COUNTER
//
// and the genre's famous ~40% landing rate falls out by design: the weights
// are tuned so the mean terminal counter sits near 2.6, which puts P(dock)
// near 0.37 at the platform edge — one landing in ~2.7 flights.
import { getGameConfig } from "../config.js";

// ── the flight's event table ────────────────────────────────────────────────
// Weights fix the SHAPE of the game (how flights feel); the dial above fixes
// the return. Re-measure LANDER_MEAN_COUNTER whenever a weight changes:
//   node scripts/lander-rtp.mjs 10000000
export const EVENTS = [
  { kind: "pick", value: 1, weight: 420 },
  { kind: "pick", value: 2, weight: 70 },
  { kind: "pick", value: 5, weight: 12 },
  { kind: "pick", value: 10, weight: 5 },
  { kind: "mult", value: 2, weight: 16 },
  { kind: "mult", value: 3, weight: 5 },
  { kind: "mult", value: 4, weight: 2.5 },
  { kind: "mult", value: 5, weight: 1.4 },
  { kind: "rocket", value: 0, weight: 348 },
];
const EVENT_WEIGHT = EVENTS.reduce((s, e) => s + e.weight, 0);

// chance a segment is the LAST one; 1/pT is the mean flight length
export const TERMINAL_CHANCE = 0.185;

// the mean counter at the moment the flight ends, capped at x250 — measured
// over pooled independent streams (see scripts/lander-rtp.mjs). This is the
// one calibrated constant the RTP dial divides by.
// pooled mean of four independent 10M-flight streams: 2.5998, 2.5985,
// 2.5992, 2.6009 — the dial divides by this, so at the platform's 3.5% edge
// the dock chance is 0.965 / 2.5996 = 37.1%, one landing in 2.7 flights.
export const LANDER_MEAN_COUNTER = 2.5996;

// runaway guards: a flight longer than this is unheard of at pT = 0.155
const MAX_SEGMENTS = 64;

const round2 = (n) => Math.round(n * 100) / 100;

function pickEvent(roll) {
  let x = roll * EVENT_WEIGHT;
  for (const e of EVENTS) {
    if ((x -= e.weight) < 0) return e;
  }
  return EVENTS[EVENTS.length - 1];
}

/**
 * One full flight from the roll stream. `next()` yields floats in [0,1).
 * Returns the replay script: every event with the counter AFTER it, the
 * terminal, and the final counter (multiples of the bet; 0 on a splash).
 */
export function fly({ next, houseEdge, maxWinMultiplier = 250 }) {
  const dockChance = Math.min(0.92, (1 - houseEdge) / LANDER_MEAN_COUNTER);
  let counter = 1;
  const events = [];

  for (let seg = 0; seg < MAX_SEGMENTS; seg++) {
    if (next() < TERMINAL_CHANCE || seg === MAX_SEGMENTS - 1) {
      const docked = next() < dockChance;
      const final = docked ? Math.min(counter, maxWinMultiplier) : 0;
      return {
        events,
        terminal: docked ? "dock" : "hole",
        counter: round2(Math.min(counter, maxWinMultiplier)),
        multiplier: round2(final),
      };
    }
    const e = pickEvent(next());
    if (e.kind === "pick") counter = counter + e.value;
    else if (e.kind === "mult") counter = counter * e.value;
    else counter = counter / 2;
    counter = round2(Math.min(counter, maxWinMultiplier * 4)); // soft ceiling mid-flight
    events.push({ k: e.kind[0], v: e.value, c: round2(Math.min(counter, maxWinMultiplier)) });
  }
  // unreachable: the loop above always returns by MAX_SEGMENTS - 1
  return { events, terminal: "hole", counter: 0, multiplier: 0 };
}

/** The whole round, priced from the game's config. */
export function playRound({ next, houseEdge, maxWinMultiplier }) {
  return fly({ next, houseEdge, maxWinMultiplier });
}

/** What the client may know before betting — published on /table. */
export async function landerTable() {
  const config = await getGameConfig("lander");
  return {
    events: EVENTS.map(({ kind, value }) => ({ kind, value })),
    dockChance: Math.min(0.92, (1 - config.houseEdge) / LANDER_MEAN_COUNTER),
    maxWinMultiplier: config.maxWinMultiplier ?? 250,
    minBet: config.minBet,
    maxBet: config.maxBet,
    rtp: 1 - config.houseEdge,
  };
}
