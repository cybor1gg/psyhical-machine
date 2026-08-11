import mongoose from "mongoose";

const SeedSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    serverSeed: { type: String, required: true },
    serverSeedHash: { type: String, required: true },
    clientSeed: { type: String, required: true },
    nonce: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    revealedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Claimed on EVERY round (ensureActiveSeed / drawNextForUser look up the
// player's live seed by {userId, active}) — without this it is a collection
// scan per bet.
SeedSchema.index({ userId: 1, active: 1 });

export default mongoose.models.Seed || mongoose.model("Seed", SeedSchema);