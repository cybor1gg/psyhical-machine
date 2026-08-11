// Dragon Tower routes. API surface deliberately mirrors hilo — the climb
// family shares one contract (start / guess / cashout / active) so
// integrating the next game feels like the last one.
//
// All nine row layouts are drawn in ONE atomic nonce claim at bet time and
// stored in round state. They are STRIPPED from every response until either
// that row is climbed (reveal one row) or the round settles (reveal the whole
// tower) — the blackjack hole-card discipline, nine times over.

import { Router } from "express";
import mongoose from "mongoose";
import GameRound from "../models/GameRound.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getEffectiveGameConfig } from "../lib/config.js";
import { debit, credit } from "../lib/wallet.js";
import { ensureActiveSeed, drawMany } from "../lib/fair.js";
import { truncate } from "../lib/money.js";
import { ROWS, DIFFICULTIES, rowDragons, stepMultiplier, ladder } from "../lib/games/tower.js";

const router = Router();

// Rows the player has already climbed (safe to show), with their picks.
function revealedRows(state) {
  return state.rows.slice(0, state.currentRow).map((r, i) => ({
    dragons: r.dragons,
    pick: state.picks[i],
    nonce: r.nonce,
  }));
}

// The whole tower — only ever sent on a settled round.
function fullTower(state) {
  return state.rows.map((r, i) => ({
    dragons: r.dragons,
    pick: state.picks[i] ?? null,
    nonce: r.nonce,
  }));
}

function payoutFor(state, maxWin) {
  return truncate(state.bet * Math.min(state.multiplier, maxWin), 2);
}

// ── POST /tower/start { betAmount, difficulty } ─────────────────────────────
router.post("/tower/start", requireAuth, async (req, res) => {
  try {
    const [existing, seed] = await Promise.all([
      GameRound.findOne({ userId: req.userId, gameType: "tower", status: "active" }).select("_id"),
      ensureActiveSeed(req.userId),
    ]);

    const config = await getEffectiveGameConfig("tower");
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

    const roundId = new mongoose.Types.ObjectId();
    const paid = await debit(req.userId, betAmount, { roundId });
    if (!paid.ok) return res.status(400).json({ error: paid.error });

    try {
      // Nine rows, one atomic nonce claim. Committed before the first pick.
      const draws = await drawMany(seed._id, ROWS);
      const rows = draws.map((d) => ({
        nonce: d.nonce,
        dragons: rowDragons(seed.serverSeed, seed.clientSeed, d.nonce, difficulty),
      }));

      const state = {
        difficulty,
        bet: betAmount,
        rows,                // hidden until climbed/settled
        picks: [],
        currentRow: 0,
        multiplier: 1,
        stage: "climb",
        result: null,
      };
      const round = await GameRound.create({
        _id: roundId,
        userId: req.userId,
        gameType: "tower",
        betAmount,
        houseEdge: config.houseEdge,
        seedId: seed._id,
        nonceStart: draws[0].nonce,
        state,
      });

      return res.json({
        roundId: round._id,
        difficulty,
        rows: ROWS,
        tilesPerRow: DIFFICULTIES[difficulty].tiles,
        currentRow: 0,
        multiplier: 1,
        ladder: ladder(difficulty, config.houseEdge, config.maxWinMultiplier),
        balance: paid.balance,
        totalStaked: betAmount,
        nonceStart: draws[0].nonce,
      });
    } catch (err) {
      console.error("Tower start failed after debit — attempting rollback:", err);
      return res.status(500).json({ error: "Round could not be completed" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /tower/guess { tile } — pick a tile on the current row ─────────────
router.post("/tower/guess", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "tower", status: "active" });
    if (!round || round.state.stage !== "climb") {
      return res.status(404).json({ error: "No active round" });
    }
    const state = round.state;
    const { tiles } = DIFFICULTIES[state.difficulty];
    const { tile } = req.body ?? {};
    if (!Number.isInteger(tile) || tile < 0 || tile >= tiles) {
      return res.status(400).json({ error: `tile must be an integer 0..${tiles - 1}` });
    }

    const config = await getEffectiveGameConfig("tower");
    const rowIndex = state.currentRow;
    const row = state.rows[rowIndex];
    const hitDragon = row.dragons.includes(tile);
    const picks = [...state.picks, tile];

    if (hitDragon) {
      // Bust: one-time claim guarded on the row cursor, full tower reveal.
      const finalState = { ...state, picks, stage: "settled", result: "lost" };
      const claimed = await GameRound.findOneAndUpdate(
        { _id: round._id, status: "active", "state.currentRow": rowIndex },
        { $set: { status: "lost", payout: 0, staked: state.bet, state: finalState } },
        { returnDocument: "after" }
      );
      if (!claimed) return res.status(409).json({ error: "Action already in progress" });
      return res.json({
        won: false,
        status: "lost",
        payout: 0,
        row: { dragons: row.dragons, pick: tile },
        tower: fullTower(finalState),
        nonceStart: round.nonceStart,
      });
    }

    const step = stepMultiplier(state.difficulty, round.houseEdge);
    const newMultiplier = truncate(state.multiplier * step, 4);
    const newRow = rowIndex + 1;

    if (newRow >= ROWS) {
      // Top of the tower: auto-settle as a win.
      const finalState = { ...state, picks, currentRow: newRow, multiplier: newMultiplier, stage: "settled", result: "cashed_out" };
      const payout = payoutFor(finalState, config.maxWinMultiplier);
      const claimed = await GameRound.findOneAndUpdate(
        { _id: round._id, status: "active", "state.currentRow": rowIndex },
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
        row: { dragons: row.dragons, pick: tile },
        tower: fullTower(finalState),
        nonceStart: round.nonceStart,
      });
    }

    // Climb: guarded on the row cursor so a double-click can't skip a row.
    const newState = { ...state, picks, currentRow: newRow, multiplier: newMultiplier };
    const updated = await GameRound.findOneAndUpdate(
      { _id: round._id, status: "active", "state.currentRow": rowIndex },
      { $set: { state: newState } },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(409).json({ error: "Action already in progress" });

    return res.json({
      won: true,
      row: { dragons: row.dragons, pick: tile },
      currentRow: newRow,
      multiplier: newMultiplier,
      potentialPayout: payoutFor(newState, config.maxWinMultiplier),
      nonceStart: round.nonceStart,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /tower/cashout ──────────────────────────────────────────────────────
router.post("/tower/cashout", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "tower", status: "active" });
    if (!round || round.state.stage !== "climb") {
      return res.status(404).json({ error: "No active round" });
    }
    if (round.state.currentRow < 1) {
      return res.status(400).json({ error: "Climb at least one row first" });
    }

    const config = await getEffectiveGameConfig("tower");
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
      tower: fullTower(finalState),
      nonceStart: round.nonceStart,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /tower/active — refresh-resume (revealed rows only) ─────────────────
router.get("/tower/active", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "tower", status: "active" });
    if (!round) return res.json({ active: false });
    const state = round.state;
    const config = await getEffectiveGameConfig("tower");
    res.json({
      active: true,
      roundId: round._id,
      betAmount: round.betAmount,
      difficulty: state.difficulty,
      rows: ROWS,
      tilesPerRow: DIFFICULTIES[state.difficulty].tiles,
      currentRow: state.currentRow,
      multiplier: state.multiplier,
      potentialPayout: state.currentRow > 0 ? payoutFor(state, config.maxWinMultiplier) : 0,
      revealed: revealedRows(state),
      ladder: ladder(state.difficulty, round.houseEdge, config.maxWinMultiplier),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
