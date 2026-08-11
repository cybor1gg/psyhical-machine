// Roulette routes. INSTANT family: `start` takes the whole bet layout, debits
// the total, spins once (one nonce → pocket), settles every bet and credits in
// one response. `active` is always false.
//
// The client sends only bet SHAPES + stakes; every bet is validated and priced
// server-side (validBet + betMultiplier), so no forged bet type, oversized
// multiplier or fake pocket can change a payout.

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
import { pocketFromRoll, pocketColor, betMultiplier, validBet } from "../lib/games/roulette.js";

const router = Router();

// ── POST /roulette/start { bets: [{ type, n?, ns?, stake }] } ───────────────
router.post("/roulette/start", requireAuth, async (req, res) => {
  try {
    const [user, seed] = await Promise.all([
      User.findById(req.userId).select("operatorId externalId isDemo"),
      ensureActiveSeed(req.userId),
    ]);

    const config = await getEffectiveGameConfig("roulette", user?.operatorId ?? null);
    if (!config.enabled) return res.status(403).json({ error: "Game disabled" });

    const bets = req.body?.bets;
    if (!Array.isArray(bets) || bets.length === 0 || bets.length > 100) {
      return res.status(400).json({ error: "bets must be a non-empty array (max 100)" });
    }
    // validate every bet shape + stake
    let totalStaked = 0;
    for (const b of bets) {
      if (!validBet(b)) return res.status(400).json({ error: "Invalid bet in layout" });
      if (!Number.isFinite(b.stake) || b.stake <= 0) return res.status(400).json({ error: "Each bet needs a positive stake" });
      totalStaked += b.stake;
    }
    totalStaked = truncate(totalStaked, 2);
    if (totalStaked < config.minBet || totalStaked > config.maxBet) {
      return res.status(400).json({ error: `Total stake must be between ${config.minBet} and ${config.maxBet}` });
    }

    if (!seed) return res.status(400).json({ error: "No active seed" });

    // Pre-generate the round id so the opening debit already carries it —
    // operators group wallet calls by round, and a roundless debit next to
    // a rounded credit reads as two different rounds on their side.
    const roundId = new mongoose.Types.ObjectId();
    const paid = await debit(req.userId, totalStaked, { user, roundId });
    if (!paid.ok) return res.status(400).json({ error: paid.error });

    try {
      const [r] = await rollMany(seed._id, 1);
      const pocket = pocketFromRoll(r.roll);

      // price each bet against the winning pocket
      const results = bets.map((b) => {
        const mult = betMultiplier(b, pocket);
        return { ...b, win: truncate(b.stake * mult, 2) };
      });
      const payout = truncate(results.reduce((s, b) => s + b.win, 0), 2);
      const won = payout > 0;

      const state = { pocket, color: pocketColor(pocket), bets: results, nonce: r.nonce };
      const [round, credited] = await Promise.all([
        GameRound.create({
          _id: roundId,
          userId: req.userId,
          gameType: "roulette",
          betAmount: totalStaked,
          houseEdge: config.houseEdge,
          seedId: seed._id,
          nonceStart: r.nonce,
          status: won ? "cashed_out" : "lost",
          payout,
          staked: totalStaked,
          state,
        }),
        payout > 0 ? credit(req.userId, payout, { user, roundId }) : Promise.resolve(null),
      ]);

      return res.json({
        roundId: round._id,
        pocket,
        color: pocketColor(pocket),
        bets: results,
        status: won ? "cashed_out" : "lost",
        payout,
        totalStaked,
        balance: credited?.ok ? credited.balance : paid.balance,
        nonce: r.nonce,
      });
    } catch (err) {
      console.error("Roulette spin failed after debit — attempting rollback:", err);
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

// ── GET /roulette/active — instant games never have an active round ─────────
router.get("/roulette/active", requireAuth, (_req, res) => {
  res.json({ active: false });
});

export default router;
