import User from "../models/User.js";
import Operator from "../models/Operator.js";
import { remoteDebit, remoteCredit } from "./walletRemote.js";

// `preloaded` lets hot paths skip the User re-fetch when the route already
// holds the user (must include operatorId + externalId — remoteDebit/credit
// identify the player to the operator by externalId).
async function resolveWallet(userId, preloaded) {
  const user = preloaded || (await User.findById(userId));
  if (!user) return { user: null, operator: null, remote: false };

  // Demo players ALWAYS play against their local fake balance — even when
  // their operator is a remote-wallet one. A demo round must never produce
  // an operator wallet call. The externalId prefix check is deliberate
  // belt-and-suspenders: a preloaded user projected WITHOUT isDemo (the bug
  // this guards against) still can't route demo traffic to an operator,
  // because demo users are always minted with an externalId of "demo:…".
  const isDemo = user.isDemo || (typeof user.externalId === "string" && user.externalId.startsWith("demo:"));
  if (!user.operatorId || isDemo) return { user, operator: null, remote: false };

  const operator = await Operator.findById(user.operatorId);
  const remote = !!(operator && operator.walletMode === "remote" && operator.walletUrl && operator.sharedSecret);

  return { user, operator, remote };
}

export async function debit(userId, amount, { roundId, user: preloaded } = {}) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Invalid amount" };
  }

  const { user, operator, remote } = await resolveWallet(userId, preloaded);
  if (!user) return { ok: false, error: "User not found" };

  if (remote) {
    return remoteDebit(user, operator, amount, { roundId });
  }

  const updated = await User.findOneAndUpdate(
    { _id: userId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { returnDocument: "after" }
  );

  if (!updated) return { ok: false, error: "Insufficient balance" };
  return { ok: true, balance: updated.balance };
}

export async function credit(userId, amount, { roundId, user: preloaded } = {}) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Invalid amount" };
  }

  const { user, operator, remote } = await resolveWallet(userId, preloaded);
  if (!user) return { ok: false, error: "User not found" };

  if (remote) {
    return remoteCredit(user, operator, amount, { roundId });
  }

  const updated = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { balance: amount } },
    { returnDocument: "after" }
  );

  if (!updated) return { ok: false, error: "User not found" };
  return { ok: true, balance: updated.balance };
}

export async function resolveWalletForRollback(userId) {
  const user = await User.findById(userId);
  const operator = user?.operatorId ? await Operator.findById(user.operatorId) : null;
  return { user, operator };
}