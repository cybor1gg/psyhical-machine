// SUGAR RUSH routes. INSTANT family: one POST resolves the entire round —
// the paid spin, every tumble it causes, and any free spins it wins — then
// debits, credits and answers with the whole choreography for the screen to
// replay. Nothing is decided on the client.
import express from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/requireAuth.js";
import { ensureActiveSeed, rollMany } from "../lib/fair.js";
import { getEffectiveGameConfig } from "../lib/config.js";
import { debit, credit } from "../lib/wallet.js";
import { truncate } from "../lib/money.js";
import GameRound from "../models/GameRound.js";
import { playRound, scaledPays, PAYS, SCATTER_PAYS, SYMBOLS, COLS, ROWS, MIN_CLUSTER } from "../lib/games/bonanza.js";

const router = express.Router();

// The paytable the player is looking at, at this game's current edge.
router.get("/bonanza/table", requireAuth, async (_req, res) => {
  try {
    const config = await getEffectiveGameConfig("bonanza");
    const pays = scaledPays(config.houseEdge);
    res.json({
      cols: COLS, rows: ROWS, minCluster: MIN_CLUSTER,
      symbols: SYMBOLS.map((s) => ({ id: s.id, kind: s.kind })),
      pays: pays.symbols, scatter: pays.scatter,
      minBet: config.minBet, maxBet: config.maxBet,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// A round needs an unknown number of rolls — tumbles and free spins are
// open-ended — so nonces are claimed in blocks and topped up on demand. Every
// roll still comes from the published chain in order, so the whole round
// replays from the seed pair exactly like any other game here.
function rollSource(seedId) {
  const rolls = [];       // every roll claimed, in nonce order — never dropped
  let cursor = 0;
  let first = null;
  return {
    async pump(n) {
      const batch = await rollMany(seedId, n);
      if (first == null) first = batch[0].nonce;
      for (const b of batch) rolls.push(b.roll);
    },
    // Replays start from the beginning of the SAME array, so topping up only
    // ever extends the tail: the round stays deterministic and nonceStart
    // keeps describing it. Advancing the cursor across a retry instead would
    // have produced a round nobody could verify.
    reset() { cursor = 0; },
    next() {
      if (cursor >= rolls.length) throw new Error("need more rolls");
      return rolls[cursor++];
    },
    get nonceStart() { return first; },
    get consumed() { return cursor; },
  };
}

// ── POST /bonanza/spin { betAmount } ───────────────────────────────────────
router.post("/bonanza/spin", requireAuth, async (req, res) => {
  try {
    const seed = await ensureActiveSeed(req.userId);
    if (!seed) return res.status(400).json({ error: "No active seed" });

    const config = await getEffectiveGameConfig("bonanza");
    if (!config.enabled) return res.status(403).json({ error: "Game disabled" });

    const { betAmount } = req.body ?? {};
    if (!Number.isFinite(betAmount) || betAmount < config.minBet || betAmount > config.maxBet) {
      return res.status(400).json({ error: `Bet must be between ${config.minBet} and ${config.maxBet}` });
    }

    const roundId = new mongoose.Types.ObjectId();
    const paid = await debit(req.userId, betAmount, { roundId });
    if (!paid.ok) return res.status(400).json({ error: paid.error });

    try {
      // A base spin needs 30 symbols; tumbles and free spins need more. Claim
      // a generous block, then top up in the (rare) event a long free-spin run
      // outgrows it.
      const src = rollSource(seed._id);
      await src.pump(400);
      let result = null;
      for (let attempt = 0; attempt < 30 && result === null; attempt++) {
        try {
          src.reset();
          result = playRound({
            next: () => src.next(),
            houseEdge: config.houseEdge,
            maxWinMultiplier: config.maxWinMultiplier,
          });
        } catch (e) {
          if (!/need more rolls/.test(e.message)) throw e;
          await src.pump(400); // extend the tail, then replay from the start
        }
      }
      if (!result) throw new Error("round did not resolve");

      const multiplier = result.totalMultiplier;
      const payout = truncate(betAmount * multiplier, 2);

      const round = await GameRound.create({
        _id: roundId,
        userId: req.userId,
        gameType: "bonanza",
        betAmount,
        houseEdge: config.houseEdge,
        seedId: seed._id,
        nonceStart: src.nonceStart,
        status: payout > 0 ? "cashed_out" : "lost",
        payout,
        staked: betAmount,
        state: {
          multiplier,
          freeSpinsAwarded: result.freeSpinsAwarded,
          payFactor: result.payFactor,
          nonceStart: src.nonceStart,
          rollsUsed: src.consumed,
        },
      });

      const creditStarted = payout > 0
        ? credit(req.userId, payout, { roundId }).catch((err) => {
            console.error(`Bonanza credit failed round=${roundId}:`, err?.message);
            return null;
          })
        : null;
      const projected = paid.balance == null ? null : +(paid.balance + payout).toFixed(2);
      void creditStarted;

      return res.json({
        roundId: round._id,
        betAmount,
        // the whole round, spin by spin, for the screen to play out
        rounds: result.rounds,
        freeSpinsAwarded: result.freeSpinsAwarded,
        multiplier,
        cappedAt: result.cappedAt,
        payout,
        won: payout > 0,
        totalStaked: betAmount,
        balance: projected,
        nonceStart: src.nonceStart,
      });
    } catch (err) {
      console.error("Bonanza spin failed after debit — refunding:", err);
      await credit(req.userId, betAmount, { roundId }).catch(() => {});
      return res.status(500).json({ error: "Spin failed" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Instant game — there is never a round to resume.
router.get("/bonanza/active", requireAuth, (_req, res) => res.json({ active: false }));

export default router;
