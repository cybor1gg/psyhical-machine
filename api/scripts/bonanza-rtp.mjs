// Measures SUGAR RUSH's return by simulation, because a tumbling
// pay-anywhere game has no closed form to derive it from.
//
//   node scripts/bonanza-rtp.mjs [spins] [houseEdge]
//
// With no houseEdge it reports the RAW return of the paytable — that number
// is BASE_RTP in lib/games/bonanza.js, and the scaling is calibrated against
// it. With a houseEdge it checks the scaling actually lands where it should.
import { playRound, BASE_RTP, ANTE_BASE_RTP, ANTE_COST, BUY_PRICE } from "../lib/games/bonanza.js";

const spins = Number(process.argv[2]) || 200000;
const edgeArg = process.argv[3];
const houseEdge = edgeArg == null || edgeArg === "-" ? null : Number(edgeArg);
// Independent runs need independent streams. Without this every run is a
// prefix of the same sequence, so a calibration run and its own verification
// share their sampling error and appear to agree — or, as happened here,
// disagree by a constant that looks like a scaling bug and is not.
const seed = Number(process.argv[4]) || 0x9e3779b9;
// base | ante | buy — each has its own shape and so its own calibration
const mode = process.argv[5] || "base";

// A fast deterministic PRNG — this only measures the paytable, and the real
// game draws from the HMAC chain instead.
let s = seed >>> 0 || 1;
const next = () => {
  s ^= s << 13; s >>>= 0;
  s ^= s >> 17;
  s ^= s << 5; s >>>= 0;
  return s / 0x100000000;
};

// Measuring the raw table means scaling by exactly 1.
const rawBase = mode === "ante" ? ANTE_BASE_RTP : BASE_RTP;
const edge = houseEdge == null ? 1 - rawBase : houseEdge;
// Cost per round in bet multiples: ante charges 1.25x, a buy is priced by the
// caller so the raw measurement just reports EV per free-spin round.
const cost = mode === "ante" ? ANTE_COST : mode === "buy" ? BUY_PRICE : 1;

let total = 0, hits = 0, best = 0, freeRounds = 0, freeWin = 0;
const buckets = { "0": 0, "0-1": 0, "1-5": 0, "5-20": 0, "20-100": 0, "100+": 0 };
const t0 = Date.now();
for (let i = 0; i < spins; i++) {
  const r = playRound({ next, houseEdge: edge, ante: mode === "ante", buy: mode === "buy" });
  const w = r.totalMultiplier;
  total += w;
  if (w > 0) hits++;
  if (w > best) best = w;
  if (r.freeSpinsAwarded > 0) { freeRounds++; freeWin += w; }
  if (w === 0) buckets["0"]++;
  else if (w < 1) buckets["0-1"]++;
  else if (w < 5) buckets["1-5"]++;
  else if (w < 20) buckets["5-20"]++;
  else if (w < 100) buckets["20-100"]++;
  else buckets["100+"]++;
}
const rtp = total / spins / (houseEdge == null && mode === "buy" ? 1 : cost);
console.log(`spins            ${spins.toLocaleString()}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(`mode             ${mode}${cost !== 1 ? `  (cost ${cost}x per round)` : ""}`);
console.log(`houseEdge used   ${edge.toFixed(4)}${houseEdge == null ? "  (raw table)" : ""}`);
console.log(`RETURN           ${(rtp * 100).toFixed(3)}%`);
if (houseEdge != null) console.log(`target           ${((1 - houseEdge) * 100).toFixed(3)}%   diff ${((rtp - (1 - houseEdge)) * 100).toFixed(3)} pts`);
else console.log(`-> RAW RETURN    ${rtp.toFixed(4)}${mode === "buy" ? "   (this is the EV of one bought round)" : ""}`);
console.log(`hit rate         ${((hits / spins) * 100).toFixed(2)}%`);
console.log(`free spins       ${((freeRounds / spins) * 100).toFixed(3)}% of spins, ${((freeWin / total) * 100).toFixed(1)}% of all return`);
console.log(`biggest win      ${best.toFixed(1)}x`);
console.log("distribution     " + Object.entries(buckets).map(([k, v]) => `${k}:${((v / spins) * 100).toFixed(1)}%`).join("  "));
