// STAR LANDER routes. INSTANT family, like Sugar Rush: one POST resolves the
// whole flight — every pickup, every meteor strike, and the landing — then
// debits, credits and answers with the script the screen replays. Nothing is
// decided on the client, and there is no cashout to press: the flight ends
// itself.
import express from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/requireAuth.js";
import { ensureActiveSeed, rollMany } from "../lib/fair.js";
import { getEffectiveGameConfig } from "../lib/config.js";
import { debit, credit } from "../lib/wallet.js";
import { truncate } from "../lib/money.js";
import GameRound from "../models/GameRound.js";
import { playRound, landerTable } from "../lib/games/lander.js";

const router = express.Router();

// what the player sees before betting: the item set, the dock odds at the
// current edge, and the bet window
router.get("/lander/table", requireAuth, async (_req, res) => {
  try {
    res.json(await landerTable());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /lander/spin { betAmount } ────────────────────────────────────────
router.post("/lander/spin", requireAuth, async (req, res) => {
  try {
    const config = await getEffectiveGameConfig("lander");
    if (!config.enabled) return res.status(403).json({ error: "Game disabled" });

    const betAmount = truncate(Number(req.body?.betAmount), 2);
    if (!Number.isFinite(betAmount) || betAmount < config.minBet || betAmount > config.maxBet) {
      return res.status(400).json({ error: `Bet must be between ${config.minBet} and ${config.maxBet}` });
    }

    const seed = await ensureActiveSeed(req.userId);
    const roundId = new mongoose.Types.ObjectId();
    const paid = await debit(req.userId, betAmount, { roundId });
    if (!paid.ok) return res.status(400).json({ error: paid.error });

    try {
      // a map costs ~4 rolls per spawn slot + mines; 200 covers the longest
      const batch = await rollMany(seed._id, 200);
      let cursor = 0;
      const next = () => batch[cursor++].roll;

      const result = playRound({
        next,
        houseEdge: config.houseEdge,
        maxWinMultiplier: config.maxWinMultiplier ?? 250,
      });

      const payout = truncate(betAmount * result.multiplier, 2);

      await GameRound.create({
        _id: roundId,
        userId: req.userId,
        gameType: "lander",
        betAmount,
        houseEdge: config.houseEdge,
        seedId: seed._id,
        nonceStart: batch[0].nonce,
        status: payout > 0 ? "cashed_out" : "lost",
        payout,
        staked: betAmount,
        state: {
          landed: result.landed,
          counter: result.counter,
          multiplier: result.multiplier,
          generosity: result.map.gen,
          worldLen: Math.round(result.map.len),
          events: result.map.ev.length,
          rollsUsed: cursor,
          nonceStart: batch[0].nonce,
        },
      });

      if (payout > 0) {
        const credited = await credit(req.userId, payout, { roundId });
        if (!credited.ok) console.error(`Lander credit failed round=${roundId}:`, credited.error);
      }

      res.json({
        roundId,
        map: result.map,               // the client simulates this, identically
        landed: result.landed,
        counter: result.counter,
        multiplier: result.multiplier,
        hits: result.hits,
        durationS: result.durationS,
        payout,
      });
    } catch (err) {
      // the stake is already taken; a resolution failure must give it back
      await credit(req.userId, betAmount, { roundId }).catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
