// Shared reporting/aggregation. Three consumers (admin backoffice, partner
// portal, operator server API) — one implementation, so GGR/NGR can never
// disagree between what we see and what the operator sees.
//
// Definitions:
//   GGR = bets − payouts (house gross, only settled rounds: lost/cashed_out)
//   provider fee = GGR × revSharePct/100   (per operator, per game)
//   NGR (operator's net) = GGR − provider fee
import GameRound from "../models/GameRound.js";
import User from "../models/User.js";
import Operator from "../models/Operator.js";
import OperatorGameConfig from "../models/OperatorGameConfig.js";
import { DEFAULT_REV_SHARE, KNOWN_GAMES } from "./config.js";

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

async function userIdsFor(operatorId) {
  // Demo (try-mode) players play fake money — never part of GGR/reports.
  const users = await User.find({ operatorId, isDemo: { $ne: true } }).select("_id");
  return users.map((u) => u._id);
}

function baseMatch(from, to) {
  return { status: { $in: ["lost", "cashed_out"] }, createdAt: { $gte: from, $lte: to } };
}

// Turnover per round = staked (bets + doubles + splits + insurance). Older
// rounds predate the field — fall back to betAmount.
const STAKE = { $ifNull: ["$staked", "$betAmount"] };

// Rev-share % per game for one operator: override or platform default.
export async function revShareMap(operatorId) {
  const rows = await OperatorGameConfig.find({ operatorId }).select("gameType revSharePct");
  const map = {};
  for (const r of rows) if (r.revSharePct != null) map[r.gameType] = r.revSharePct;
  return map;
}

function applyRevShare(games, shareMap) {
  const out = games.map((g) => {
    const pct = shareMap[g.gameType] ?? DEFAULT_REV_SHARE;
    const fee = round2((g.ggr * pct) / 100);
    return { ...g, revSharePct: pct, providerFee: fee, ngr: round2(g.ggr - fee) };
  });
  const totals = out.reduce(
    (a, g) => ({
      rounds: a.rounds + g.rounds,
      totalBets: round2(a.totalBets + g.totalBets),
      totalPayouts: round2(a.totalPayouts + g.totalPayouts),
      ggr: round2(a.ggr + g.ggr),
      providerFee: round2(a.providerFee + g.providerFee),
      ngr: round2(a.ngr + g.ngr),
    }),
    { rounds: 0, totalBets: 0, totalPayouts: 0, ggr: 0, providerFee: 0, ngr: 0 }
  );
  return { games: out, totals };
}

// Per-game summary + rev-share for ONE operator (the partner view, and the
// admin's operator-detail view).
export async function operatorReport(operatorId, from, to) {
  const [userIds, shareMap] = await Promise.all([userIdsFor(operatorId), revShareMap(operatorId)]);
  const rows = await GameRound.aggregate([
    { $match: { userId: { $in: userIds }, ...baseMatch(from, to) } },
    { $group: { _id: "$gameType", rounds: { $sum: 1 }, totalBets: { $sum: STAKE }, totalPayouts: { $sum: "$payout" } } },
  ]);
  const games = rows.map((r) => ({
    gameType: r._id,
    rounds: r.rounds,
    totalBets: round2(r.totalBets),
    totalPayouts: round2(r.totalPayouts),
    ggr: round2(r.totalBets - r.totalPayouts),
  }));
  return applyRevShare(games, shareMap);
}

// Daily GGR series for charts (one operator, or null for platform-wide).
export async function dailySeries(operatorId, from, to) {
  const match = { ...baseMatch(from, to) };
  if (operatorId) match.userId = { $in: await userIdsFor(operatorId) };
  const rows = await GameRound.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        rounds: { $sum: 1 },
        bets: { $sum: STAKE },
        payouts: { $sum: "$payout" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => ({ date: r._id, rounds: r.rounds, ggr: round2(r.bets - r.payouts) }));
}

// Platform-wide TOTALS card row for the admin: turnover, money returned to
// players, gross stakes lost, GGR and our provider revenue — all over a date
// range. Revenue reuses platformSummary's audited per-operator rev-share math
// (direct-player GGR is 100% ours) so it can never disagree with the per-
// operator table.
export async function platformTotals(from, to) {
  const [summary, rows] = await Promise.all([
    platformSummary(from, to),
    GameRound.aggregate([
      { $match: baseMatch(from, to) },
      { $group: { _id: "$status", rounds: { $sum: 1 }, staked: { $sum: STAKE }, payout: { $sum: "$payout" } } },
    ]),
  ]);

  let wagered = 0, payouts = 0, lostStake = 0, wonRounds = 0, lostRounds = 0;
  for (const r of rows) {
    wagered = round2(wagered + r.staked);
    payouts = round2(payouts + r.payout);
    if (r._id === "lost") { lostStake = round2(lostStake + r.staked); lostRounds += r.rounds; }
    if (r._id === "cashed_out") { wonRounds += r.rounds; }
  }

  return {
    wagered,                         // turnover (Σ staked)
    won: payouts,                    // money returned to players (Σ payout)
    lost: lostStake,                 // stakes fully lost on losing rounds
    ggr: round2(wagered - payouts),  // house gross = wagered − won
    revenue: summary.totals.providerRevenue, // OUR cut (rev-share + all direct GGR)
    rounds: wonRounds + lostRounds,
    wonRounds,
    lostRounds,
  };
}

// Platform-wide rollup, one row per operator (plus the "direct" bucket) with
// per-game rev-share applied before rolling up to operator level.
export async function platformSummary(from, to) {
  const rows = await GameRound.aggregate([
    { $match: baseMatch(from, to) },
    { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    {
      $group: {
        _id: { operatorId: { $ifNull: ["$user.operatorId", "direct"] }, gameType: "$gameType" },
        rounds: { $sum: 1 },
        totalBets: { $sum: STAKE },
        totalPayouts: { $sum: "$payout" },
      },
    },
  ]);

  const [operators, allShares] = await Promise.all([
    Operator.find().select("name active createdAt"),
    OperatorGameConfig.find().select("operatorId gameType revSharePct"),
  ]);
  const shareByOpGame = new Map();
  for (const s of allShares) {
    if (s.revSharePct != null) shareByOpGame.set(`${s.operatorId}:${s.gameType}`, s.revSharePct);
  }
  const opById = new Map(operators.map((o) => [o._id.toString(), o]));

  const byOperator = new Map();
  for (const r of rows) {
    const opKey = r._id.operatorId.toString();
    const isDirect = opKey === "direct";
    const pct = isDirect ? 0 : (shareByOpGame.get(`${opKey}:${r._id.gameType}`) ?? DEFAULT_REV_SHARE);
    const ggr = round2(r.totalBets - r.totalPayouts);
    const fee = isDirect ? ggr : round2((ggr * pct) / 100); // direct GGR is all ours
    const cur = byOperator.get(opKey) || { rounds: 0, totalBets: 0, totalPayouts: 0, ggr: 0, providerRevenue: 0 };
    byOperator.set(opKey, {
      rounds: cur.rounds + r.rounds,
      totalBets: round2(cur.totalBets + r.totalBets),
      totalPayouts: round2(cur.totalPayouts + r.totalPayouts),
      ggr: round2(cur.ggr + ggr),
      providerRevenue: round2(cur.providerRevenue + fee),
    });
  }

  // per-operator rev-share map for display, covering EVERY known game —
  // hardcoding game names here is how War's rev-share went missing once.
  const sharesFor = (opKey) =>
    Object.fromEntries(KNOWN_GAMES.map((g) => [g, shareByOpGame.get(`${opKey}:${g}`) ?? DEFAULT_REV_SHARE]));

  const out = [];
  for (const [opKey, stats] of byOperator) {
    const op = opById.get(opKey);
    const isDirect = opKey === "direct";
    out.push({
      operatorId: isDirect ? null : opKey,
      operator: isDirect ? "Direct players" : (op?.name || "Unknown"),
      active: isDirect ? true : !!op?.active,
      revShare: isDirect ? null : sharesFor(opKey),
      ...stats,
      ngr: round2(stats.ggr - stats.providerRevenue),
    });
  }
  // operators with zero rounds still appear (new signups)
  for (const op of operators) {
    if (!byOperator.has(op._id.toString())) {
      out.push({
        operatorId: op._id.toString(), operator: op.name, active: op.active,
        revShare: sharesFor(op._id.toString()),
        rounds: 0, totalBets: 0, totalPayouts: 0, ggr: 0, providerRevenue: 0, ngr: 0,
      });
    }
  }
  out.sort((a, b) => b.ggr - a.ggr);

  const totals = out.reduce(
    (a, o) => ({
      rounds: a.rounds + o.rounds,
      ggr: round2(a.ggr + o.ggr),
      providerRevenue: round2(a.providerRevenue + o.providerRevenue),
    }),
    { rounds: 0, ggr: 0, providerRevenue: 0 }
  );
  return { operators: out, totals };
}
