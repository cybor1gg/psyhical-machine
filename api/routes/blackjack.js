// Blackjack routes. The server is the only place rules run: the client sends
// intents (start/hit/stand/double/split/insurance) and renders what comes
// back. The dealer's hole card is drawn at deal time (committed in the nonce
// chain) but stripped from every response until the round settles — provably
// fixed, actually secret.
//
// Round shape (state):
//   hands:      [{ cards, bet, doubled, fromSplit, done }]   (split → 2 hands)
//   activeHand: index of the hand currently acting
//   dealerCards, stage: "insurance" | "player" | "settled"
//   insurance:  { offered, taken, amount, result }
//   draws:      [{ nonce, index, to }] — audit log, one entry per card
//
// Flow: dealer Ace up → stage "insurance" (side bet decided BEFORE the peek);
// dealer 10-value up → instant peek. Naturals settle at the deal. Exactly one
// atomic claim moves status active → cashed_out/lost; credits only after a
// successful claim, so races can never double-pay.

import { Router } from "express";
import mongoose from "mongoose";
import GameRound from "../models/GameRound.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getEffectiveGameConfig } from "../lib/config.js";
import { debit, credit, resolveWalletForRollback } from "../lib/wallet.js";
import { remoteRollback } from "../lib/walletRemote.js";
import { ensureActiveSeed, drawNext, drawMany } from "../lib/fair.js";
import { truncate } from "../lib/money.js";
import {
  cardFromIndex, handValue, isBlackjack, dealerShouldDraw, settle,
  canSplitPair, isAce,
} from "../lib/games/blackjack.js";

const router = Router();

// ── shaping ───────────────────────────────────────────────────────────────
function shapeHand(h) {
  const v = handValue(h.cards);
  return {
    cards: h.cards.map(cardFromIndex),
    value: v.total,
    soft: v.soft,
    bet: h.bet,
    doubled: h.doubled,
    fromSplit: h.fromSplit,
    done: h.done,
    result: h.result ?? null,
  };
}

function shapeDealerHidden(dealerIndexes) {
  const up = dealerIndexes[0];
  return { cards: [cardFromIndex(up)], value: handValue([up]).total, hidden: true };
}

function activeHandOf(state) {
  return state.hands[state.activeHand];
}

function canDoubleNow(state) {
  const h = activeHandOf(state);
  return state.stage === "player" && !!h && !h.done && !h.doubled && h.cards.length === 2;
}

// Re-splitting is allowed up to 4 hands: any ACTIVE two-card pair can split
// again (split aces can't — they auto-stand, so `done` already blocks them).
const MAX_SPLIT_HANDS = 4;
function canSplitNow(state) {
  const h = activeHandOf(state);
  return state.stage === "player" && state.hands.length < MAX_SPLIT_HANDS
    && !!h && !h.done && !h.doubled && h.cards.length === 2 && canSplitPair(h.cards);
}

function totalStaked(state) {
  const hands = state.hands.reduce((s, h) => s + h.bet * (h.doubled ? 2 : 1), 0);
  return truncate(hands + (state.insurance?.taken ? state.insurance.amount : 0), 2);
}

function playerView(round, state, extra = {}) {
  return {
    roundId: round._id,
    nonceStart: round.nonceStart,
    stage: state.stage,
    hands: state.hands.map(shapeHand),
    activeHand: state.activeHand,
    dealer: shapeDealerHidden(state.dealerCards),
    canDouble: canDoubleNow(state),
    canSplit: canSplitNow(state),
    insurance: state.insurance,
    totalStaked: totalStaked(state),
    ...extra,
  };
}

// ── legacy shape upgrade (pre-split rounds stored a flat playerCards) ─────
async function ensureHandsShape(round) {
  if (round.state.hands) return round.state;
  const state = {
    hands: [{
      cards: round.state.playerCards,
      bet: round.betAmount,
      doubled: !!round.state.doubled,
      fromSplit: false,
      done: false,
    }],
    activeHand: 0,
    dealerCards: round.state.dealerCards,
    stage: round.state.stage,
    insurance: { offered: false, taken: null, amount: 0, result: null },
    draws: round.state.draws || [],
  };
  await GameRound.updateOne({ _id: round._id, status: "active" }, { $set: { state } });
  return state;
}

// ── settlement ────────────────────────────────────────────────────────────
// Dealer plays once against ALL hands (skipped if every hand busted), each
// hand settles independently, one claim, one credit for the total.
async function settleAll(req, res, round, state, extraDraws) {
  const dealerCards = [...state.dealerCards];
  const draws = [...extraDraws];

  const anyAlive = state.hands.some((h) => handValue(h.cards).total <= 21);
  if (anyAlive) {
    while (dealerShouldDraw(dealerCards)) {
      const d = await drawNext(round.seedId);
      dealerCards.push(d.index);
      draws.push({ nonce: d.nonce, index: d.index, to: "dealer" });
    }
  }

  let payout = 0;
  const hands = state.hands.map((h) => {
    const { result, payoutMult } = settle(h.cards, dealerCards, h.fromSplit);
    const handPayout = truncate(h.bet * (h.doubled ? 2 : 1) * payoutMult, 2);
    payout = truncate(payout + handPayout, 2);
    return { ...h, done: true, result, payout: handPayout };
  });

  const finalState = { ...state, hands, dealerCards, stage: "settled", draws: [...(state.draws || []), ...draws] };

  const claimed = await GameRound.findOneAndUpdate(
    { _id: round._id, status: "active" },
    { $set: { status: payout > 0 ? "cashed_out" : "lost", payout, staked: totalStaked(finalState), state: finalState } },
    { returnDocument: "after" }
  );
  if (!claimed) return res.status(409).json({ error: "Round already settled" });

  let balance = null;
  if (payout > 0) {
    const credited = await credit(req.userId, payout, { roundId: round._id });
    if (credited.ok) balance = credited.balance;
  }

  const dv = handValue(dealerCards);
  return res.json({
    stage: "settled",
    nonceStart: round.nonceStart,
    hands: hands.map(shapeHand),
    activeHand: state.activeHand,
    dealer: { cards: dealerCards.map(cardFromIndex), value: dv.total, soft: dv.soft },
    insurance: state.insurance,
    payout,
    totalStaked: totalStaked(state),
    balance,
  });
}

// After a hand finishes: move to the next open hand, or play the dealer.
async function advanceOrSettle(req, res, round, state, extraDraws) {
  const next = state.hands.findIndex((h) => !h.done);
  if (next === -1) return settleAll(req, res, round, state, extraDraws);

  const newState = { ...state, activeHand: next, draws: [...(state.draws || []), ...extraDraws] };
  const updated = await GameRound.findOneAndUpdate(
    { _id: round._id, status: "active" },
    { $set: { state: newState } },
    { returnDocument: "after" }
  );
  if (!updated) return res.status(409).json({ error: "Round already settled" });
  return res.json(playerView(round, newState));
}

// ── POST /blackjack/start ─────────────────────────────────────────────────
router.post("/blackjack/start", requireAuth, async (req, res) => {
  try {
    const [existing, user, seed] = await Promise.all([
      GameRound.findOne({ userId: req.userId, gameType: "blackjack", status: "active" }).select("_id"),
      User.findById(req.userId).select("operatorId externalId isDemo"),
      ensureActiveSeed(req.userId),
    ]);

    // Blackjack's RTP is rules-based, so the operator override only affects
    // bet limits/enabled today — wired the same way as hilo for consistency.
    const config = await getEffectiveGameConfig("blackjack", user?.operatorId ?? null);
    if (!config.enabled) return res.status(403).json({ error: "Game disabled" });

    const { betAmount } = req.body ?? {};
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
      // Published order: player, player, dealer up, dealer hole — one claim.
      const [p1, p2, dUp, dHole] = await drawMany(seed._id, 4);
      const playerCards = [p1.index, p2.index];
      const dealerCards = [dUp.index, dHole.index];
      const draws = [
        { nonce: p1.nonce, index: p1.index, to: "player" },
        { nonce: p2.nonce, index: p2.index, to: "player" },
        { nonce: dUp.nonce, index: dUp.index, to: "dealerUp" },
        { nonce: dHole.nonce, index: dHole.index, to: "dealerHole" },
      ];

      const baseState = {
        hands: [{ cards: playerCards, bet: betAmount, doubled: false, fromSplit: false, done: false }],
        activeHand: 0,
        dealerCards,
        insurance: { offered: false, taken: null, amount: 0, result: null },
        draws,
      };
      const roundDoc = {
        _id: roundId,
        userId: req.userId,
        gameType: "blackjack",
        betAmount,
        houseEdge: config.houseEdge,
        seedId: seed._id,
        nonceStart: p1.nonce,
      };

      // Dealer shows an ACE → insurance decision comes BEFORE the peek. The
      // hole card is committed (nonce chain) but nothing is revealed yet.
      if (isAce(dUp.index)) {
        const state = {
          ...baseState,
          stage: "insurance",
          insurance: { offered: true, taken: null, amount: truncate(betAmount / 2, 2), result: null },
        };
        const round = await GameRound.create({ ...roundDoc, state });
        return res.json(playerView(round, state, { balance: paid.balance }));
      }

      // Ten-value up → US peek right now; also settle a player natural.
      const pBJ = isBlackjack(playerCards);
      const dBJ = isBlackjack(dealerCards);
      if (pBJ || dBJ) {
        const { result, payoutMult } = settle(playerCards, dealerCards);
        const payout = truncate(betAmount * payoutMult, 2);
        const state = {
          ...baseState,
          hands: [{ ...baseState.hands[0], done: true, result, payout }],
          stage: "settled",
        };
        const [round, credited] = await Promise.all([
          GameRound.create({ ...roundDoc, status: payout > 0 ? "cashed_out" : "lost", payout, staked: betAmount, state }),
          payout > 0 ? credit(req.userId, payout, { user, roundId }) : Promise.resolve(null),
        ]);
        const dv = handValue(dealerCards);
        return res.json({
          roundId: round._id,
          stage: "settled",
          nonceStart: round.nonceStart,
          hands: state.hands.map(shapeHand),
          activeHand: 0,
          dealer: { cards: dealerCards.map(cardFromIndex), value: dv.total, soft: dv.soft },
          insurance: state.insurance,
          payout,
          totalStaked: betAmount,
          balance: credited?.ok ? credited.balance : paid.balance,
        });
      }

      const state = { ...baseState, stage: "player" };
      const round = await GameRound.create({ ...roundDoc, state });
      return res.json(playerView(round, state, { balance: paid.balance }));
    } catch (err) {
      console.error("Blackjack start failed after debit — attempting rollback:", err);
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

// ── POST /blackjack/insurance { take } ────────────────────────────────────
// Resolves the side bet, THEN peeks. Insurance pays 2:1 (3× the premium comes
// back). If the dealer has no natural the premium is forfeited and play goes
// on — including an immediate 3:2 settle if the PLAYER holds the natural.
router.post("/blackjack/insurance", requireAuth, async (req, res) => {
  try {
    const { take } = req.body ?? {};
    if (typeof take !== "boolean") {
      return res.status(400).json({ error: "take must be true or false" });
    }

    const round = await GameRound.findOne({ userId: req.userId, gameType: "blackjack", status: "active" });
    if (!round || round.state.stage !== "insurance") {
      return res.status(404).json({ error: "No insurance decision pending" });
    }
    const state = round.state;
    const insAmount = state.insurance.amount;

    let insPaid = null;
    if (take) {
      insPaid = await debit(req.userId, insAmount, { roundId: round._id });
      if (!insPaid.ok) return res.status(400).json({ error: insPaid.error });
    }

    const rollbackInsurance = async () => {
      if (!take || !insPaid?.txId) {
        if (take) await credit(req.userId, insAmount, { roundId: round._id });
        return;
      }
      const { user, operator } = await resolveWalletForRollback(req.userId);
      if (operator) await remoteRollback(operator, insPaid.txId, user);
      else await credit(req.userId, insAmount, { roundId: round._id });
    };

    const hand = state.hands[0];
    const dBJ = isBlackjack(state.dealerCards);
    const pBJ = isBlackjack(hand.cards);

    if (dBJ) {
      // Peek finds the natural: main hand loses (push if player also has one),
      // insurance pays 3× its premium.
      const { result, payoutMult } = settle(hand.cards, state.dealerCards);
      const handPayout = truncate(hand.bet * payoutMult, 2);
      const insPayout = take ? truncate(insAmount * 3, 2) : 0;
      const payout = truncate(handPayout + insPayout, 2);
      const finalState = {
        ...state,
        hands: [{ ...hand, done: true, result, payout: handPayout }],
        stage: "settled",
        insurance: { ...state.insurance, taken: take, result: take ? "won" : null },
      };
      const claimed = await GameRound.findOneAndUpdate(
        { _id: round._id, status: "active", "state.stage": "insurance" },
        { $set: { status: payout > 0 ? "cashed_out" : "lost", payout, staked: totalStaked(finalState), state: finalState } },
        { returnDocument: "after" }
      );
      if (!claimed) { await rollbackInsurance(); return res.status(409).json({ error: "Round already settled" }); }

      let balance = null;
      if (payout > 0) {
        const credited = await credit(req.userId, payout, { roundId: round._id });
        if (credited.ok) balance = credited.balance;
      }
      const dv = handValue(finalState.dealerCards);
      return res.json({
        stage: "settled",
        nonceStart: round.nonceStart,
        hands: finalState.hands.map(shapeHand),
        activeHand: 0,
        dealer: { cards: finalState.dealerCards.map(cardFromIndex), value: dv.total, soft: dv.soft },
        insurance: finalState.insurance,
        payout,
        totalStaked: totalStaked(finalState),
        balance,
      });
    }

    // No dealer natural: the premium is gone; a player natural settles 3:2.
    if (pBJ) {
      const payout = truncate(hand.bet * 2.5, 2);
      const finalState = {
        ...state,
        hands: [{ ...hand, done: true, result: "blackjack", payout }],
        stage: "settled",
        insurance: { ...state.insurance, taken: take, result: take ? "lost" : null },
      };
      const claimed = await GameRound.findOneAndUpdate(
        { _id: round._id, status: "active", "state.stage": "insurance" },
        { $set: { status: "cashed_out", payout, staked: totalStaked(finalState), state: finalState } },
        { returnDocument: "after" }
      );
      if (!claimed) { await rollbackInsurance(); return res.status(409).json({ error: "Round already settled" }); }
      const credited = await credit(req.userId, payout, { roundId: round._id });
      const dv = handValue(finalState.dealerCards);
      return res.json({
        stage: "settled",
        nonceStart: round.nonceStart,
        hands: finalState.hands.map(shapeHand),
        activeHand: 0,
        dealer: { cards: finalState.dealerCards.map(cardFromIndex), value: dv.total, soft: dv.soft },
        insurance: finalState.insurance,
        payout,
        totalStaked: totalStaked(finalState),
        balance: credited.ok ? credited.balance : null,
      });
    }

    const newState = {
      ...state,
      stage: "player",
      insurance: { ...state.insurance, taken: take, result: take ? "lost" : null },
    };
    const updated = await GameRound.findOneAndUpdate(
      { _id: round._id, status: "active", "state.stage": "insurance" },
      { $set: { state: newState } },
      { returnDocument: "after" }
    );
    if (!updated) { await rollbackInsurance(); return res.status(409).json({ error: "Round already settled" }); }
    return res.json(playerView(round, newState, { balance: insPaid ? insPaid.balance : undefined }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /blackjack/split ─────────────────────────────────────────────────
// Splits the ACTIVE hand (re-split supported, up to MAX_SPLIT_HANDS): one
// more debit, the pair's cards each seed a hand in place and draw one card
// (one atomic two-nonce claim). Split aces get one card each and auto-stand.
router.post("/blackjack/split", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "blackjack", status: "active" });
    if (!round) return res.status(404).json({ error: "No active round" });
    const state = await ensureHandsShape(round);
    if (!canSplitNow(state)) {
      return res.status(400).json({ error: "This hand cannot be split" });
    }
    const idx = state.activeHand;
    const hand = state.hands[idx];

    const paid = await debit(req.userId, hand.bet, { roundId: round._id });
    if (!paid.ok) return res.status(400).json({ error: paid.error });

    const [d1, d2] = await drawMany(round.seedId, 2);
    const draws = [
      { nonce: d1.nonce, index: d1.index, to: "player" },
      { nonce: d2.nonce, index: d2.index, to: "player" },
    ];
    const aces = isAce(hand.cards[0]); // pair of aces (equal value pair rule)
    const mk = (orig, drawn) => {
      const cards = [orig, drawn];
      const done = aces || handValue(cards).total >= 21;
      return { cards, bet: hand.bet, doubled: false, fromSplit: true, done };
    };
    // The split hand's two new hands take its place; hands after it shift right.
    const hands = [...state.hands];
    hands.splice(idx, 1, mk(hand.cards[0], d1.index), mk(hand.cards[1], d2.index));
    const next = hands.findIndex((h) => !h.done); // earlier hands are done, so this lands at idx or later
    const newState = {
      ...state,
      hands,
      activeHand: next === -1 ? 0 : next,
      draws: [...(state.draws || []), ...draws],
    };

    // Guard on the exact shape we read (hand count + active index + a 2-card
    // active hand): a racing duplicate split fails the match and gets 409.
    const claimed = await GameRound.findOneAndUpdate(
      {
        _id: round._id, status: "active", "state.stage": "player",
        "state.hands": { $size: state.hands.length },
        "state.activeHand": idx,
        [`state.hands.${idx}.cards`]: { $size: 2 },
      },
      { $set: { state: newState } },
      { returnDocument: "after" }
    );
    if (!claimed) {
      const { user, operator } = await resolveWalletForRollback(req.userId);
      if (operator && paid.txId) await remoteRollback(operator, paid.txId, user);
      else await credit(req.userId, hand.bet, { roundId: round._id });
      return res.status(409).json({ error: "Action already in progress" });
    }

    if (next === -1) return settleAll(req, res, round, newState, []);
    return res.json(playerView(round, newState, { balance: paid.balance }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /blackjack/hit ───────────────────────────────────────────────────
router.post("/blackjack/hit", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "blackjack", status: "active" });
    if (!round) return res.status(404).json({ error: "No active round" });
    const state = await ensureHandsShape(round);
    if (state.stage !== "player") return res.status(404).json({ error: "No active round" });

    const idx = state.activeHand;
    const hand = state.hands[idx];
    const prevLen = hand.cards.length;

    const d = await drawNext(round.seedId);
    const draw = { nonce: d.nonce, index: d.index, to: "player" };
    const cards = [...hand.cards, d.index];
    const done = handValue(cards).total >= 21;
    const hands = state.hands.map((h, i) => (i === idx ? { ...h, cards, done } : h));

    // Guard: only lands if this hand still has the length we read. A racing
    // duplicate gets 409 (its nonce is burned — verifiable, never dealt).
    const updated = await GameRound.findOneAndUpdate(
      { _id: round._id, status: "active", "state.stage": "player", [`state.hands.${idx}.cards`]: { $size: prevLen } },
      { $set: { [`state.hands.${idx}.cards`]: cards, [`state.hands.${idx}.done`]: done }, $push: { "state.draws": draw } },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(409).json({ error: "Action already in progress" });

    const newState = { ...state, hands };
    if (done) return advanceOrSettle(req, res, round, newState, []);
    return res.json(playerView(round, newState));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /blackjack/stand ─────────────────────────────────────────────────
router.post("/blackjack/stand", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "blackjack", status: "active" });
    if (!round) return res.status(404).json({ error: "No active round" });
    const state = await ensureHandsShape(round);
    if (state.stage !== "player") return res.status(404).json({ error: "No active round" });

    const idx = state.activeHand;
    const hands = state.hands.map((h, i) => (i === idx ? { ...h, done: true } : h));
    return advanceOrSettle(req, res, round, { ...state, hands }, []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /blackjack/double ────────────────────────────────────────────────
// Double the ACTIVE hand's stake for one card, then forced stand. Allowed on
// any first two cards, including split hands (not split aces — those are
// already done).
router.post("/blackjack/double", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "blackjack", status: "active" });
    if (!round) return res.status(404).json({ error: "No active round" });
    const state = await ensureHandsShape(round);
    if (state.stage !== "player") return res.status(404).json({ error: "No active round" });
    if (!canDoubleNow(state)) {
      return res.status(400).json({ error: "Double is only available on a two-card hand" });
    }

    const idx = state.activeHand;
    const hand = state.hands[idx];

    const paid = await debit(req.userId, hand.bet, { roundId: round._id });
    if (!paid.ok) return res.status(400).json({ error: paid.error });

    // Claim the doubled flag first (guarded) so a racing duplicate can't
    // double the same hand twice; refund if the claim loses.
    const marked = await GameRound.findOneAndUpdate(
      {
        _id: round._id, status: "active", "state.stage": "player",
        [`state.hands.${idx}.doubled`]: false, [`state.hands.${idx}.cards`]: { $size: 2 },
      },
      { $set: { [`state.hands.${idx}.doubled`]: true } },
      { returnDocument: "after" }
    );
    if (!marked) {
      const { user, operator } = await resolveWalletForRollback(req.userId);
      if (operator && paid.txId) await remoteRollback(operator, paid.txId, user);
      else await credit(req.userId, hand.bet, { roundId: round._id });
      return res.status(409).json({ error: "Action already in progress" });
    }

    const d = await drawNext(round.seedId);
    const cards = [...hand.cards, d.index];
    const hands = state.hands.map((h, i) => (i === idx ? { ...h, cards, doubled: true, done: true } : h));
    const draw = { nonce: d.nonce, index: d.index, to: "player" };
    return advanceOrSettle(req, res, round, { ...state, hands }, [draw]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /blackjack/active — refresh-resume ────────────────────────────────
router.get("/blackjack/active", requireAuth, async (req, res) => {
  try {
    const round = await GameRound.findOne({ userId: req.userId, gameType: "blackjack", status: "active" });
    if (!round) return res.json({ active: false });
    const state = await ensureHandsShape(round);
    res.json({ active: true, betAmount: round.betAmount, ...playerView(round, state) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
