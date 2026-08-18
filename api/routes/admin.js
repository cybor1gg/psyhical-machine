import { Router } from "express";
import GameConfig from "../models/GameConfig.js";
import Period from "../models/Period.js";
import GameRound from "../models/GameRound.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import { requireAdmin, requireStaff } from "../middleware/requireAdmin.js";
import { invalidateGameConfig, getGameConfig, KNOWN_GAMES, RTP_CONFIGURABLE } from "../lib/config.js";
import { logAudit } from "../lib/audit.js";
import { parseRange, platformTotals, perGameTotals } from "../lib/reports.js";

const router = Router();

// Identity check for the backoffice guard. Deliberately NOT /api/me: that
// endpoint answers with the MACHINE session on a kiosk, which would bounce
// admins before they ever reached the login form. This one only answers to
// the admin_token cookie.
router.get("/me", requireStaff, (req, res) => {
  // role decides which panel the client routes to
  res.json({ email: req.user.email, role: req.user.role });
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

// the active accounting period; the first call ever creates one covering
// everything the machine has ever done
async function activePeriod() {
  let p = await Period.findOne({ endedAt: null }).sort({ startedAt: -1 });
  if (!p) p = await Period.create({ startedAt: new Date(0) });
  return p;
}

// ── GET /period — the active period and recent closed ones ─────────────────
router.get("/period", requireStaff, async (req, res) => {
  try {
    const current = await activePeriod();
    const history = await Period.find({ endedAt: { $ne: null } }).sort({ endedAt: -1 }).limit(8).lean();
    // THE MASTER PERIOD: the machine's lifetime meters, first play to now.
    // No reset touches these - they are the totals an inspector reads.
    const firstRound = await GameRound.findOne().sort({ createdAt: 1 }).select("createdAt").lean();
    const master = await platformTotals(firstRound ? firstRound.createdAt : new Date(0), new Date());
    res.json({
      current: { startedAt: current.startedAt },
      history,
      master: {
        since: firstRound ? firstRound.createdAt : null,
        ...master,
        rtp: master.wagered > 0 ? Math.round((master.won / master.wagered) * 10000) / 100 : null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /period/reset — close the period, snapshot it, start a new one ────
router.post("/period/reset", requireStaff, async (req, res) => {
  try {
    const current = await activePeriod();
    const now = new Date();
    const totals = await platformTotals(current.startedAt, now);
    const perGame = await perGameTotals(current.startedAt, now);
    current.endedAt = now;
    current.closedBy = req.user.email;
    current.totals = { ...totals, perGame };
    await current.save();
    const next = await Period.create({ startedAt: now });
    logAudit({
      actorType: req.user.role === "operator" ? "operator" : "admin",
      actorId: req.user._id, actorLabel: req.user.email,
      action: "platform.period.reset",
      before: { startedAt: current.startedAt, ggr: totals.ggr, wagered: totals.wagered },
      after: { startedAt: next.startedAt },
    });
    res.json({ current: { startedAt: next.startedAt }, closed: current });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /stats?from&to | ?period=1 — the dashboard in one call ─────────────
router.get("/stats", requireStaff, async (req, res) => {
  try {
    let from, to;
    if (req.query.period) {
      from = (await activePeriod()).startedAt;
      to = new Date();
    } else {
      const range = parseRange(req.query);
      if (range.error) return res.status(400).json({ error: range.error });
      from = range.from; to = range.to;
    }
    const [totals, perGame, configs] = await Promise.all([
      platformTotals(from, to),
      perGameTotals(from, to),
      GameConfig.find().lean(),
    ]);
    const cfgMap = new Map(configs.map((c) => [c.gameType, c]));
    res.json({
      from, to,
      totals: { ...totals, rtp: totals.wagered > 0 ? Math.round((totals.won / totals.wagered) * 10000) / 100 : null },
      perGame: perGame.map((g) => ({
        ...g,
        targetRtp: cfgMap.get(g.gameType)?.houseEdge != null
          ? Math.round((1 - cfgMap.get(g.gameType).houseEdge) * 10000) / 100
          : null,
      })),
    });
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
