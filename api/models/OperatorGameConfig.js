import mongoose from "mongoose";

// Per-operator, per-game overrides. Anything null falls back to the platform
// default (GameConfig / DEFAULT_REV_SHARE). houseEdge is clamped to the
// platform's allowed window AT READ TIME, so tightening the bounds later
// takes effect without touching every operator row.
const OperatorGameConfigSchema = new mongoose.Schema(
  {
    operatorId: { type: mongoose.Schema.Types.ObjectId, ref: "Operator", required: true },
    gameType: { type: String, required: true },
    houseEdge: { type: Number, default: null, min: 0, max: 0.5 },
    revSharePct: { type: Number, default: null, min: 0, max: 100 },
  },
  { timestamps: true }
);

OperatorGameConfigSchema.index({ operatorId: 1, gameType: 1 }, { unique: true });

export default mongoose.models.OperatorGameConfig ||
  mongoose.model("OperatorGameConfig", OperatorGameConfigSchema);
