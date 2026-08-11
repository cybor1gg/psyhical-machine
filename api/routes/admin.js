import { Router } from "express";
import GameConfig from "../models/GameConfig.js";
import Operator from "../models/Operator.js";
import GameRound from "../models/GameRound.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { invalidateGameConfig, getGameConfig, KNOWN_GAMES, RTP_CONFIGURABLE } from "../lib/config.js";
import { logAudit } from "../lib/audit.js";
import { generateApiKey, hashApiKey } from "../lib/operators.js";
import { generateSharedSecret } from "../lib/signing.js";

const router = Router();

router.get("/config", requireAdmin, async (req, res) => {
  try {
    // Ensure every known game has a config doc (new games appear in the
    // backoffice before anyone has played them).
    await Promise.all(KNOWN_GAMES.map((g) => getGameConfig(g)));
    const configs = await GameConfig.find();
    // rtpConfigurable comes from lib/config.js — the ONE list that decides
    // which games are formula-priced. The UI must never keep its own copy.
    res.json(configs.map((c) => ({ ...c.toObject(), rtpConfigurable: RTP_CONFIGURABLE.includes(c.gameType) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/config", requireAdmin, async (req, res) => {
  try {
    const { gameType, houseEdge, minBet, maxBet, enabled, houseEdgeMin, houseEdgeMax } = req.body ?? {};

    if (!KNOWN_GAMES.includes(gameType)) {
      return res.status(400).json({ error: "Unknown gameType" });
    }
    const rtpConfigurable = RTP_CONFIGURABLE.includes(gameType);
    await getGameConfig(gameType); // ensure the doc exists (created from DEFAULTS)
    const before = await GameConfig.findOne({ gameType });

    // Bet bounds guard every wager on every game — a null/NaN/negative bound
    // (e.g. a cleared form field arriving as JSON null) would reject ALL bets
    // for the game, so they are validated as strictly as the RTP fields.
    if (!Number.isFinite(minBet) || !Number.isFinite(maxBet) || minBet < 0 || maxBet <= 0 || minBet > maxBet) {
      return res.status(400).json({ error: "minBet/maxBet must be numbers with 0 <= minBet <= maxBet" });
    }
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be true or false" });
    }

    // RTP fields only exist as dials on formula-priced games. Rules-priced
    // games (blackjack, war, roulette, baccarat) earn their edge from the
    // rules — whatever the client sends, their stored RTP fields stay put.
    let rtpFields = {};
    if (rtpConfigurable) {
      if (typeof houseEdge !== "number" || houseEdge < 0 || houseEdge > 0.5) {
        return res.status(400).json({ error: "houseEdge must be a fraction between 0 and 0.5 (e.g. 0.01 = 1%)" });
      }
      // The platform RTP window operators may configure within. Omitted
      // fields keep their stored values — never silently reset.
      const min = houseEdgeMin ?? before.houseEdgeMin ?? 0.005;
      const max = houseEdgeMax ?? before.houseEdgeMax ?? 0.1;
      if (typeof min !== "number" || typeof max !== "number" || min < 0 || max > 0.5 || min > max) {
        return res.status(400).json({ error: "houseEdgeMin/Max must satisfy 0 <= min <= max <= 0.5" });
      }
      // The platform default must obey its own window — operators WITHOUT an
      // override play the default, and overrides are clamped to this window.
      if (houseEdge < min || houseEdge > max) {
        return res.status(400).json({ error: "Default houseEdge must lie inside the [min, max] window" });
      }
      rtpFields = { houseEdge, houseEdgeMin: min, houseEdgeMax: max };
    }

    const config = await GameConfig.findOneAndUpdate(
      { gameType },
      { minBet, maxBet, enabled, ...rtpFields },
      { returnDocument: "after" }
    );

    invalidateGameConfig(gameType);
    logAudit({
      actorType: "admin", actorId: req.user._id, actorLabel: req.user.email,
      action: "platform.config.update", gameType,
      before: before ? { houseEdge: before.houseEdge, houseEdgeMin: before.houseEdgeMin, houseEdgeMax: before.houseEdgeMax, minBet: before.minBet, maxBet: before.maxBet, enabled: before.enabled } : null,
      after: { houseEdge: config.houseEdge, houseEdgeMin: config.houseEdgeMin, houseEdgeMax: config.houseEdgeMax, minBet: config.minBet, maxBet: config.maxBet, enabled: config.enabled },
    });
    res.json({ ...config.toObject(), rtpConfigurable });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// (GET /operators lives in adminOperators.js — returns the economics rollup)

router.post("/operators", requireAdmin, async (req, res) => {
  try {
    const { name, walletUrl, walletMode } = req.body ?? {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name required" });
    }

    if (walletMode && !["local", "remote"].includes(walletMode)) {
      return res.status(400).json({ error: "walletMode must be 'local' or 'remote'" });
    }

    const existing = await Operator.findOne({ name: name.trim() });
    if (existing) {
      return res.status(409).json({ error: "Operator already exists" });
    }

    const apiKey = generateApiKey();
    const sharedSecret = generateSharedSecret();

    const operator = await Operator.create({
      name: name.trim(),
      apiKeyHash: hashApiKey(apiKey),
      sharedSecret,
      walletUrl: walletUrl || null,
      walletMode: walletMode || "local",
    });

    res.status(201).json({
      id: operator._id,
      name: operator.name,
      apiKey,
      sharedSecret,
      note: "Save the apiKey and sharedSecret now — they will never be shown again.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get Admin Reports by Operators (da vidis kolku imme GGR za site operatore i revenue share nas del)

router.get("/report", requireAdmin, async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(0);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    if (isNaN(from) || isNaN(to) || from > to) {
      return res.status(400).json({ error: "Invalid from/to date (use YYYY-MM-DD)" });
    }

    const rows = await GameRound.aggregate([
      {
        $match: {
          status: { $in: ["lost", "cashed_out"] },
          createdAt: { $gte: from, $lte: to },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $group: {
          _id: { $ifNull: ["$user.operatorId", "direct"] },
          rounds: { $sum: 1 },
          totalBets: { $sum: { $ifNull: ["$staked", "$betAmount"] } },
          totalPayouts: { $sum: "$payout" },
        },
      },
      {
        $lookup: {
          from: "operators",
          localField: "_id",
          foreignField: "_id",
          as: "operator",
        },
      },
    ]);

    const operators = rows.map((r) => ({
      operator: r._id === "direct" ? "Direct players" : (r.operator[0]?.name || "Unknown"),
      rounds: r.rounds,
      totalBets: r.totalBets,
      totalPayouts: r.totalPayouts,
      ggr: Math.round((r.totalBets - r.totalPayouts) * 100) / 100,
    }));

    const totals = operators.reduce(
      (acc, o) => ({
        rounds: acc.rounds + o.rounds,
        totalBets: acc.totalBets + o.totalBets,
        totalPayouts: acc.totalPayouts + o.totalPayouts,
        ggr: Math.round((acc.ggr + o.ggr) * 100) / 100,
      }),
      { rounds: 0, totalBets: 0, totalPayouts: 0, ggr: 0 }
    );

    res.json({ from: from.toISOString(), to: to.toISOString(), operators, totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;