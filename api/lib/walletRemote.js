import crypto from "crypto";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import Operator from "../models/Operator.js";
import { signPayload } from "./signing.js";

// Wallet calls for ONE user run through a small per-user lane pool.
//
// They were fully serialized because concurrent debits from a plinko pour
// contend on the operator's wallet document, thrash their transaction
// retries and eventually surface "Transaction failed". One-at-a-time cured
// that, but it made a pour cost (2 calls x N balls) sequentially — the last
// ball of a 10-ball burst waited ~2.2s at 110ms/call.
//
// Two changes fix that without bringing the contention back:
//   * a few LANES (WALLET_CONCURRENCY, default 3) instead of strictly one,
//     which is far below the burst that used to break operator wallets;
//   * credits no longer jump the queue. They used to, because the ball's
//     flight waited on the settle response. It no longer does (plinko
//     answers as soon as the debit clears), so a credit cutting in front of
//     the next stake now just delays the next ball. Only rollbacks keep
//     priority — they are corrective and rare.
//
// Ordering per round still holds: a round's credit is enqueued only after
// its debit resolved, and every op is idempotent by txId.
const WALLET_LANES = Math.max(1, Number(process.env.WALLET_CONCURRENCY) || 3);
const userQueues = new Map(); // key -> { high: [], low: [], active: number }

function enqueueWalletOp(userId, priority, fn) {
  return new Promise((resolve, reject) => {
    const key = String(userId);
    let q = userQueues.get(key);
    if (!q) {
      q = { high: [], low: [], active: 0 };
      userQueues.set(key, q);
    }
    (priority ? q.high : q.low).push({ fn, resolve, reject });
    pumpQueue(key, q);
  });
}

function pumpQueue(key, q) {
  while (q.active < WALLET_LANES && (q.high.length || q.low.length)) {
    const job = q.high.shift() || q.low.shift();
    q.active += 1;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        q.active -= 1;
        if (q.high.length || q.low.length) pumpQueue(key, q);
        else if (q.active === 0) userQueues.delete(key);
      });
  }
}

async function callOperatorWallet(operator, endpoint, payload) {
  const body = JSON.stringify(payload);
  const signature = signPayload(payload, operator.sharedSecret);

  let res;
  try {
    res = await fetch(`${operator.walletUrl}/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wallet-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    // Surface the REAL failure — fetch hides ENOTFOUND/ECONNREFUSED/etc.
    // inside err.cause, and "fetch failed" alone is undiagnosable.
    const cause = err.cause?.code || err.cause?.message || err.name;
    throw new Error(`${err.message} (${cause}) url=${operator.walletUrl}/${endpoint}`);
  }

  // Parse from text (not res.json()) so a failure can report WHAT came back.
  // During integration this is the difference between "unparseable" and
  // "your server 301-redirected the POST" — strip a BOM first, some stacks
  // prepend one and it breaks JSON.parse.
  const raw = await res.text().catch(() => "");
  try {
    return JSON.parse(raw.replace(/^﻿/, ""));
  } catch {
    const preview = raw.slice(0, 160).replace(/\s+/g, " ").trim();
    const detail =
      `HTTP ${res.status}` +
      ` content-type=${res.headers.get("content-type") || "none"}` +
      (res.redirected ? ` redirected-to=${res.url}` : "") +
      (preview ? ` body="${preview}"` : " empty-body");
    console.error(`Wallet ${endpoint} returned non-JSON: ${detail} url=${operator.walletUrl}/${endpoint}`);
    return {
      ok: false,
      code: "BAD_RESPONSE",
      error: `Wallet returned a non-JSON response (${detail})`,
    };
  }
}

export function remoteDebit(user, operator, amount, opts = {}) {
  return enqueueWalletOp(user._id, false, () => remoteDebitNow(user, operator, amount, opts));
}

async function remoteDebitNow(user, operator, amount, { roundId } = {}) {
  const txId = "tx_" + crypto.randomUUID();

  const tx = await Transaction.create({
    txId,
    userId: user._id,
    operatorId: operator._id,
    roundId: roundId || null,
    type: "debit",
    amount,
    status: "pending",
  });

  let result;
  try {
    result = await callOperatorWallet(operator, "debit", {
      txId,
      playerId: user.externalId,
      amount,
      roundId: roundId ? roundId.toString() : null,
    });
  } catch (err) {
    tx.status = "failed";
    tx.error = "NETWORK: " + err.message;
    await tx.save();
    // Outcome UNKNOWN (timeout/reset): the operator may have committed the
    // debit after we gave up — the player would be charged for a round that
    // never starts. Rollback is the safe answer either way: the wallet spec
    // makes rolling back an unseen txId a no-op success. Best-effort, don't
    // block the (already failed) bet response on it.
    remoteRollback(operator, txId, user).catch(() => {});
    return { ok: false, error: "Wallet unavailable", txId };
  }

  if (!result.ok) {
    tx.status = "failed";
    tx.error = result.code || result.error || "Unknown wallet error";
    await tx.save();
    return { ok: false, error: result.error || "Wallet rejected debit", txId };
  }

  tx.status = "completed";
  tx.balanceAfter = result.balance;
  await tx.save();

  return { ok: true, balance: result.balance, txId };
}

export function remoteCredit(user, operator, amount, opts = {}) {
  return enqueueWalletOp(user._id, false, () => remoteCreditNow(user, operator, amount, opts));
}

async function remoteCreditNow(user, operator, amount, { roundId } = {}) {
  const txId = "tx_" + crypto.randomUUID();

  const tx = await Transaction.create({
    txId,
    userId: user._id,
    operatorId: operator._id,
    roundId: roundId || null,
    type: "credit",
    amount,
    status: "pending",
  });

  // A credit that dies on the network would eat the player's winnings, so
  // retry the SAME txId a couple of times — the operator's txId idempotency
  // replays the stored result instantly if the first delivery actually
  // landed, and applies it fresh if it never arrived. Either way no double
  // credit is possible.
  let result;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      result = await callOperatorWallet(operator, "credit", {
        txId,
        playerId: user.externalId,
        amount,
        roundId: roundId ? roundId.toString() : null,
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  if (lastErr) {
    tx.status = "failed";
    tx.error = "NETWORK: " + lastErr.message;
    await tx.save();
    return { ok: false, error: "Wallet unavailable", txId };
  }

  if (!result.ok) {
    tx.status = "failed";
    tx.error = result.code || result.error || "Unknown wallet error";
    await tx.save();
    return { ok: false, error: result.error || "Wallet rejected credit", txId };
  }

  tx.status = "completed";
  tx.balanceAfter = result.balance;
  await tx.save();

  return { ok: true, balance: result.balance, txId };
}

export function remoteRollback(operator, originalTxId, user) {
  return enqueueWalletOp(user._id, true, () => remoteRollbackNow(operator, originalTxId, user));
}

async function remoteRollbackNow(operator, originalTxId, user) {
  const txId = "tx_" + crypto.randomUUID();

  // The rollback must carry the SAME roundId as the debit it reverses —
  // operators group wallet calls by round, and a roundless rollback looks
  // like a stray transaction on their side.
  const original = await Transaction.findOne({ txId: originalTxId }).select("roundId");
  const roundId = original?.roundId || null;

  const tx = await Transaction.create({
    txId,
    userId: user._id,
    operatorId: operator._id,
    roundId,
    type: "rollback",
    amount: 0,
    status: "pending",
  });

  try {
    const result = await callOperatorWallet(operator, "rollback", {
      txId,
      originalTxId,
      playerId: user.externalId,
      roundId: roundId ? roundId.toString() : null,
    });

    tx.status = result.ok ? "completed" : "failed";
    tx.error = result.ok ? null : (result.code || "rollback failed");
    await tx.save();

    if (result.ok) {
      await Transaction.findOneAndUpdate({ txId: originalTxId }, { status: "rolled_back" });
    }

    return result;
  } catch (err) {
    tx.status = "failed";
    tx.error = "NETWORK: " + err.message;
    await tx.save();
    return { ok: false, error: "Wallet unavailable" };
  }
}

// ── Balance read (optional operator endpoint) ───────────────────────────────
// Ask the operator's wallet what the player has, so the embed can show it and
// the games can pre-block over-bets at launch. This is READ-ONLY (no ledger
// row, no queue) and best-effort: any failure — the operator hasn't
// implemented POST {walletUrl}/balance, a timeout, a non-JSON reply — resolves
// to null and the game simply runs unblocked (the server still rejects
// overbets). Never let it hold up game load: capped well under the 10s wallet
// timeout.
export async function remoteBalance(user, operator) {
  if (!operator || !operator.walletUrl || !user?.externalId) return null;
  try {
    const result = await Promise.race([
      callOperatorWallet(operator, "balance", { playerId: user.externalId }),
      new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (result && result.ok && Number.isFinite(Number(result.balance))) {
      return Number(result.balance);
    }
    return null;
  } catch {
    return null;
  }
}

// ── Failed-credit recovery ──────────────────────────────────────────────────
// A failed credit is money the player is owed on a round that already
// settled — dropping it is never acceptable. This sweeper re-delivers each
// failed credit with its ORIGINAL txId; the operator's txId idempotency
// makes that safe in both directions: a delivery that actually landed
// replays its stored result (no double pay), one that never landed applies
// fresh. Exponential backoff per transaction, capped attempts, 7-day
// horizon. Runs on an interval from server bootstrap.
const CREDIT_RETRY_MAX = 12;
let creditSweepRunning = false;

export async function retryFailedCredits() {
  if (creditSweepRunning) return; // sweeps never overlap
  creditSweepRunning = true;
  try {
    const now = new Date();
    const due = await Transaction.find({
      type: "credit",
      status: "failed",
      createdAt: { $gte: new Date(now - 7 * 864e5) },
      retryCount: { $not: { $gte: CREDIT_RETRY_MAX } }, // matches missing too
      $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
    }).sort({ createdAt: 1 }).limit(25);

    for (const tx of due) {
      const [user, operator] = await Promise.all([
        User.findById(tx.userId).select("externalId"),
        Operator.findById(tx.operatorId),
      ]);
      // direct-wallet rows or deleted operators have nowhere to deliver to
      if (!user || !operator || !operator.walletUrl) {
        tx.retryCount = CREDIT_RETRY_MAX;
        await tx.save();
        continue;
      }
      let result;
      try {
        result = await callOperatorWallet(operator, "credit", {
          txId: tx.txId,
          playerId: user.externalId,
          amount: tx.amount,
          roundId: tx.roundId ? tx.roundId.toString() : null,
        });
      } catch (err) {
        result = { ok: false, code: "NETWORK: " + err.message };
      }
      if (result.ok) {
        tx.status = "completed";
        tx.balanceAfter = result.balance ?? null;
        tx.error = null;
        await tx.save();
        console.log(`Credit recovered: ${tx.txId} $${tx.amount} (attempt ${(tx.retryCount || 0) + 1})`);
      } else {
        tx.retryCount = (tx.retryCount || 0) + 1;
        // 2min, 4min, 8min ... capped at 60min between attempts
        tx.nextRetryAt = new Date(Date.now() + Math.min(60, 2 ** tx.retryCount) * 60e3);
        tx.error = result.code || result.error || "Unknown wallet error";
        await tx.save();
      }
    }
  } catch (err) {
    console.error("Credit recovery sweep failed:", err.message);
  } finally {
    creditSweepRunning = false;
  }
}
