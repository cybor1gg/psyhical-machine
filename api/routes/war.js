// Casino War routes. Most rounds settle in one shot at /war/start; only a
// first-deal tie leaves an active round, waiting on the surrender/war
// decision. No hidden cards — the provable-fairness story is purely the
// nonce chain (player, dealer, then war player, war dealer).
//
// Money: main + both side bets are ONE debit at start; the raise is a second
// debit at /war/war. Side-bet winnings are booked in round state at the deal
// and PAID at settlement — one credit per round. All win math lives in the
// pure resolvers (lib/games/war.js); these routes only move money and state.
//
// The consecutive-tie streak lives on the User (see model) and feeds the
// side-bet ladders and the 4-tie bonus.

import { Router } from "express";
import mongoose from "mongoose";
import GameRound from "../models/GameRound.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getEffectiveGameConfig } from "../lib/config.js";
import { debit, credit } from "../lib/wallet.js";
import { ensureActiveSeed, drawMany } from "../lib/fair.js";
import { truncate } from "../lib/money.js";
import { cardFromIndex, resolveDeal, resolveWar } from "../lib/games/war.js";

const router = Router();

function shape(state, extra = {}) {
  return {
    playerCards: [cardFromIndex(state.playerCard), ...(state.warPlayerCard != null ? [cardFromIndex(state.warPlayerCard)] : [])],
    dealerCards: [cardFromIndex(state.dealerCard), ...(state.warDealerCard != null ? [cardFromIndex(state.warDealerCard)] : [])],
    tieBet: state.tieBet,
    ctieBet: state.ctieBet,
    tieWin: state.tieWin,
    ctieWin: state.ctieWin,
    ...extra,
  };
}

// ── POST /war/start { betAmount, tieBet?, ctieBet? } ────────────────────────
router.post("/war/start", requireAuth, async (req, res) => {
  try {
    const [existing, user, seed] = await Promise.all([
      GameRound.findOne({ userId: req.userId, gameType: "war", status: "active" }).select("_id"),
      User.findById(req.userId).select("warTieStreak"),
      ensureActiveSeed(req.userId),
    ]);

    const config = await getEffectiveGameConfig("war");
    if (!config.enabled) return res.status(403).json({ error: "Game disabled" });

    const { betAmount } = req.body ?? {};
    const tieBet = req.body?.tieBet ?? 0;
    const ctieBet = req.body?.ctieBet ?? 0;
    if (!Number.isFinite(betAmount) || betAmount < config.minBet || betAmount > config.maxBet) {
      return res.status(400).json({ error: `Bet must be between ${config.minBet} and ${config.maxBet}` });
    }
    for (const [label, v] of [["Tie bet", tieBet], ["Coloured tie bet", ctieBet]]) {
      if (!Number.isFinite(v) || v < 0 || v > config.maxBet) {
        return res.status(400).json({ error: `${label} must be between 0 and ${config.maxBet}` });
      }
    }
    if (existing) return res.status(409).json({ error: "Round already active" });
    if (!seed) return res.status(400).json({ error: "No active seed" });

    const totalIn = truncate(betAmount + tieBet + ctieBet, 2);
    const roundId = new mongoose.Types.ObjectId();
    const paid = await debit(req.userId, totalIn, { roundId });
    if (!paid.ok) return res.status(400).json({ error: paid.error });

    try {
      const [p, d] = await drawMany(seed._id, 2); // published order: player, dealer
      const streak = user?.warTieStreak ?? 0;
      const r = resolveDeal({
        playerIndex: p.index, dealerIndex: d.index,
        streak, main: betAmount, tie: tieBet, ctie: ctieBet,
      });
      const draws = [
        { nonce: p.nonce, index: p.index, to: "player" },
        { nonce: d.nonce, index: d.index, to: "dealer" },
      ];
      const state = {
        playerCard: p.index, dealerCard: d.index,
        warPlayerCard: null, warDealerCard: null,
        bet: betAmount, tieBet, ctieBet,
        tieWin: r.tieWin, ctieWin: r.ctieWin,
        streakAtDeal: r.newStreak,
        stage: r.settled ? "settled" : "war",
        result: r.result,
        draws,
      };
      const roundDoc = {
        _id: roundId,
        userId: req.userId,
        gameType: "war",
        betAmount,
        houseEdge: config.houseEdge,
        seedId: seed._id,
        nonceStart: p.nonce,
      };

      if (r.settled) {
        const [round, credited] = await Promise.all([
          GameRound.create({ ...roundDoc, status: r.payout > 0 ? "cashed_out" : "lost", payout: r.payout, staked: totalIn, state }),
          r.payout > 0 ? credit(req.userId, r.payout, { roundId }) : Promise.resolve(null),
          User.updateOne({ _id: req.userId }, { $set: { warTieStreak: r.newStreak } }),
        ]);
        return res.json({
          roundId: round._id,
          stage: "settled",
          result: r.result,
          payout: r.payout,
          totalStaked: totalIn,
          streak: r.newStreak,
          balance: credited?.ok ? credited.balance : paid.balance,
          nonceStart: p.nonce,
          ...shape(state),
        });
      }

      const [round] = await Promise.all([
        GameRound.create({ ...roundDoc, state }),
        User.updateOne({ _id: req.userId }, { $set: { warTieStreak: r.newStreak } }),
      ]);
      return res.json({
        roundId: round._id,
        stage: "war",
        result: null,
        totalStaked: totalIn,
        streak: r.newStreak,
        balance: paid.balance,
        nonceStart: p.nonce,
        warCost: betAmount,
        surrenderReturns: truncate(betAmount / 2 + r.tieWin + r.ctieWin, 2),
        ...shape(state),
      });
    } catch (err) {
      console.error("War start failed after debit — attempting rollback:", err);
      return res.status(500).json({ error: "Round could not be completed" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Shared settlement for the two tie resolutions: one atomic claim on the
// "war" stage; credit + streak write follow a successful claim.
async function settleTie(req, res, round, { result, payout, newStreak, extraStake = 0, warCards = null, extraDraws = [] }) {
  const state = round.state;
  const finalState = {
    ...state,
    warPlayerCard: warCards ? warCards.p.index : null,
    warDealerCard: warCards ? warCards.d.index : null,
    stage: "settled",
    result,
    draws: [...(state.draws || []), ...extraDraws],
  };
  const staked = truncate(state.bet + state.tieBet + state.ctieBet + extraStake, 2);

  const claimed = await GameRound.findOneAndUpdate(
    { _id: round._id, status: "active", "state.stage": "war" },
    { $set: { status: payout > 0 ? "cashed_out" : "lost", payout, staked, state: finalState } },
    { returnDocument: "after" }
  );
  if (!claimed) return { claimed: false };

  let balance = null;
  const [credited] = await Promise.all([
    payout > 0 ? credit(req.userId, payout, { roundId: round._id }) : Promise.resolve(null),
    User.updateOne({ _id: req.userId }, { $set: { warTieStreak: newStreak } }),
  ]);
  if (credited?.ok) balance = credited.balance;

  res.json({ stage: "settled", result, payout, totalStaked: staked, streak: newStreak, balance, nonceStart: round.nonceStart, ...shape(finalState) });
  return { claimed: true };
}

// ── POST /war/war — raise and draw the war cards ────────────────────────────
router.post("/war/war", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "war", status: "active" });
    if (!round || round.state.stage !== "war") {
      return res.status(404).json({ error: "No war decision pending" });
    }
    const s = round.state;

    const paid = await debit(req.userId, s.bet, { roundId: round._id });
    if (!paid.ok) return res.status(400).json({ error: paid.error });

    const [p, d] = await drawMany(round.seedId, 2); // published: war player, war dealer
    const r = resolveWar({
      playerIndex: p.index, dealerIndex: d.index,
      streak: s.streakAtDeal, main: s.bet, tieWin: s.tieWin, ctieWin: s.ctieWin,
    });

    const { claimed } = await settleTie(req, res, round, {
      result: r.result,
      payout: r.payout,
      newStreak: r.newStreak,
      extraStake: s.bet,
      warCards: { p, d },
      extraDraws: [
        { nonce: p.nonce, index: p.index, to: "warPlayer" },
        { nonce: d.nonce, index: d.index, to: "warDealer" },
      ],
    });
    if (!claimed) {
      await credit(req.userId, s.bet, { roundId: round._id });
      return res.status(409).json({ error: "Round already settled" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /war/surrender — take half the bet back (breaks the streak) ────────
router.post("/war/surrender", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "war", status: "active" });
    if (!round || round.state.stage !== "war") {
      return res.status(404).json({ error: "No war decision pending" });
    }
    const s = round.state;
    const payout = truncate(s.bet / 2 + s.tieWin + s.ctieWin, 2);
    const { claimed } = await settleTie(req, res, round, { result: "surrender", payout, newStreak: 0 });
    if (!claimed) return res.status(409).json({ error: "Round already settled" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /war/active — refresh-resume (only a pending tie persists) ──────────
router.get("/war/active", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "war", status: "active" });
    if (!round) return res.json({ active: false });
    const s = round.state;
    res.json({
      active: true,
      roundId: round._id,
      stage: "war",
      betAmount: round.betAmount,
      warCost: s.bet,
      streak: s.streakAtDeal,
      surrenderReturns: truncate(s.bet / 2 + s.tieWin + s.ctieWin, 2),
      totalStaked: truncate(s.bet + s.tieBet + s.ctieBet, 2),
      ...shape(s),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
