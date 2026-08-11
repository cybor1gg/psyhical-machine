import { Router } from "express";
import GameConfig from "../models/GameConfig.js";
import GameRound from "../models/GameRound.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { invalidateGameConfig, getGameConfig, KNOWN_GAMES, RTP_CONFIGURABLE } from "../lib/config.js";
import { logAudit } from "../lib/audit.js";
import { parseRange, platformTotals } from "../lib/reports.js";

const router = Router();

// Identity check for the backoffice guard. Deliberately NOT /api/me: that
// endpoint answers with the MACHINE session on a kiosk, which would bounce
// admins before they ever reached the login form. This one only answers to
// the admin_token cookie.
router.get("/me", requireAdmin, (req, res) => {
  res.json({ email: req.user.email });
});

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
      // The platform RTP window. Omitted fields keep their stored values —
      // never silently reset.
      const min = houseEdgeMin ?? before.houseEdgeMin ?? 0.005;
      const max = houseEdgeMax ?? before.houseEdgeMax ?? 0.1;
      if (typeof min !== "number" || typeof max !== "number" || min < 0 || max > 0.5 || min > max) {
        return res.status(400).json({ error: "houseEdgeMin/Max must satisfy 0 <= min <= max <= 0.5" });
      }
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

// ── GET /summary?from&to — platform totals cards for the Bets page ─────────
router.get("/summary", requireAdmin, async (req, res) => {
  try {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    res.json(await platformTotals(range.from, range.to));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /rounds — the global bets feed ──────────────────────────────────────
// Multi-select filters, applied in the QUERY (correct across pagination):
//   games=hilo,dice        gameType $in
//   status=cashed_out|lost|active
router.get("/rounds", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = Math.max(0, parseInt(req.query.skip) || 0);
    const q = {};

    const games = (req.query.games || "").split(",").filter((g) => KNOWN_GAMES.includes(g));
    if (games.length) q.gameType = { $in: games };
    if (["cashed_out", "lost", "active"].includes(req.query.status)) q.status = req.query.status;

    const rounds = await GameRound.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

    const userIds = [...new Set(rounds.map((r) => r.userId?.toString()).filter(Boolean))];
    const users = await User.find({ _id: { $in: userIds } }).select("email cabinetId").lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const rows = rounds.map((r) => {
      const u = userMap.get(r.userId?.toString());
      return {
        roundId: r._id,
        createdAt: r.createdAt,
        gameType: r.gameType,
        player: u?.cabinetId || u?.email || "—",
        betAmount: r.betAmount,
        staked: r.staked ?? r.betAmount,
        payout: r.payout ?? 0,
        status: r.status,
      };
    });

    res.json({ rounds: rows, skip, limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /audit — recent config/lifecycle changes ────────────────────────────
router.get("/audit", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const entries = await AuditLog.find().sort({ createdAt: -1 }).limit(limit);
    res.json(entries.map((e) => ({
      at: e.createdAt,
      actorType: e.actorType,
      actor: e.actorLabel,
      operator: null,
      action: e.action,
      gameType: e.gameType,
      before: e.before,
      after: e.after,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
