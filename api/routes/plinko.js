// Plinko routes. INSTANT family: `start` debits, claims one nonce per row,
// settles and credits in one response. The response carries the per-row
// directions so the client can animate the EXACT path that decided the
// bucket — presentation replays the fairness chain, never invents it.
//
// Extra verb (like hilo's `table`): GET /plinko/table returns the scaled
// payout table for a rows/risk choice so the buckets render before any bet.

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
import { scaledTable, pathFromRolls, parseRows, parseRisk } from "../lib/games/plinko.js";

const router = Router();

// ── GET /plinko/table?rows&risk — the payout table a bet would play under ──
router.get("/plinko/table", requireAuth, async (req, res) => {
  try {
    const rows = parseRows(req.query.rows);
    const risk = parseRisk(req.query.risk);
    if (rows == null || risk == null) {
      return res.status(400).json({ error: "rows must be 8..16, risk one of low, medium, high" });
    }
    const user = await User.findById(req.userId).select("operatorId");
    const config = await getEffectiveGameConfig("plinko", user?.operatorId ?? null);
    res.json({ rows, risk, table: scaledTable(rows, risk, config.houseEdge, config.maxWinMultiplier) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /plinko/start { betAmount, rows, risk } ────────────────────────────
router.post("/plinko/start", requireAuth, async (req, res) => {
  try {
    const [user, seed] = await Promise.all([
      User.findById(req.userId).select("operatorId externalId isDemo"),
      ensureActiveSeed(req.userId),
    ]);

    const config = await getEffectiveGameConfig("plinko", user?.operatorId ?? null);
    if (!config.enabled) return res.status(403).json({ error: "Game disabled" });

    const { betAmount } = req.body ?? {};
    const rows = parseRows(req.body?.rows);
    const risk = parseRisk(req.body?.risk);
    if (rows == null || risk == null) {
      return res.status(400).json({ error: "rows must be 8..16, risk one of low, medium, high" });
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
      const rolls = await rollMany(seed._id, rows); // one nonce per row, published order
      const { directions, bucket } = pathFromRolls(rolls.map((r) => r.roll));
      const table = scaledTable(rows, risk, config.houseEdge, config.maxWinMultiplier);
      const multiplier = table[bucket];
      const payout = truncate(betAmount * multiplier, 2);
      const won = payout > 0;

      const state = { rows, risk, directions, bucket, multiplier, nonceStart: rolls[0].nonce };
      const round = await GameRound.create({
        _id: roundId,
        userId: req.userId,
        gameType: "plinko",
        betAmount,
        houseEdge: config.houseEdge,
        seedId: seed._id,
        nonceStart: rolls[0].nonce,
        status: payout >= betAmount ? "cashed_out" : payout > 0 ? "cashed_out" : "lost",
        payout,
        staked: betAmount,
        state,
      });

      // The ball's path is decided the moment the debit clears — but plinko
      // ALWAYS pays something (the worst bucket is still 0.2x), so awaiting
      // the credit used to add a second wallet round-trip to every single
      // drop, holding the ball at the top for a payout it would not reach
      // for another ~2.5s of flight. Fire it and answer now: it is already
      // queued (credits take priority over later debits, so ordering holds),
      // it is recorded like any other, and retryFailedCredits() re-delivers
      // it with the same txId if the operator's wallet errors.
      const creditStarted = payout > 0
        ? credit(req.userId, payout, { user, roundId }).catch((err) => {
            console.error(`Plinko credit failed round=${roundId}:`, err?.message);
            return null;
          })
        : null;
      // Reported balance is the post-debit figure plus this round's payout.
      // The operator's wallet stays authoritative — the host page shows its
      // own number, and the ledger self-heals through the sweeper.
      const projected = paid.balance == null ? null : +(paid.balance + payout).toFixed(2);
      void creditStarted;

      return res.json({
        roundId: round._id,
        rows,
        risk,
        directions,          // the exact left/right chain — animate this
        bucket,
        multiplier,
        table,
        won,
        status: payout > 0 ? "cashed_out" : "lost",
        payout,
        totalStaked: betAmount,
        balance: projected,
        nonceStart: rolls[0].nonce,
      });
    } catch (err) {
      console.error("Plinko drop failed after debit — attempting rollback:", err);
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

// ── GET /plinko/active — instant games never have an active round ───────────
router.get("/plinko/active", requireAuth, (_req, res) => {
  res.json({ active: false });
});

export default router;
