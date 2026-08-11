import mongoose from "mongoose";

const TransactionSchema = new mongoose.Schema(
  {
    txId: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    operatorId: { type: mongoose.Schema.Types.ObjectId, ref: "Operator", default: null },
    roundId: { type: mongoose.Schema.Types.ObjectId, ref: "GameRound", default: null },
    type: { type: String, enum: ["debit", "credit", "rollback"], required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ["pending", "completed", "failed", "rolled_back"], default: "pending" },
    balanceAfter: { type: Number, default: null },
    error: { type: String, default: null },
    // failed-credit recovery: how many sweeper re-deliveries have run, and
    // when the next one is due (exponential backoff)
    retryCount: { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The failed-credit sweeper runs every 60s filtering on status+type and the
// backoff clock; unindexed it scanned every transaction ever written.
TransactionSchema.index({ status: 1, type: 1, nextRetryAt: 1 });
// Round lookups for support/reconciliation ("what money moved for this round").
TransactionSchema.index({ roundId: 1 });

export default mongoose.models.Transaction ||
  mongoose.model("Transaction", TransactionSchema);