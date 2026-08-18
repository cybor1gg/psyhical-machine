// Measures STAR LANDER's return by full physics simulation.
//
//   node scripts/lander-rtp.mjs [rounds] [generosity|-] [seed]
//
// With a generosity it reports EV at that gem density — those numbers are
// the EV_ANCHORS in lib/games/lander.js. With '-' it uses the engine's own
// dial at houseEdge 0.035 and checks the whole chain lands where it should.
import { generateMap, simulate, PHYS } from "../lib/games/lander-physics.js";
import { generosityFor } from "../lib/games/lander.js";

const rounds = Number(process.argv[2]) || 100000;
const genArg = process.argv[3];
const gen = genArg == null || genArg === "-" ? generosityFor(0.035) : Number(genArg);
const seed = Number(process.argv[4]) || 0x9e3779b9;

let s = seed >>> 0 || 1;
const next = () => {
  s ^= s << 13; s >>>= 0;
  s ^= s >> 17;
  s ^= s << 5; s >>>= 0;
  return s / 0x100000000;
};

let total = 0, lands = 0, best = 0, dur = 0;
const buckets = { "0": 0, "0-1": 0, "1-2": 0, "2-5": 0, "5-20": 0, "20-80": 0, "80+": 0 };
// the show the player watches: the highest the counter climbs MID-FLIGHT,
// whether or not the ship lands afterwards
const peaks = { "20+": 0, "50+": 0, "100+": 0, "cap": 0 };

for (let i = 0; i < rounds; i++) {
  const map = generateMap(next, gen);
  const r = simulate(map);
  const m = Math.min(r.multiplier, PHYS.COUNTER_CAP);
  total += m;
  dur += r.durationS;
  if (r.landed) lands++;
  if (m > best) best = m;
  if (m === 0) buckets["0"]++;
  else if (m < 1) buckets["0-1"]++;
  else if (m < 2) buckets["1-2"]++;
  else if (m < 5) buckets["2-5"]++;
  else if (m < 20) buckets["5-20"]++;
  else if (m < 80) buckets["20-80"]++;
  else buckets["80+"]++;
  let peak = 1;
  for (const h of r.hits) if (h.counter > peak) peak = h.counter;
  if (peak >= 20) peaks["20+"]++;
  if (peak >= 50) peaks["50+"]++;
  if (peak >= 100) peaks["100+"]++;
  if (peak >= PHYS.COUNTER_CAP) peaks["cap"]++;
}

const pct = (n) => ((n / rounds) * 100).toFixed(2) + "%";
console.log(`rounds           ${rounds}   generosity ${gen.toFixed(3)}`);
console.log(`RETURN           ${((total / rounds) * 100).toFixed(3)}%`);
console.log(`land rate        ${pct(lands)}   (1 in ${(rounds / Math.max(1, lands)).toFixed(2)})`);
console.log(`mean flight      ${(dur / rounds).toFixed(1)}s sim time`);
console.log(`biggest win      ${best}x`);
console.log(`distribution     ${Object.entries(buckets).map(([k, v]) => `${k}:${pct(v)}`).join("  ")}`);
console.log(`mid-flight peak  ${Object.entries(peaks).map(([k, v]) => `${k}:${pct(v)}`).join("  ")}`);
