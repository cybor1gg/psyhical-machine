// Baccarat routes. INSTANT family: `start` takes the bet(s), debits, claims 6
// card nonces atomically, resolves the coup under the fixed tableau, settles
// and credits in one response. `active` is always false.
//
// The client only picks player/banker/tie + stakes; the coup and every payout
// are computed server-side from the fairness chain.

import { Router } from "express";
import mongoose from "mongoose";
import GameRound from "../models/GameRound.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getEffectiveGameConfig } from "../lib/config.js";
import { debit, credit, resolveWalletForRollback } from "../lib/wallet.js";
import { remoteRollback } from "../lib/walletRemote.js";
import { ensureActiveSeed, drawMany } from "../lib/fair.js";
import { truncate } from "../lib/money.js";
import { cardFromIndex } from "../lib/games/hilo.js";
import { resolveCoup, betMultiplier, BET_TYPES } from "../lib/games/baccarat.js";

const router = Router();

// ── POST /baccarat/start { bets: [{ type, stake }] } ────────────────────────
router.post("/baccarat/start", requireAuth, async (req, res) => {
  try {
    const [user, seed] = await Promise.all([
      User.findById(req.userId).select("operatorId externalId isDemo"),
      ensureActiveSeed(req.userId),
    ]);

    const config = await getEffectiveGameConfig("baccarat", user?.operatorId ?? null);
    if (!config.enabled) return res.status(403).json({ error: "Game disabled" });

    const bets = req.body?.bets;
    if (!Array.isArray(bets) || bets.length === 0 || bets.length > 3) {
      return res.status(400).json({ error: "bets must be 1-3 entries (player/banker/tie)" });
    }
    const seen = new Set();
    let totalStaked = 0;
    for (const b of bets) {
      if (!b || !BET_TYPES.includes(b.type)) return res.status(400).json({ error: "Bet type must be player, banker or tie" });
      if (seen.has(b.type)) return res.status(400).json({ error: "Duplicate bet type" });
      seen.add(b.type);
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
      // 6 card nonces, positional (P1 P2 B1 B2 P3 B3); unused slots ignored.
      const draws = await drawMany(seed._id, 6);
      const coup = resolveCoup(draws.map((d) => d.index));

      const results = bets.map((b) => {
        const mult = betMultiplier(b.type, coup.winner);
        return { type: b.type, stake: truncate(b.stake, 2), win: truncate(b.stake * mult, 2) };
      });
      const payout = truncate(results.reduce((s, b) => s + b.win, 0), 2);
      const won = payout > 0;

      const state = {
        winner: coup.winner,
        playerValue: coup.playerValue,
        bankerValue: coup.bankerValue,
        playerCards: coup.player,
        bankerCards: coup.banker,
        bets: results,
        nonceStart: draws[0].nonce,
      };
      const [round, credited] = await Promise.all([
        GameRound.create({
          _id: roundId,
          userId: req.userId,
          gameType: "baccarat",
          betAmount: totalStaked,
          houseEdge: config.houseEdge,
          seedId: seed._id,
          nonceStart: draws[0].nonce,
          status: won ? "cashed_out" : "lost",
          payout,
          staked: totalStaked,
          state,
        }),
        payout > 0 ? credit(req.userId, payout, { user, roundId }) : Promise.resolve(null),
      ]);

      return res.json({
        roundId: round._id,
        winner: coup.winner,
        playerValue: coup.playerValue,
        bankerValue: coup.bankerValue,
        playerCards: coup.player.map(cardFromIndex),
        bankerCards: coup.banker.map(cardFromIndex),
        bets: results,
        status: won ? "cashed_out" : "lost",
        payout,
        totalStaked,
        balance: credited?.ok ? credited.balance : paid.balance,
        nonceStart: draws[0].nonce,
      });
    } catch (err) {
      console.error("Baccarat deal failed after debit — attempting rollback:", err);
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

// ── GET /baccarat/active — instant games never have an active round ─────────
router.get("/baccarat/active", requireAuth, (_req, res) => {
  res.json({ active: false });
});

export default router;
