import User from "../models/User.js";

// Cabinet wallet: the balance lives on the machine's own document and every
// movement is a conditional atomic update — no transactions needed. The
// balance-gte guard on debit makes overdraft impossible even under
// concurrent requests.

export async function debit(userId, amount, { roundId } = {}) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Invalid amount" };
  }

  const updated = await User.findOneAndUpdate(
    { _id: userId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { returnDocument: "after" }
  );

  if (!updated) return { ok: false, error: "Insufficient balance" };
  return { ok: true, balance: updated.balance };
}

export async function credit(userId, amount, { roundId } = {}) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Invalid amount" };
  }

  const updated = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { balance: amount } },
    { returnDocument: "after" }
  );

  if (!updated) return { ok: false, error: "User not found" };
  return { ok: true, balance: updated.balance };
}
