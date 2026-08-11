import mongoose from "mongoose";

const GameRoundSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    gameType: { type: String, required: true },
    status: { type: String, enum: ["active", "won", "lost", "cashed_out"], default: "active" },
    betAmount: { type: Number, required: true },
    // Total wagered over the round's life: betAmount + doubles + split bets +
    // insurance premiums. GGR math must use THIS (betAmount alone understates
    // blackjack turnover). Null on old rounds → fall back to betAmount.
    staked: { type: Number, default: null },
    payout: { type: Number, default: 0 },
    houseEdge: { type: Number, required: true },
    seedId: { type: mongoose.Schema.Types.ObjectId, ref: "Seed", required: true },
    nonceStart: { type: Number, required: true },
    state: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

GameRoundSchema.index({ userId: 1, gameType: 1, status: 1 });

export default mongoose.models.GameRound ||
  mongoose.model("GameRound", GameRoundSchema);