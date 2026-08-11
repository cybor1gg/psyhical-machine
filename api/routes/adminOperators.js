// Provider backoffice: operator management, per-operator economics, audit.
// Everything here is admin-only; the partner portal gets its own scoped realm.
import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import Operator from "../models/Operator.js";
import OperatorUser from "../models/OperatorUser.js";
import OperatorGameConfig from "../models/OperatorGameConfig.js";
import AuditLog from "../models/AuditLog.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { getGameConfig, invalidateGameConfig, DEFAULT_REV_SHARE, KNOWN_GAMES, RTP_CONFIGURABLE } from "../lib/config.js";
import { parseRange, operatorReport, dailySeries, platformSummary, platformTotals } from "../lib/reports.js";
import { logAudit } from "../lib/audit.js";

const router = Router();
const GAME_TYPES = KNOWN_GAMES;

// ── GET /operators — the dashboard table: lifetime economics per operator ──
router.get("/operators", requireAdmin, async (req, res) => {
  try {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const summary = await platformSummary(range.from, range.to);
    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /operators/:id — config + portal users for the detail page ─────────
router.get("/operators/:id", requireAdmin, async (req, res) => {
  try {
    const [operator, overrides, portalUsers] = await Promise.all([
      Operator.findById(req.params.id).select("-apiKeyHash -sharedSecret"),
      OperatorGameConfig.find({ operatorId: req.params.id }),
      OperatorUser.find({ operatorId: req.params.id }).select("email createdAt"),
    ]);
    if (!operator) return res.status(404).json({ error: "Operator not found" });

    const games = [];
    for (const gameType of GAME_TYPES) {
      const base = await getGameConfig(gameType);
      const ov = overrides.find((o) => o.gameType === gameType);
      games.push({
        gameType,
        houseEdgeDefault: base.houseEdge,
        houseEdgeOverride: ov?.houseEdge ?? null,
        houseEdgeEffective: ov?.houseEdge != null
          ? Math.min(Math.max(ov.houseEdge, base.houseEdgeMin), base.houseEdgeMax)
          : base.houseEdge,
        bounds: { min: base.houseEdgeMin, max: base.houseEdgeMax },
        revSharePct: ov?.revSharePct ?? DEFAULT_REV_SHARE,
        revShareIsDefault: ov?.revSharePct == null,
        rtpConfigurable: RTP_CONFIGURABLE.includes(gameType),
      });
    }
    res.json({ operator, games, portalUsers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── PUT /operators/:id/wallet { walletUrl } — repoint the operator's wallet ──
// The single most-needed ops knob: when an operator moves domains (or a demo
// points at localhost), their seamless wallet must be repointable WITHOUT
// recreating the operator and rotating keys. Audited like every config write.
router.put("/operators/:id/wallet", requireAdmin, async (req, res) => {
  try {
    const { walletUrl } = req.body ?? {};
    if (typeof walletUrl !== "string" || !/^https?:\/\/.+/i.test(walletUrl.trim())) {
      return res.status(400).json({ error: "walletUrl must be an http(s) URL (e.g. https://casino.example/wallet)" });
    }
    const clean = walletUrl.trim().replace(/\/+$/, ""); // no trailing slash — we append /debit etc.
    const operator = await Operator.findById(req.params.id);
    if (!operator) return res.status(404).json({ error: "Operator not found" });

    const before = operator.walletUrl;
    operator.walletUrl = clean;
    operator.walletMode = "remote";
    await operator.save();
    await logAudit({
      actorId: req.userId, actorType: "admin",
      action: "operator.wallet_url",
      operatorId: operator._id,
      // before/after are the AuditLog schema's payload fields — a `detail`
      // key would be silently stripped and record nothing.
      before: { walletUrl: before },
      after: { walletUrl: clean },
    });
    res.json({ ok: true, walletUrl: clean });
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

// ── GET /rounds — the global bets feed (all operators + direct players) ─────
// Multi-select filters, applied in the QUERY (correct across pagination):
//   games=hilo,dice        gameType $in
//   operators=<id>,direct  rounds by players of those operators; the literal
//                          "direct" selects in-house (no-operator) players
//   status=cashed_out|lost|active
router.get("/rounds", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = Math.max(0, parseInt(req.query.skip) || 0);
    const q = {};

    const games = (req.query.games || "").split(",").filter((g) => GAME_TYPES.includes(g));
    if (games.length) q.gameType = { $in: games };
    if (["cashed_out", "lost", "active"].includes(req.query.status)) q.status = req.query.status;

    const { default: GameRound } = await import("../models/GameRound.js");
    const { default: User } = await import("../models/User.js");

    const opFilter = (req.query.operators || "").split(",").filter(Boolean);
    if (opFilter.length) {
      const or = [];
      const ids = opFilter.filter((x) => x !== "direct");
      if (ids.length) or.push({ operatorId: { $in: ids } });
      if (opFilter.includes("direct")) or.push({ operatorId: null });
      const players = await User.find({ $or: or }).select("_id").lean();
      q.userId = { $in: players.map((p) => p._id) };
    }

    const rounds = await GameRound.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();

    const userIds = [...new Set(rounds.map((r) => r.userId?.toString()).filter(Boolean))];
    const users = await User.find({ _id: { $in: userIds } }).select("externalId email operatorId").lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));
    const opIds = [...new Set(users.map((u) => u.operatorId?.toString()).filter(Boolean))];
    const ops = await Operator.find({ _id: { $in: opIds } }).select("name").lean();
    const opMap = new Map(ops.map((o) => [o._id.toString(), o.name]));

    const rows = rounds.map((r) => {
      const u = userMap.get(r.userId?.toString());
      return {
        roundId: r._id,
        createdAt: r.createdAt,
        gameType: r.gameType,
        player: u?.externalId || u?.email || "—",
        operator: u?.operatorId ? (opMap.get(u.operatorId.toString()) || "?") : "Direct",
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

// ── GET /operators/:id/report?from&to — economics + daily chart ────────────
router.get("/operators/:id/report", requireAdmin, async (req, res) => {
  try {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const [report, daily] = await Promise.all([
      operatorReport(req.params.id, range.from, range.to),
      dailySeries(req.params.id, range.from, range.to),
    ]);
    res.json({ ...report, daily });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── PUT /operators/:id/config — RTP and/or rev-share for one game ──────────
router.put("/operators/:id/config", requireAdmin, async (req, res) => {
  try {
    const { gameType, houseEdge, revSharePct } = req.body ?? {};
    if (!GAME_TYPES.includes(gameType)) {
      return res.status(400).json({ error: "Unknown gameType" });
    }
    const operator = await Operator.findById(req.params.id);
    if (!operator) return res.status(404).json({ error: "Operator not found" });

    const base = await getGameConfig(gameType);
    const set = {};
    if (houseEdge !== undefined) {
      if (houseEdge !== null) {
        if (!RTP_CONFIGURABLE.includes(gameType)) {
          return res.status(400).json({ error: "RTP is rules-based for this game and not configurable" });
        }
        if (typeof houseEdge !== "number" || houseEdge < base.houseEdgeMin || houseEdge > base.houseEdgeMax) {
          return res.status(400).json({
            error: `houseEdge must be between ${base.houseEdgeMin} and ${base.houseEdgeMax}`,
          });
        }
      }
      set.houseEdge = houseEdge; // null clears the override
    }
    if (revSharePct !== undefined) {
      if (revSharePct !== null && (typeof revSharePct !== "number" || revSharePct < 0 || revSharePct > 100)) {
        return res.status(400).json({ error: "revSharePct must be between 0 and 100" });
      }
      set.revSharePct = revSharePct;
    }
    if (!Object.keys(set).length) return res.status(400).json({ error: "Nothing to update" });

    const before = await OperatorGameConfig.findOne({ operatorId: operator._id, gameType });
    const after = await OperatorGameConfig.findOneAndUpdate(
      { operatorId: operator._id, gameType },
      { $set: set },
      { upsert: true, returnDocument: "after" }
    );
    invalidateGameConfig(gameType, operator._id.toString());

    logAudit({
      actorType: "admin", actorId: req.user._id, actorLabel: req.user.email,
      operatorId: operator._id, action: "operator.config.update", gameType,
      before: before ? { houseEdge: before.houseEdge, revSharePct: before.revSharePct } : null,
      after: { houseEdge: after.houseEdge, revSharePct: after.revSharePct },
    });
    res.json({ gameType, houseEdge: after.houseEdge, revSharePct: after.revSharePct });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /operators/:id/portal-user — a backoffice login for the operator ──
// The temp password is returned ONCE (same convention as API credentials).
router.post("/operators/:id/portal-user", requireAdmin, async (req, res) => {
  try {
    const { email } = req.body ?? {};
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });
    const operator = await Operator.findById(req.params.id);
    if (!operator) return res.status(404).json({ error: "Operator not found" });

    const existing = await OperatorUser.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: "Email already registered" });

    const tempPassword = crypto.randomBytes(9).toString("base64url"); // 12 chars
    const user = await OperatorUser.create({
      operatorId: operator._id,
      email,
      passwordHash: await bcrypt.hash(tempPassword, 12),
    });

    logAudit({
      actorType: "admin", actorId: req.user._id, actorLabel: req.user.email,
      operatorId: operator._id, action: "operator.portal-user.create",
      after: { email: user.email },
    });
    res.status(201).json({
      email: user.email,
      tempPassword,
      note: "Share this password with the operator now — it will never be shown again.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /audit — recent config/lifecycle changes ────────────────────────────
router.get("/audit", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const entries = await AuditLog.find().sort({ createdAt: -1 }).limit(limit)
      .populate("operatorId", "name");
    res.json(entries.map((e) => ({
      at: e.createdAt,
      actorType: e.actorType,
      actor: e.actorLabel,
      operator: e.operatorId?.name || null,
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
