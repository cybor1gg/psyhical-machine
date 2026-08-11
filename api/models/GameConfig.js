import mongoose from "mongoose";

const GameConfigSchema = new mongoose.Schema(
  {
    gameType: { type: String, required: true, unique: true },
    houseEdge: { type: Number, required: true, min: 0, max: 0.5 },
    minBet: { type: Number, default: 1 },
    maxBet: { type: Number, default: 500 },
    enabled: { type: Boolean, default: true },
    // The platform-owned RTP window. Operator overrides are clamped into
    // [houseEdgeMin, houseEdgeMax] at read time, so tightening the window
    // later applies instantly to every operator.
    houseEdgeMin: { type: Number, default: 0.005, min: 0, max: 0.5 },
    houseEdgeMax: { type: Number, default: 0.1, min: 0, max: 0.5 },
    // Liability cap: payouts are clamped to betAmount × maxWinMultiplier.
    // Matters for tall-ladder games (Dragon Tower Master tops out around
    // 240,000× uncapped).
    maxWinMultiplier: { type: Number, default: 10000, min: 1 },
  },
  { timestamps: true }
);

export default mongoose.models.GameConfig ||
  mongoose.model("GameConfig", GameConfigSchema);