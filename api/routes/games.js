import { Router } from "express";
import mongoose from "mongoose";
import GameRound from "../models/GameRound.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getEffectiveGameConfig } from "../lib/config.js";
import { debit, credit, resolveWalletForRollback } from "../lib/wallet.js";
import { remoteRollback } from "../lib/walletRemote.js";
import { ensureActiveSeed, drawNext, drawNextForUser } from "../lib/fair.js";
import { cardFromIndex, cardValue, callsFor, winForCall, truncate } from "../lib/games/hilo.js";

const router = Router();

// Validate a stored pending card against the active seed (rotation invalidates).
function pendingIsValid(pending, seed) {
  return pending && pending.seedId?.toString() === seed._id.toString() && Number.isInteger(pending.index);
}

// The pre-bet "table card": drawn from the seed chain (verifiable), stored on
// the user, free to skip. When a round starts, THIS card becomes the start
// card — the player always bets on exactly the card they can see.
async function ensureTableCard(userId) {
  // Seed and user are independent reads — fetch them in one round-trip's time.
  // ensureActiveSeed (not findOne) so brand-new direct players get a seed
  // instead of a dead table; it's idempotent for everyone else.
  const [seed, user] = await Promise.all([
    ensureActiveSeed(userId),
    User.findById(userId).select("pendingHilo operatorId"),
  ]);
  if (!seed) return null;

  const operatorId = user?.operatorId ?? null;
  const pending = user?.pendingHilo;
  if (pendingIsValid(pending, seed)) {
    return { index: pending.index, nonce: pending.nonce, seedId: seed._id, operatorId };
  }

  const drawn = await drawNext(seed._id);
  await User.updateOne(
    { _id: userId },
    { $set: { pendingHilo: { index: drawn.index, nonce: drawn.nonce, seedId: seed._id } } }
  );
  return { ...drawn, seedId: seed._id, operatorId };
}

// GET /hilo/table — what's on the table right now (pre-bet card or active round)
router.get("/hilo/table", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "hilo", status: "active" });
    if (round) return res.json({ active: true });

    const table = await ensureTableCard(req.userId);
    if (!table) return res.status(400).json({ error: "No active seed" });

    // Effective config: the operator's RTP override (clamped to the platform
    // window) or the platform default for direct players.
    const config = await getEffectiveGameConfig("hilo", table.operatorId);

    res.json({
      active: false,
      card: cardFromIndex(table.index),
      calls: callsFor(table.index % 13, config.houseEdge),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/hilo/start", requireAuth, async (req, res) => {
  try {
    // Independent reads batched into one round-trip: active-round check, the
    // user (pending card + wallet routing + operator), and the active seed.
    const [existing, user, seed] = await Promise.all([
      GameRound.findOne({ userId: req.userId, gameType: "hilo", status: "active" }).select("_id"),
      User.findById(req.userId).select("pendingHilo operatorId externalId"),
      ensureActiveSeed(req.userId),
    ]);

    // Config AFTER the user fetch — the operator's RTP override decides the
    // houseEdge this round is created with (then frozen on the round doc).
    const config = await getEffectiveGameConfig("hilo", user?.operatorId ?? null);
    if (!config.enabled) {
      return res.status(403).json({ error: "Game disabled" });
    }

    const { betAmount } = req.body ?? {};
    if (!Number.isFinite(betAmount) || betAmount < config.minBet || betAmount > config.maxBet) {
      return res.status(400).json({ error: `Bet must be between ${config.minBet} and ${config.maxBet}` });
    }

    if (existing) {
      return res.status(409).json({ error: "Round already active" });
    }
    if (!seed) {
      return res.status(400).json({ error: "No active seed" });
    }

    // Pre-generate the round id so the opening debit already carries it —
    // operators group wallet calls by round, and a roundless debit next to
    // a rounded credit reads as two different rounds on their side.
    const roundId = new mongoose.Types.ObjectId();
    const paid = await debit(req.userId, betAmount, { user, roundId });
    if (!paid.ok) {
      return res.status(400).json({ error: paid.error });
    }

    try {
      // Use the table card the player is looking at as the start card.
      // Falls back to a fresh draw if none exists (e.g. first ever round).
      const table = pendingIsValid(user?.pendingHilo, seed)
        ? { index: user.pendingHilo.index, nonce: user.pendingHilo.nonce, seedId: seed._id }
        : await drawNext(seed._id);
      const firstCard = table.index;
      const usedNonce = table.nonce;

      // Round creation and pending-card cleanup don't depend on each other.
      const [round] = await Promise.all([
        GameRound.create({
          _id: roundId,
          userId: req.userId,
          gameType: "hilo",
          betAmount,
          houseEdge: config.houseEdge,
          seedId: table.seedId ?? seed._id,
          nonceStart: usedNonce,
          state: { cards: [firstCard], multiplier: 1, guesses: [] },
        }),
        User.updateOne({ _id: req.userId }, { $unset: { pendingHilo: 1 } }),
      ]);

      return res.json({
        roundId: round._id,
        card: cardFromIndex(firstCard),
        multiplier: 1,
        balance: paid.balance,
        calls: callsFor(firstCard % 13, config.houseEdge),
        nonce: usedNonce,
        nonceStart: usedNonce,
      });
    } catch (err) {
      console.error("Round creation failed after debit \u2014 attempting rollback:", err);
      if (paid.txId) {
        const { user, operator } = await resolveWalletForRollback(req.userId);
        if (operator) await remoteRollback(operator, paid.txId, user);
      }
      return res.status(500).json({ error: "Round could not be started; bet refunded" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/hilo/guess", requireAuth, async (req, res) => {
  try {
    const { choice } = req.body ?? {};
    if (!["higher", "lower", "same"].includes(choice)) {
      return res.status(400).json({ error: "Choice must be 'higher', 'lower' or 'same'" });
    }

    const round = await GameRound.findOne({ userId: req.userId, gameType: "hilo", status: "active" });
    if (!round) {
      return res.status(404).json({ error: "No active round" });
    }

    const cards = round.state.cards;
    const currentRank = cards[cards.length - 1] % 13;

    // The server decides which calls exist for this card; anything else is rejected.
    const call = callsFor(currentRank, round.houseEdge).find((c) => c.choice === choice);
    if (!call) {
      return res.status(400).json({ error: "That call is not available for this card" });
    }

    const { index: nextIndex, nonce: usedNonce } = await drawNext(round.seedId);
    const nextRank = nextIndex % 13;

    const won = winForCall(choice, cardValue(currentRank), cardValue(nextRank));

    if (!won) {
      round.state.cards.push(nextIndex);
      round.state.guesses.push({ choice, nonce: usedNonce, won: false });
      round.markModified("state");
      round.status = "lost";
      round.payout = 0;
      round.staked = round.betAmount; // hilo stakes never grow mid-round
      await round.save();

      // The card the round ends on stays on the table and becomes the next
      // round's start card — the player bets on it again unless they Skip. We
      // reuse its exact index+nonce (no fresh draw), so the visible card never
      // changes and the seed chain stays contiguous: the next draw is nonce+1.
      await User.updateOne(
        { _id: req.userId },
        { $set: { pendingHilo: { index: nextIndex, nonce: usedNonce, seedId: round.seedId } } }
      );

      return res.json({
        won: false,
        card: cardFromIndex(nextIndex),
        status: "lost",
        payout: 0,
        calls: callsFor(nextRank, round.houseEdge),
        nonce: usedNonce,
        nonceStart: round.nonceStart,
      });
    }

    const stepMultiplier = call.multiplier;
    const newMultiplier = truncate(round.state.multiplier * stepMultiplier, 4);

    round.state.cards.push(nextIndex);
    round.state.guesses.push({ choice, nonce: usedNonce, won: true, stepMultiplier, stepTotal: newMultiplier });
    round.state.multiplier = newMultiplier;
    round.markModified("state");
    await round.save();

    res.json({
      won: true,
      card: cardFromIndex(nextIndex),
      multiplier: newMultiplier,
      potentialPayout: truncate(round.betAmount * newMultiplier, 2),
      calls: callsFor(nextRank, round.houseEdge),
      nonce: usedNonce,
      nonceStart: round.nonceStart,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Skip: replace the current card with a fresh draw, free. Works both
// mid-round (recorded in round history) and pre-bet (redraws the table card).
// Every skip consumes a nonce, so the whole chain stays verifiable.
router.post("/hilo/skip", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "hilo", status: "active" });

    if (!round) {
      // Pre-bet: redraw the table card. Seed lookup + nonce claim are one
      // combined query; the ensureActiveSeed fallback only runs for a player
      // who has never loaded the table (no seed yet).
      const opUser = await User.findById(req.userId).select("operatorId");
      const config = await getEffectiveGameConfig("hilo", opUser?.operatorId ?? null);
      let drawn = await drawNextForUser(req.userId);
      if (!drawn) {
        const seed = await ensureActiveSeed(req.userId);
        if (!seed) return res.status(400).json({ error: "No active seed" });
        drawn = await drawNext(seed._id);
      }
      await User.updateOne(
        { _id: req.userId },
        { $set: { pendingHilo: { index: drawn.index, nonce: drawn.nonce, seedId: drawn.seedId } } }
      );

      return res.json({
        preBet: true,
        card: cardFromIndex(drawn.index),
        calls: callsFor(drawn.index % 13, config.houseEdge),
        nonce: drawn.nonce,
      });
    }

    const { index: nextIndex, nonce: usedNonce } = await drawNext(round.seedId);

    round.state.cards.push(nextIndex);
    round.state.guesses.push({ choice: "skip", nonce: usedNonce, won: null });
    round.markModified("state");
    await round.save();

    res.json({
      card: cardFromIndex(nextIndex),
      multiplier: round.state.multiplier,
      calls: callsFor(nextIndex % 13, round.houseEdge),
      nonce: usedNonce,
      nonceStart: round.nonceStart,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/hilo/cashout", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOneAndUpdate(
      { userId: req.userId, gameType: "hilo", status: "active" },
      { status: "cashed_out" },
      { returnDocument: "after" }
    );

    if (!round) {
      return res.status(404).json({ error: "No active round" });
    }

    const hasWin = round.state.guesses.some((g) => g.won === true);
    if (!hasWin) {
      round.status = "active";
      await round.save();
      return res.status(400).json({ error: "Make at least one call first" });
    }

    const payout = truncate(round.betAmount * round.state.multiplier, 2);

    // Carry-over card for the next round (see /hilo/guess): the final card,
    // reusing its original nonce so the seed chain stays contiguous.
    const cards = round.state.cards;
    const lastIndex = cards[cards.length - 1];
    const guesses = round.state.guesses;
    const lastNonce = guesses.length ? guesses[guesses.length - 1].nonce : round.nonceStart;

    // Persist the payout and load the user (wallet routing) together; then
    // credit and carry-over together. The two User writes touch different
    // fields with atomic operators, so they can't clobber each other.
    const [, user] = await Promise.all([
      GameRound.updateOne({ _id: round._id }, { payout, staked: round.betAmount }),
      User.findById(req.userId).select("operatorId externalId isDemo"),
    ]);

    const [credited] = await Promise.all([
      credit(req.userId, payout, { roundId: round._id, user }),
      User.updateOne(
        { _id: req.userId },
        { $set: { pendingHilo: { index: lastIndex, nonce: lastNonce, seedId: round.seedId } } }
      ),
    ]);

    res.json({
      status: "cashed_out",
      payout,
      balance: credited.balance,
      card: cardFromIndex(lastIndex),
      calls: callsFor(lastIndex % 13, round.houseEdge),
      nonce: lastNonce,
      nonceStart: round.nonceStart,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/hilo/active", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "hilo", status: "active" });
    if (!round) return res.json({ active: false });

    const currentIndex = round.state.cards[round.state.cards.length - 1];

    res.json({
      active: true,
      roundId: round._id,
      // betAmount is needed on resume: the client's bet input resets on reload,
      // so without it the cashout label would be computed off the default stake.
      betAmount: round.betAmount,
      card: cardFromIndex(currentIndex),
      cards: round.state.cards.map(cardFromIndex),
      guesses: round.state.guesses,
      multiplier: round.state.multiplier,
      calls: callsFor(currentIndex % 13, round.houseEdge),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
