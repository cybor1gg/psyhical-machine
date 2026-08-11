// Chicken Cross routes. Climb family — the exact same contract as tower and
// mines (start / step / cashout / active), so integrating this game feels
// like the last one.
//
// Every lane's outcome is drawn in ONE atomic nonce claim at bet time and
// stored in round state. The layout is STRIPPED from every response until the
// round settles (a deadly lane or a cashout reveals the whole road) — the
// blackjack hole-card discipline, one lane at a time.

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
import { DIFFICULTIES, laneDeadly, ladder } from "../lib/games/chicken.js";

const router = Router();

// The whole road — only ever sent on a settled round.
function fullRoad(state) {
  return state.deadly.map((d, i) => ({ deadly: d, nonce: state.nonces[i] }));
}

function payoutFor(state, maxWin) {
  return truncate(state.bet * Math.min(state.multiplier, maxWin), 2);
}

// ── POST /chicken/start { betAmount, difficulty } ───────────────────────────
router.post("/chicken/start", requireAuth, async (req, res) => {
  try {
    const [existing, user, seed] = await Promise.all([
      GameRound.findOne({ userId: req.userId, gameType: "chicken", status: "active" }).select("_id"),
      User.findById(req.userId).select("operatorId externalId isDemo"),
      ensureActiveSeed(req.userId),
    ]);

    const config = await getEffectiveGameConfig("chicken", user?.operatorId ?? null);
    if (!config.enabled) return res.status(403).json({ error: "Game disabled" });

    const { betAmount, difficulty } = req.body ?? {};
    if (!DIFFICULTIES[difficulty]) {
      return res.status(400).json({ error: "difficulty must be one of " + Object.keys(DIFFICULTIES).join(", ") });
    }
    if (!Number.isFinite(betAmount) || betAmount < config.minBet || betAmount > config.maxBet) {
      return res.status(400).json({ error: `Bet must be between ${config.minBet} and ${config.maxBet}` });
    }
    if (existing) return res.status(409).json({ error: "Round already active" });
    if (!seed) return res.status(400).json({ error: "No active seed" });

    // Pre-generate the round id so the opening debit already carries it —
    // operators group wallet calls by round, and a roundless debit next to
    // a rounded credit reads as two different rounds on their side.
    const roundId = new mongoose.Types.ObjectId();
    const paid = await debit(req.userId, betAmount, { user, roundId });
    if (!paid.ok) return res.status(400).json({ error: paid.error });

    try {
      // Every lane, one atomic nonce claim. Committed before the first step.
      const { lanes, death } = DIFFICULTIES[difficulty];
      const rolls = await rollMany(seed._id, lanes);

      const state = {
        difficulty,
        bet: betAmount,
        deadly: rolls.map((r) => laneDeadly(r.roll, death)), // hidden until settled
        nonces: rolls.map((r) => r.nonce),
        lane: 0,
        multiplier: 1,
        stage: "cross",
        result: null,
      };
      const round = await GameRound.create({
        _id: roundId,
        userId: req.userId,
        gameType: "chicken",
        betAmount,
        houseEdge: config.houseEdge,
        seedId: seed._id,
        nonceStart: rolls[0].nonce,
        state,
      });

      return res.json({
        roundId: round._id,
        difficulty,
        lanes,
        lane: 0,
        multiplier: 1,
        ladder: ladder(difficulty, config.houseEdge, config.maxWinMultiplier),
        balance: paid.balance,
        totalStaked: betAmount,
        nonceStart: rolls[0].nonce,
      });
    } catch (err) {
      console.error("Chicken start failed after debit — attempting rollback:", err);
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

// ── POST /chicken/step — cross the next lane ────────────────────────────────
router.post("/chicken/step", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "chicken", status: "active" });
    if (!round || round.state.stage !== "cross") {
      return res.status(404).json({ error: "No active round" });
    }
    const state = round.state;
    const { lanes } = DIFFICULTIES[state.difficulty];

    const config = await getEffectiveGameConfig("chicken", null); // maxWin cap is platform-wide
    const laneIndex = state.lane; // 0-based index of the lane being crossed
    const deadly = state.deadly[laneIndex];

    if (deadly) {
      // Bust: one-time claim guarded on the lane cursor, full road reveal.
      const finalState = { ...state, lane: laneIndex + 1, stage: "settled", result: "lost" };
      const claimed = await GameRound.findOneAndUpdate(
        { _id: round._id, status: "active", "state.lane": laneIndex },
        { $set: { status: "lost", payout: 0, staked: state.bet, state: finalState } },
        { returnDocument: "after" }
      );
      if (!claimed) return res.status(409).json({ error: "Action already in progress" });
      return res.json({
        won: false,
        status: "lost",
        payout: 0,
        lane: laneIndex + 1,
        lanes: fullRoad(finalState),
        nonces: state.nonces,
        nonceStart: round.nonceStart,
      });
    }

    // the round's multiplier is a straight ladder lookup — the ladder is the
    // published cumulative-survival pricing, already truncated and capped
    const lad = ladder(state.difficulty, round.houseEdge, config.maxWinMultiplier);
    const newLane = laneIndex + 1;
    const newMultiplier = lad[newLane - 1];

    if (newLane >= lanes) {
      // Far side of the road: auto-settle as a win.
      const finalState = { ...state, lane: newLane, multiplier: newMultiplier, stage: "settled", result: "cashed_out" };
      const payout = payoutFor(finalState, config.maxWinMultiplier);
      const claimed = await GameRound.findOneAndUpdate(
        { _id: round._id, status: "active", "state.lane": laneIndex },
        { $set: { status: "cashed_out", payout, staked: state.bet, state: finalState } },
        { returnDocument: "after" }
      );
      if (!claimed) return res.status(409).json({ error: "Action already in progress" });
      const credited = await credit(req.userId, payout, { roundId: round._id });
      return res.json({
        won: true,
        top: true,
        status: "cashed_out",
        payout,
        balance: credited.ok ? credited.balance : null,
        lane: newLane,
        multiplier: newMultiplier,
        lanes: fullRoad(finalState),
        nonces: state.nonces,
        nonceStart: round.nonceStart,
      });
    }

    // Cross: guarded on the lane cursor so a double-click can't skip a lane.
    const newState = { ...state, lane: newLane, multiplier: newMultiplier };
    const updated = await GameRound.findOneAndUpdate(
      { _id: round._id, status: "active", "state.lane": laneIndex },
      { $set: { state: newState } },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(409).json({ error: "Action already in progress" });

    return res.json({
      won: true,
      lane: newLane,
      multiplier: newMultiplier,
      nextMultiplier: newLane < lanes ? lad[newLane] : null,
      potentialPayout: payoutFor(newState, config.maxWinMultiplier),
      nonceStart: round.nonceStart,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /chicken/cashout ────────────────────────────────────────────────────
router.post("/chicken/cashout", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "chicken", status: "active" });
    if (!round || round.state.stage !== "cross") {
      return res.status(404).json({ error: "No active round" });
    }
    if (round.state.lane < 1) {
      return res.status(400).json({ error: "Cross at least one lane first" });
    }

    const config = await getEffectiveGameConfig("chicken", null);
    const finalState = { ...round.state, stage: "settled", result: "cashed_out" };
    const payout = payoutFor(finalState, config.maxWinMultiplier);

    const claimed = await GameRound.findOneAndUpdate(
      { _id: round._id, status: "active" },
      { $set: { status: "cashed_out", payout, staked: round.state.bet, state: finalState } },
      { returnDocument: "after" }
    );
    if (!claimed) return res.status(409).json({ error: "Round already settled" });

    const credited = await credit(req.userId, payout, { roundId: round._id });
    return res.json({
      status: "cashed_out",
      payout,
      balance: credited.ok ? credited.balance : null,
      lane: round.state.lane,
      multiplier: round.state.multiplier,
      lanes: fullRoad(finalState),
      nonces: round.state.nonces,
      nonceStart: round.nonceStart,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /chicken/active — refresh-resume (layout stays hidden) ──────────────
router.get("/chicken/active", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "chicken", status: "active" });
    if (!round) return res.json({ active: false });
    const state = round.state;
    const { lanes } = DIFFICULTIES[state.difficulty];
    const config = await getEffectiveGameConfig("chicken", null);
    res.json({
      active: true,
      roundId: round._id,
      betAmount: round.betAmount,
      difficulty: state.difficulty,
      lanes,
      lane: state.lane,
      multiplier: state.multiplier,
      potentialPayout: state.lane > 0 ? payoutFor(state, config.maxWinMultiplier) : 0,
      ladder: ladder(state.difficulty, round.houseEdge, config.maxWinMultiplier),
      nonceStart: round.nonceStart,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
