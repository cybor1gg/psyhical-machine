import mongoose from "mongoose";

// The physical-cash ledger. Every movement of real money on a machine writes
// exactly one row here at the moment the balance changes — the balance alone
// can't be reconciled against the cash box, this ledger can.
//
//   cash_in  — the bill validator accepted a note (or the dev simulator did)
//   cash_out — credits removed for a payout (attendant pay, future TITO)
const cashEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Denormalized machine label so the ledger stays readable even if a
    // machine document is ever retired.
    cabinetId: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["cash_in", "cash_out"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    // Where the event came from: the real validator driver, the dev tool,
    // an admin adjustment, or an attendant payout (player pressed Cash Out).
    source: {
      type: String,
      enum: ["validator", "simulator", "admin", "attendant"],
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

cashEventSchema.index({ userId: 1, createdAt: -1 });
cashEventSchema.index({ createdAt: -1 });

export default mongoose.model("CashEvent", cashEventSchema);
