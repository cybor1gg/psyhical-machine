// Dice routes. INSTANT family: `start` resolves the whole round in one
// response — debit, one roll, settle, credit. There is never an active round,
// so `active` always answers { active: false } (the lifecycle trio holds).
//
// DRAW ORDER (published): one nonce → the roll. See lib/games/dice.js.

import { Router } from "express";
import mongoose from "mongoose";
import GameRound from "../models/GameRound.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getEffectiveGameConfig } from "../lib/config.js";
import { debit, credit, resolveWalletForRollback } from "../lib/wallet.js";
import { remoteRollback } from "../lib/walletRemote.js";
import { ensureActiveSeed, rollMany } from "../lib/fair.js";
import { truncate } from "../lib/money.js";
import { rollFromFloat, winChance, multiplierFor, isWin, parseTarget } from "../lib/games/dice.js";

const router = Router();

// ── POST /dice/start { betAmount, target, over } ────────────────────────────
router.post("/dice/start", requireAuth, async (req, res) => {
  try {
    const [user, seed] = await Promise.all([
      User.findById(req.userId).select("operatorId externalId isDemo"),
      ensureActiveSeed(req.userId),
    ]);

    const config = await getEffectiveGameConfig("dice", user?.operatorId ?? null);
    if (!config.enabled) return res.status(403).json({ error: "Game disabled" });

    const { betAmount, over } = req.body ?? {};
    const target100 = parseTarget(req.body?.target);
    if (target100 == null) {
      return res.status(400).json({ error: "target must be between 2.00 and 98.00" });
    }
    if (typeof over !== "boolean") {
      return res.status(400).json({ error: "over must be true or false" });
    }
    if (!Number.isFinite(betAmount) || betAmount < config.minBet || betAmount > config.maxBet) {
      return res.status(400).json({ error: `Bet must be between ${config.minBet} and ${config.maxBet}` });
    }
    if (!seed) return res.status(400).json({ error: "No active seed" });

    // Pre-generate the round id so the opening debit already carries it —
    // operators group wallet calls by round, and a roundless debit next to
    // a rounded credit reads as two different rounds on their side.
    const roundId = new mongoose.Types.ObjectId();
    const paid = await debit(req.userId, betAmount, { user, roundId });
    if (!paid.ok) return res.status(400).json({ error: paid.error });

    try {
      const [r] = await rollMany(seed._id, 1);
      const roll100 = rollFromFloat(r.roll);
      const won = isWin(roll100, target100, over);
      const multiplier = multiplierFor(target100, over, config.houseEdge, config.maxWinMultiplier);
      const payout = won ? truncate(betAmount * multiplier, 2) : 0;

      const state = { target100, over, roll100, nonce: r.nonce };
      const [round, credited] = await Promise.all([
        GameRound.create({
          _id: roundId,
          userId: req.userId,
          gameType: "dice",
          betAmount,
          houseEdge: config.houseEdge,
          seedId: seed._id,
          nonceStart: r.nonce,
          status: won ? "cashed_out" : "lost",
          payout,
          staked: betAmount,
          state,
        }),
        payout > 0 ? credit(req.userId, payout, { user, roundId }) : Promise.resolve(null),
      ]);

      return res.json({
        roundId: round._id,
        roll: roll100 / 100,
        target: target100 / 100,
        over,
        won,
        multiplier,
        winChance: winChance(target100, over),
        status: won ? "cashed_out" : "lost",
        payout,
        totalStaked: betAmount,
        balance: credited?.ok ? credited.balance : paid.balance,
        nonce: r.nonce,
      });
    } catch (err) {
      console.error("Dice roll failed after debit — attempting rollback:", err);
      if (paid.txId) {
        const { user: u, operator } = await resolveWalletForRollback(req.userId);
        if (operator) await remoteRollback(operator, paid.txId, u);
      }
      return res.status(500).json({ error: "Round could not be started; bet refunded" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /dice/active — instant games never have an active round ─────────────
router.get("/dice/active", requireAuth, (_req, res) => {
  res.json({ active: false });
});

export default router;
