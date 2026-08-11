import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // Direct players (register/login). Optional because shadow users
    // (operator players) have neither email nor password.
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
    },

    balance: {
      type: Number,
      default: 1000,
    },

    role: {
      type: String,
      enum: ["player", "admin"],
      default: "player",
    },

    // Shadow-user identity: which operator this player belongs to,
    // and the operator's own ID for them. null for direct players.
    operatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Operator",
      default: null,
    },
    externalId: {
      type: String,
      default: null,
    },

    // Anonymous try-before-you-register session (operator demo mode). Demo
    // users always play against their LOCAL fake balance — never the
    // operator's wallet — and are excluded from every GGR/report scope.
    isDemo: {
      type: Boolean,
      default: false,
    },
    // TTL cleanup handle: set only on demo users; Mongo deletes the doc when
    // it passes (see index below). Real users never carry this field.
    demoExpiresAt: {
      type: Date,
      default: null,
    },

    // Pre-bet Hi-Lo table card (v3): drawn from the seed chain, shown
    // face-up before betting, free to skip. start() uses exactly this card.
    pendingHilo: {
      index: Number,
      nonce: Number,
      seedId: { type: mongoose.Schema.Types.ObjectId, ref: "Seed" },
    },

    // War: consecutive-tie streak (side-bet ladders + the 4-tie bonus).
    // Grows on ties, resets on non-tie deals and surrenders. Mongoose strict
    // mode silently drops writes to undeclared fields — this MUST be here.
    warTieStreak: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Email is unique only when it exists (shadow users have none).
userSchema.index({ email: 1 }, { unique: true, sparse: true });

// One shadow user per (operator, external player) pair — only enforced
// on documents that actually have an operator.
userSchema.index(
  { operatorId: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { operatorId: { $type: "objectId" } } }
);

// Demo users are throwaway: Mongo reaps them ~24h after creation (TTL runs
// only on docs where demoExpiresAt exists — real users never have it).
userSchema.index({ demoExpiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("User", userSchema);