// Limbo routes. INSTANT family, exactly like dice: `start` debits, rolls
// once, settles and credits in one response; `active` is always false.
//
// DRAW ORDER (published): one nonce → the roll. See lib/games/limbo.js.

import { Router } from "express";
import mongoose from "mongoose";
import GameRound from "../models/GameRound.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getEffectiveGameConfig } from "../lib/config.js";
import { debit, credit } from "../lib/wallet.js";
import { ensureActiveSeed, rollMany } from "../lib/fair.js";
import { truncate } from "../lib/money.js";
import { resultFromFloat, winChance, parseTarget } from "../lib/games/limbo.js";

const router = Router();

// ── POST /limbo/start { betAmount, target } ─────────────────────────────────
router.post("/limbo/start", requireAuth, async (req, res) => {
  try {
    const seed = await ensureActiveSeed(req.userId);

    const config = await getEffectiveGameConfig("limbo");
    if (!config.enabled) return res.status(403).json({ error: "Game disabled" });

    const { betAmount } = req.body ?? {};
    const target = parseTarget(req.body?.target, config.maxWinMultiplier);
    if (target == null) {
      return res.status(400).json({ error: `target must be between 1.01 and ${config.maxWinMultiplier}` });
    }
    if (!Number.isFinite(betAmount) || betAmount < config.minBet || betAmount > config.maxBet) {
      return res.status(400).json({ error: `Bet must be between ${config.minBet} and ${config.maxBet}` });
    }
    if (!seed) return res.status(400).json({ error: "No active seed" });

    const roundId = new mongoose.Types.ObjectId();
    const paid = await debit(req.userId, betAmount, { roundId });
    if (!paid.ok) return res.status(400).json({ error: paid.error });

    try {
      const [r] = await rollMany(seed._id, 1);
      const result = resultFromFloat(r.roll, config.houseEdge, config.maxWinMultiplier);
      const won = result >= target;
      const payout = won ? truncate(betAmount * target, 2) : 0;

      const state = { target, result, nonce: r.nonce };
      const [round, credited] = await Promise.all([
        GameRound.create({
          _id: roundId,
          userId: req.userId,
          gameType: "limbo",
          betAmount,
          houseEdge: config.houseEdge,
          seedId: seed._id,
          nonceStart: r.nonce,
          status: won ? "cashed_out" : "lost",
          payout,
          staked: betAmount,
          state,
        }),
        payout > 0 ? credit(req.userId, payout, { roundId }) : Promise.resolve(null),
      ]);

      return res.json({
        roundId: round._id,
        result,
        target,
        won,
        winChance: winChance(target, config.houseEdge),
        status: won ? "cashed_out" : "lost",
        payout,
        totalStaked: betAmount,
        balance: credited?.ok ? credited.balance : paid.balance,
        nonce: r.nonce,
      });
    } catch (err) {
      console.error("Limbo roll failed after debit — attempting rollback:", err);
      return res.status(500).json({ error: "Round could not be completed" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /limbo/active — instant games never have an active round ────────────
router.get("/limbo/active", requireAuth, (_req, res) => {
  res.json({ active: false });
});

export default router;
