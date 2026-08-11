// Mines routes. Climb family — the exact same contract as tower and hilo
// (start / guess / cashout / active), so integrating this game feels like the
// last one.
//
// All K mine positions are drawn in ONE atomic nonce claim at bet time and
// stored in round state. They are STRIPPED from every response until the
// round settles (bust or cashout reveals the whole board) — the blackjack
// hole-card discipline on a 25/36/49/64-tile grid (default 25; old rounds
// without state.gridSize are 25).

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
import { TILES, minePositions, multiplierAfter, ladder, parseMines, parseGridSize } from "../lib/games/mines.js";

const router = Router();

function payoutFor(state, maxWin) {
  return truncate(state.bet * Math.min(state.multiplier, maxWin), 2);
}

// The full board — only ever sent on a settled round.
function reveal(state) {
  return { mines: state.minePositions, nonces: state.nonces };
}

// ── POST /mines/start { betAmount, mines, gridSize? } ───────────────────────
router.post("/mines/start", requireAuth, async (req, res) => {
  try {
    const [existing, user, seed] = await Promise.all([
      GameRound.findOne({ userId: req.userId, gameType: "mines", status: "active" }).select("_id"),
      User.findById(req.userId).select("operatorId externalId isDemo"),
      ensureActiveSeed(req.userId),
    ]);

    const config = await getEffectiveGameConfig("mines", user?.operatorId ?? null);
    if (!config.enabled) return res.status(403).json({ error: "Game disabled" });

    const { betAmount } = req.body ?? {};
    const gridSize = parseGridSize(req.body?.gridSize);
    if (gridSize == null) {
      return res.status(400).json({ error: "gridSize must be one of 25, 36, 49, 64" });
    }
    const mines = parseMines(req.body?.mines, gridSize);
    if (mines == null) {
      return res.status(400).json({ error: `mines must be an integer 1..${gridSize - 1}` });
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
      // K mines, one atomic nonce claim, drawn without replacement.
      const rolls = await rollMany(seed._id, mines);
      const positions = minePositions(rolls.map((r) => r.roll), gridSize);

      const state = {
        mines,
        gridSize,
        bet: betAmount,
        minePositions: positions,           // hidden until settlement
        nonces: rolls.map((r) => r.nonce),
        picks: [],
        multiplier: 1,
        stage: "climb",
        result: null,
      };
      const round = await GameRound.create({
        _id: roundId,
        userId: req.userId,
        gameType: "mines",
        betAmount,
        houseEdge: config.houseEdge,
        seedId: seed._id,
        nonceStart: rolls[0].nonce,
        state,
      });

      return res.json({
        roundId: round._id,
        mines,
        tiles: gridSize,
        gridSize,
        picks: [],
        multiplier: 1,
        ladder: ladder(mines, config.houseEdge, config.maxWinMultiplier, gridSize),
        balance: paid.balance,
        totalStaked: betAmount,
        nonceStart: rolls[0].nonce,
      });
    } catch (err) {
      console.error("Mines start failed after debit — attempting rollback:", err);
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

// ── POST /mines/guess { tile } — reveal one tile ────────────────────────────
router.post("/mines/guess", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "mines", status: "active" });
    if (!round || round.state.stage !== "climb") {
      return res.status(404).json({ error: "No active round" });
    }
    const state = round.state;
    const gridSize = state.gridSize ?? TILES; // old rounds predate grid sizes
    const { tile } = req.body ?? {};
    if (!Number.isInteger(tile) || tile < 0 || tile >= gridSize) {
      return res.status(400).json({ error: `tile must be an integer 0..${gridSize - 1}` });
    }
    if (state.picks.includes(tile)) {
      return res.status(400).json({ error: "Tile already revealed" });
    }

    const config = await getEffectiveGameConfig("mines", null); // maxWin cap is platform-wide
    const picks = [...state.picks, tile];
    const hitMine = state.minePositions.includes(tile);

    if (hitMine) {
      // Bust: one-time claim guarded on the pick count, full board reveal.
      const finalState = { ...state, picks, stage: "settled", result: "lost" };
      const claimed = await GameRound.findOneAndUpdate(
        { _id: round._id, status: "active", [`state.picks.${state.picks.length}`]: { $exists: false } },
        { $set: { status: "lost", payout: 0, staked: state.bet, state: finalState } },
        { returnDocument: "after" }
      );
      if (!claimed) return res.status(409).json({ error: "Action already in progress" });
      return res.json({
        won: false,
        status: "lost",
        payout: 0,
        tile,
        nonceStart: round.nonceStart,
        ...reveal(finalState),
      });
    }

    const newMultiplier = multiplierAfter(picks.length, state.mines, round.houseEdge, config.maxWinMultiplier, gridSize);
    const allGems = picks.length >= gridSize - state.mines;

    if (allGems) {
      // Every gem found: auto-settle as a win.
      const finalState = { ...state, picks, multiplier: newMultiplier, stage: "settled", result: "cashed_out" };
      const payout = payoutFor(finalState, config.maxWinMultiplier);
      const claimed = await GameRound.findOneAndUpdate(
        { _id: round._id, status: "active", [`state.picks.${state.picks.length}`]: { $exists: false } },
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
        multiplier: newMultiplier,
        tile,
        nonceStart: round.nonceStart,
        ...reveal(finalState),
      });
    }

    // Safe pick: guarded on the pick count so a double-click can't reveal twice.
    const newState = { ...state, picks, multiplier: newMultiplier };
    const updated = await GameRound.findOneAndUpdate(
      { _id: round._id, status: "active", [`state.picks.${state.picks.length}`]: { $exists: false } },
      { $set: { state: newState } },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(409).json({ error: "Action already in progress" });

    return res.json({
      won: true,
      tile,
      picks: picks.length,
      multiplier: newMultiplier,
      nextMultiplier: multiplierAfter(picks.length + 1, state.mines, round.houseEdge, config.maxWinMultiplier, gridSize),
      potentialPayout: payoutFor(newState, config.maxWinMultiplier),
      nonceStart: round.nonceStart,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /mines/cashout ──────────────────────────────────────────────────────
router.post("/mines/cashout", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "mines", status: "active" });
    if (!round || round.state.stage !== "climb") {
      return res.status(404).json({ error: "No active round" });
    }
    if (round.state.picks.length < 1) {
      return res.status(400).json({ error: "Reveal at least one gem first" });
    }

    const config = await getEffectiveGameConfig("mines", null);
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
      multiplier: round.state.multiplier,
      nonceStart: round.nonceStart,
      ...reveal(finalState),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /mines/active — refresh-resume (picks only, never the mines) ────────
router.get("/mines/active", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "mines", status: "active" });
    if (!round) return res.json({ active: false });
    const state = round.state;
    const gridSize = state.gridSize ?? TILES; // old rounds predate grid sizes
    const config = await getEffectiveGameConfig("mines", null);
    res.json({
      active: true,
      roundId: round._id,
      betAmount: round.betAmount,
      mines: state.mines,
      tiles: gridSize,
      gridSize,
      picks: state.picks,
      multiplier: state.multiplier,
      nextMultiplier: multiplierAfter(state.picks.length + 1, state.mines, round.houseEdge, config.maxWinMultiplier, gridSize),
      potentialPayout: state.picks.length > 0 ? payoutFor(state, config.maxWinMultiplier) : 0,
      ladder: ladder(state.mines, round.houseEdge, config.maxWinMultiplier, gridSize),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
