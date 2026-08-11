import { Router } from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import User from "../models/User.js";
import LaunchToken from "../models/LaunchToken.js";
import GameRound from "../models/GameRound.js";
import Seed from "../models/Seed.js";
import { requireOperator } from "../middleware/requireOperator.js";
import { ensureActiveSeed } from "../lib/fair.js";
import { KNOWN_GAMES } from "../lib/config.js";


const router = Router();

router.get("/ping", requireOperator, (req, res) => {
  res.json({ ok: true, operator: req.operator.name });
});

router.post("/session", requireOperator, async (req, res) => {
  try {
    const { playerId, gameType, mode } = req.body;
    const isDemo = mode === "demo";

    if (!isDemo && (!playerId || typeof playerId !== "string" || !playerId.trim())) {
      return res.status(400).json({ error: "playerId required" });
    }
    if (!KNOWN_GAMES.includes(gameType)) {
      return res.status(400).json({ error: "Unknown gameType" });
    }

    // Demo: an ephemeral anonymous player with a fake local balance. Never
    // touches the operator's wallet (see lib/wallet.js), never counts toward
    // GGR/reports, and Mongo TTL-reaps the user a day later. Every demo
    // launch is a fresh player — no identity, nothing persists.
    const user = isDemo
      ? await User.create({
          operatorId: req.operator._id,
          externalId: `demo:${crypto.randomBytes(9).toString("hex")}`,
          balance: 1000,
          isDemo: true,
          demoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
      : await User.findOneAndUpdate(
          { operatorId: req.operator._id, externalId: playerId.trim() },
          { $setOnInsert: { operatorId: req.operator._id, externalId: playerId.trim(), balance: 1000 } },
          { returnDocument: "after", upsert: true }
        );

    await ensureActiveSeed(user._id);

    const token = crypto.randomBytes(32).toString("hex");

    await LaunchToken.create({
      token,
      userId: user._id,
      operatorId: req.operator._id,
      gameType,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    const baseUrl = process.env.WEB_URL || "http://localhost:3000";

    res.json({
      launchUrl: `${baseUrl}/embed/${gameType}?token=${token}`,
      expiresIn: 300,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---- shared: resolve date range + this operator's players ----
async function reportScope(req) {
  const from = req.query.from ? new Date(req.query.from) : new Date(0);
  const to = req.query.to ? new Date(req.query.to) : new Date();

  if (isNaN(from) || isNaN(to)) return { error: "Invalid from/to date (use YYYY-MM-DD)" };
  if (from > to) return { error: "'from' must be before 'to'" };

  // Demo (try-mode) players play fake money — never part of GGR/reports.
  const users = await User.find({ operatorId: req.operator._id, isDemo: { $ne: true } }).select("_id externalId");
  const userIds = users.map((u) => u._id);
  const externalIdByUser = new Map(users.map((u) => [u._id.toString(), u.externalId]));

  return { from, to, userIds, externalIdByUser };
}

// ---- GET /api/operator/report — GGR summary ----
router.get("/report", requireOperator, async (req, res) => {
  try {
    const scope = await reportScope(req);
    if (scope.error) return res.status(400).json({ error: scope.error });

    const rows = await GameRound.aggregate([
      {
        $match: {
          userId: { $in: scope.userIds },
          status: { $in: ["lost", "cashed_out"] },
          createdAt: { $gte: scope.from, $lte: scope.to },
        },
      },
      {
        $group: {
          _id: "$gameType",
          rounds: { $sum: 1 },
          // staked = full turnover (doubles/splits/insurance); betAmount alone
          // understates blackjack GGR. Fallback covers pre-field rounds.
          totalBets: { $sum: { $ifNull: ["$staked", "$betAmount"] } },
          totalPayouts: { $sum: "$payout" },
        },
      },
    ]);

    const games = rows.map((r) => ({
      gameType: r._id,
      rounds: r.rounds,
      totalBets: r.totalBets,
      totalPayouts: r.totalPayouts,
      ggr: Math.round((r.totalBets - r.totalPayouts) * 100) / 100,
    }));

    const totals = games.reduce(
      (acc, g) => ({
        rounds: acc.rounds + g.rounds,
        totalBets: acc.totalBets + g.totalBets,
        totalPayouts: acc.totalPayouts + g.totalPayouts,
        ggr: Math.round((acc.ggr + g.ggr) * 100) / 100,
      }),
      { rounds: 0, totalBets: 0, totalPayouts: 0, ggr: 0 }
    );

    res.json({
      operator: req.operator.name,
      from: scope.from.toISOString(),
      to: scope.to.toISOString(),
      games,
      totals,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---- GET /api/operator/rounds — paginated round list ----
router.get("/rounds", requireOperator, async (req, res) => {
  try {
    const scope = await reportScope(req);
    if (scope.error) return res.status(400).json({ error: scope.error });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));

    const filter = {
      userId: { $in: scope.userIds },
      status: { $in: ["lost", "cashed_out"] },
      createdAt: { $gte: scope.from, $lte: scope.to },
    };

    const [rounds, total] = await Promise.all([
      GameRound.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("gameType status betAmount staked payout createdAt userId"),
      GameRound.countDocuments(filter),
    ]);

    res.json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      rounds: rounds.map((r) => ({
        roundId: r._id,
        playerId: scope.externalIdByUser.get(r.userId.toString()) || null,
        gameType: r.gameType,
        status: r.status,
        betAmount: r.betAmount,
        staked: r.staked ?? r.betAmount,
        payout: r.payout,
        ggr: Math.round(((r.staked ?? r.betAmount) - r.payout) * 100) / 100,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---- GET /api/operator/rounds/:roundId/fairness — round verification data ──
// Everything a casino needs to let a player verify one round on THEIR
// frontend: the committed seed pair and the round's nonce start. The unhashed
// server seed appears only after the player has rotated the pair (in-game
// Fair Play modal) — until then it stays committed and `serverSeed` is null.
// Call this from your backend (it needs the API key), hand the JSON to your
// page, and recompute with the published per-game draw order.
router.get("/rounds/:roundId/fairness", requireOperator, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.roundId)) {
      return res.status(404).json({ error: "Round not found" });
    }
    const round = await GameRound.findById(req.params.roundId)
      .select("userId gameType status betAmount staked payout nonceStart seedId createdAt");
    if (!round) return res.status(404).json({ error: "Round not found" });

    // scope check: the round must belong to one of THIS operator's players
    const user = await User.findOne({ _id: round.userId, operatorId: req.operator._id }).select("externalId");
    if (!user) return res.status(404).json({ error: "Round not found" });

    const seed = await Seed.findById(round.seedId).select("serverSeed serverSeedHash clientSeed active revealedAt");

    res.json({
      roundId: round._id,
      playerId: user.externalId,
      gameType: round.gameType,
      status: round.status,
      betAmount: round.betAmount,
      staked: round.staked ?? round.betAmount,
      payout: round.payout,
      createdAt: round.createdAt,
      nonceStart: round.nonceStart,
      fairness: seed
        ? {
            serverSeedHash: seed.serverSeedHash,
            clientSeed: seed.clientSeed,
            revealed: !seed.active,
            // committed until the player rotates; never exposed while active
            serverSeed: seed.active ? null : seed.serverSeed,
            revealedAt: seed.revealedAt ?? null,
          }
        : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;