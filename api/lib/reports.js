// Platform reporting over settled rounds. Cabinet edition: no operators, no
// rev-share — GGR is simply bets minus payouts, all of it ours.
//
//   GGR = bets − payouts (house gross, only settled rounds: lost/cashed_out)
import GameRound from "../models/GameRound.js";

const round2 = (n) => Math.round(n * 100) / 100;

export function parseRange(query) {
  const from = query.from ? new Date(query.from) : new Date(0);
  let to = query.to ? new Date(query.to) : new Date();
  // A date-only `to` (YYYY-MM-DD) should be INCLUSIVE of that whole day, else
  // rounds placed after midnight are silently dropped from a from–to report.
  if (query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to)) to = new Date(query.to + "T23:59:59.999Z");
  if (isNaN(from) || isNaN(to) || from > to) return { error: "Invalid from/to date (use YYYY-MM-DD)" };
  return { from, to };
}

function baseMatch(from, to) {
  return { status: { $in: ["lost", "cashed_out"] }, createdAt: { $gte: from, $lte: to } };
}

// Turnover per round = staked (bets + doubles + splits + insurance). Older
// rounds predate the field — fall back to betAmount.
const STAKE = { $ifNull: ["$staked", "$betAmount"] };

// Totals cards for the backoffice Bets page. Same response shape as the
// online project's platformTotals; `revenue` equals `ggr` because there is
// no rev-share — every machine is ours.
export async function platformTotals(from, to) {
  const rows = await GameRound.aggregate([
    { $match: baseMatch(from, to) },
    { $group: { _id: "$status", rounds: { $sum: 1 }, staked: { $sum: STAKE }, payout: { $sum: "$payout" } } },
  ]);

  let wagered = 0, payouts = 0, lostStake = 0, wonRounds = 0, lostRounds = 0;
  for (const r of rows) {
    wagered = round2(wagered + r.staked);
    payouts = round2(payouts + r.payout);
    if (r._id === "lost") { lostStake = round2(lostStake + r.staked); lostRounds += r.rounds; }
    if (r._id === "cashed_out") { wonRounds += r.rounds; }
  }

  const ggr = round2(wagered - payouts);
  return {
    wagered,           // turnover (Σ staked)
    won: payouts,      // money returned to players (Σ payout)
    lost: lostStake,   // stakes fully lost on losing rounds
    ggr,               // house gross = wagered − won
    revenue: ggr,
    rounds: wonRounds + lostRounds,
    wonRounds,
    lostRounds,
  };
}
