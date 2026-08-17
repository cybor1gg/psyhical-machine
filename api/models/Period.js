// An accounting period for the cabinet: the span between two RESET PERIOD
// presses in the backoffice. Exactly one document has endedAt: null (the
// active period). Closing one snapshots its totals so history reads fast
// and survives any later data pruning.
import mongoose from "mongoose";

const periodSchema = new mongoose.Schema(
  {
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    closedBy: { type: String, default: null },     // admin email
    totals: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

periodSchema.index({ endedAt: 1, startedAt: -1 });

export default mongoose.model("Period", periodSchema);
