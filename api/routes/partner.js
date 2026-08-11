// Partner portal API — what operators see. Tenancy rule: operatorId is ALWAYS
// req.operatorId (from the verified op_token), never a request parameter.
import { Router } from "express";
import bcrypt from "bcryptjs";
import OperatorUser from "../models/OperatorUser.js";
import Operator from "../models/Operator.js";
import OperatorGameConfig from "../models/OperatorGameConfig.js";
import GameRound from "../models/GameRound.js";
import User from "../models/User.js";
import { requireOperatorPortal } from "../middleware/requireOperatorPortal.js";
import { createPortalToken } from "../lib/auth.js";
import { getGameConfig, invalidateGameConfig, DEFAULT_REV_SHARE, KNOWN_GAMES, RTP_CONFIGURABLE } from "../lib/config.js";
import { parseRange, operatorReport, dailySeries } from "../lib/reports.js";
import { logAudit } from "../lib/audit.js";

const router = Router();
const GAME_TYPES = KNOWN_GAMES;

// Simple in-memory login throttle: 5 attempts per email+IP per 15 minutes.
// (Per-process only — enough to blunt online guessing in this deployment.)
const attempts = new Map();
function throttled(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && now < a.resetAt && a.count >= 5) return true;
  if (!a || now >= a.resetAt) attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
  else a.count++;
  return false;
}

// ── POST /login ────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    if (throttled(`${req.ip}:${email.toLowerCase()}`)) {
      return res.status(429).json({ error: "Too many attempts — try again in a few minutes" });
    }

    const user = await OperatorUser.findOne({ email: email.toLowerCase() });
    // Same error for wrong email and wrong password — don't leak which.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const operator = await Operator.findById(user.operatorId).select("name active");
    if (!operator || !operator.active) return res.status(403).json({ error: "Operator inactive" });

    res.cookie("op_token", createPortalToken(user._id.toString(), user.operatorId.toString()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24,
      path: "/",
    });
    res.json({ email: user.email, operator: operator.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("op_token", { httpOnly: true, path: "/" });
  res.json({ ok: true });
});

router.get("/me", requireOperatorPortal, async (req, res) => {
  const user = await OperatorUser.findById(req.operatorUserId).select("email");
  res.json({ email: user?.email, operator: req.operatorName });
});

// ── GET /report?from&to — their economics: GGR, our fee, their NGR ─────────
router.get("/report", requireOperatorPortal, async (req, res) => {
  try {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const [report, daily] = await Promise.all([
      operatorReport(req.operatorId, range.from, range.to),
      dailySeries(req.operatorId, range.from, range.to),
    ]);
    res.json({ operator: req.operatorName, ...report, daily });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /config — per game: effective RTP, allowed window, rev-share ───────
router.get("/config", requireOperatorPortal, async (req, res) => {
  try {
    const overrides = await OperatorGameConfig.find({ operatorId: req.operatorId });
    const games = [];
    for (const gameType of GAME_TYPES) {
      const base = await getGameConfig(gameType);
      const ov = overrides.find((o) => o.gameType === gameType);
      const effective = ov?.houseEdge != null
        ? Math.min(Math.max(ov.houseEdge, base.houseEdgeMin), base.houseEdgeMax)
        : base.houseEdge;
      games.push({
        gameType,
        rtpConfigurable: RTP_CONFIGURABLE.includes(gameType),
        houseEdge: effective,
        rtp: Math.round((1 - effective) * 10000) / 100, // e.g. 99 (%)
        bounds: {
          min: base.houseEdgeMin, max: base.houseEdgeMax,
          rtpMin: Math.round((1 - base.houseEdgeMax) * 10000) / 100,
          rtpMax: Math.round((1 - base.houseEdgeMin) * 10000) / 100,
        },
        revSharePct: ov?.revSharePct ?? DEFAULT_REV_SHARE,
      });
    }
    res.json({ operator: req.operatorName, games });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── PUT /config { gameType, houseEdge } — RTP within the platform window ───
router.put("/config", requireOperatorPortal, async (req, res) => {
  try {
    const { gameType, houseEdge } = req.body ?? {};
    if (!RTP_CONFIGURABLE.includes(gameType)) {
      return res.status(400).json({ error: "RTP is rules-based for this game and not configurable" });
    }
    const base = await getGameConfig(gameType);
    if (typeof houseEdge !== "number" || houseEdge < base.houseEdgeMin || houseEdge > base.houseEdgeMax) {
      return res.status(400).json({
        error: `houseEdge must be between ${base.houseEdgeMin} and ${base.houseEdgeMax}`,
      });
    }

    const before = await OperatorGameConfig.findOne({ operatorId: req.operatorId, gameType });
    const after = await OperatorGameConfig.findOneAndUpdate(
      { operatorId: req.operatorId, gameType },
      { $set: { houseEdge } },   // rev-share untouched — that's the provider's field
      { upsert: true, returnDocument: "after" }
    );
    invalidateGameConfig(gameType, req.operatorId.toString());

    const user = await OperatorUser.findById(req.operatorUserId).select("email");
    logAudit({
      actorType: "operator", actorId: req.operatorUserId, actorLabel: user?.email,
      operatorId: req.operatorId, action: "operator.rtp.update", gameType,
      before: { houseEdge: before?.houseEdge ?? null },
      after: { houseEdge: after.houseEdge },
    });
    res.json({ gameType, houseEdge: after.houseEdge, rtp: Math.round((1 - after.houseEdge) * 10000) / 100 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /rounds — their recent settled rounds (playerId = their external id) ─
router.get("/rounds", requireOperatorPortal, async (req, res) => {
  try {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));

    // Demo (try-mode) players play fake money — never part of the rounds feed.
    const users = await User.find({ operatorId: req.operatorId, isDemo: { $ne: true } }).select("_id externalId");
    const externalById = new Map(users.map((u) => [u._id.toString(), u.externalId]));
    const filter = {
      userId: { $in: users.map((u) => u._id) },
      status: { $in: ["lost", "cashed_out"] },
      createdAt: { $gte: range.from, $lte: range.to },
    };
    const [rounds, total] = await Promise.all([
      GameRound.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .select("gameType status betAmount staked payout createdAt userId"),
      GameRound.countDocuments(filter),
    ]);
    res.json({
      page, limit, total, totalPages: Math.ceil(total / limit),
      rounds: rounds.map((r) => ({
        roundId: r._id,
        playerId: externalById.get(r.userId.toString()) || null,
        gameType: r.gameType,
        status: r.status,
        betAmount: r.staked ?? r.betAmount,
        payout: r.payout,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
