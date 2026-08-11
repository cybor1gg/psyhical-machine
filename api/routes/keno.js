// Keno routes. INSTANT family: `start` debits, claims 10 nonces (one per
// drawn number, without replacement), settles and credits in one response.
// The client paces the ten reveals; the outcome was decided at the claim.
//
// Extra verb: GET /keno/table returns the scaled payout ladder for a
// risk/pick-count so the UI renders real numbers before any bet.

import { Router } from "express";
import mongoose from "mongoose";
import GameRound from "../models/GameRound.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getEffectiveGameConfig } from "../lib/config.js";
import { debit, credit } from "../lib/wallet.js";
import { ensureActiveSeed, rollMany } from "../lib/fair.js";
import { truncate } from "../lib/money.js";
import { DRAWS, scaledTable, drawnFromRolls, parseRisk, parsePicks } from "../lib/games/keno.js";

const router = Router();

// ── GET /keno/table?risk&picks — the ladder a bet would play under ─────────
router.get("/keno/table", requireAuth, async (req, res) => {
  try {
    const risk = parseRisk(req.query.risk);
    const picks = Number(req.query.picks);
    if (risk == null || !Number.isInteger(picks) || picks < 1 || picks > 10) {
      return res.status(400).json({ error: "risk must be classic/low/medium/high/extreme, picks 1..10" });
    }
    const config = await getEffectiveGameConfig("keno");
    res.json({ risk, picks, table: scaledTable(risk, picks, config.houseEdge, config.maxWinMultiplier) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /keno/start { betAmount, picks: number[], risk } ───────────────────
router.post("/keno/start", requireAuth, async (req, res) => {
  try {
    const seed = await ensureActiveSeed(req.userId);

    const config = await getEffectiveGameConfig("keno");
    if (!config.enabled) return res.status(403).json({ error: "Game disabled" });

    const { betAmount } = req.body ?? {};
    const risk = parseRisk(req.body?.risk);
    const picks = parsePicks(req.body?.picks);
    if (risk == null || picks == null) {
      return res.status(400).json({ error: "picks must be 1-10 distinct numbers 1..40; risk one of classic, low, medium, high, extreme" });
    }
    if (!Number.isFinite(betAmount) || betAmount < config.minBet || betAmount > config.maxBet) {
      return res.status(400).json({ error: `Bet must be between ${config.minBet} and ${config.maxBet}` });
    }
    if (!seed) return res.status(400).json({ error: "No active seed" });

    const roundId = new mongoose.Types.ObjectId();
    const paid = await debit(req.userId, betAmount, { roundId });
    if (!paid.ok) return res.status(400).json({ error: paid.error });

    try {
      const rolls = await rollMany(seed._id, DRAWS); // 10 nonces, published removal rule
      const drawn = drawnFromRolls(rolls.map((r) => r.roll));
      const pickSet = new Set(picks);
      const hits = drawn.filter((n) => pickSet.has(n)).length;
      const table = scaledTable(risk, picks.length, config.houseEdge, config.maxWinMultiplier);
      const multiplier = table[hits] ?? 0;
      const payout = truncate(betAmount * multiplier, 2);

      const state = { risk, picks, drawn, hits, multiplier, nonceStart: rolls[0].nonce };
      const [round, credited] = await Promise.all([
        GameRound.create({
          _id: roundId,
          userId: req.userId,
          gameType: "keno",
          betAmount,
          houseEdge: config.houseEdge,
          seedId: seed._id,
          nonceStart: rolls[0].nonce,
          status: payout > 0 ? "cashed_out" : "lost",
          payout,
          staked: betAmount,
          state,
        }),
        payout > 0 ? credit(req.userId, payout, { roundId }) : Promise.resolve(null),
      ]);

      return res.json({
        roundId: round._id,
        risk,
        picks,
        drawn,               // in draw order — the client reveals them one by one
        hits,
        multiplier,
        table,
        status: payout > 0 ? "cashed_out" : "lost",
        payout,
        totalStaked: betAmount,
        balance: credited?.ok ? credited.balance : paid.balance,
        nonceStart: rolls[0].nonce,
      });
    } catch (err) {
      console.error("Keno draw failed after debit — attempting rollback:", err);
      return res.status(500).json({ error: "Round could not be completed" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /keno/active — instant games never have an active round ─────────────
router.get("/keno/active", requireAuth, (_req, res) => {
  res.json({ active: false });
});

export default router;
