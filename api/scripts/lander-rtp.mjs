// Measures STAR LANDER's return by simulation.
//
//   node scripts/lander-rtp.mjs [flights] [houseEdge] [seed]
//
// With no houseEdge it reports the MEAN TERMINAL COUNTER — that number is
// LANDER_MEAN_COUNTER in lib/games/lander.js, and the dock-chance dial is
// computed against it. With a houseEdge it checks the dial actually lands
// where it should.
import { fly, LANDER_MEAN_COUNTER, TERMINAL_CHANCE } from "../lib/games/lander.js";

const flights = Number(process.argv[2]) || 500000;
const edgeArg = process.argv[3];
const houseEdge = edgeArg == null || edgeArg === "-" ? null : Number(edgeArg);
const seed = Number(process.argv[4]) || 0x9e3779b9;

let s = seed >>> 0 || 1;
const next = () => {
  s ^= s << 13; s >>>= 0;
  s ^= s >> 17;
  s ^= s << 5; s >>>= 0;
  return s / 0x100000000;
};

// measuring the raw mean counter means every terminal "docks"
const edge = houseEdge == null ? 1 - LANDER_MEAN_COUNTER : houseEdge;

let total = 0, docks = 0, counterSum = 0, best = 0, events = 0;
const buckets = { "0": 0, "0-1": 0, "1-2": 0, "2-5": 0, "5-20": 0, "20-100": 0, "100+": 0 };

for (let i = 0; i < flights; i++) {
  const r = fly({ next, houseEdge: edge, maxWinMultiplier: 250 });
  total += r.multiplier;
  counterSum += r.counter;
  events += r.events.length;
  if (r.terminal === "dock") docks++;
  if (r.multiplier > best) best = r.multiplier;
  const m = r.multiplier;
  if (m === 0) buckets["0"]++;
  else if (m < 1) buckets["0-1"]++;
  else if (m < 2) buckets["1-2"]++;
  else if (m < 5) buckets["2-5"]++;
  else if (m < 20) buckets["5-20"]++;
  else if (m < 100) buckets["20-100"]++;
  else buckets["100+"]++;
}

const pct = (n) => ((n / flights) * 100).toFixed(2) + "%";
console.log(`flights          ${flights}`);
console.log(`RETURN           ${((total / flights) * 100).toFixed(3)}%`);
console.log(`MEAN COUNTER     ${(counterSum / flights).toFixed(4)}   (terminal, capped 250)`);
console.log(`dock rate        ${pct(docks)}   (1 in ${(flights / Math.max(1, docks)).toFixed(2)})`);
console.log(`mean events      ${(events / flights).toFixed(2)}   (pT ${TERMINAL_CHANCE})`);
console.log(`biggest win      ${best}x`);
console.log(`distribution     ${Object.entries(buckets).map(([k, v]) => `${k}:${pct(v)}`).join("  ")}`);
