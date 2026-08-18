import mongoose from "mongoose";

// Cabinet edition: a "user" is either a physical machine (role "cabinet" —
// the permanent entity that inserts cash and plays) or a backoffice admin
// (role "admin" — email/password login). Machines never log in with a
// password; they authenticate with their machine key via /api/cabinet/session.
//
// The game/wallet/fairness code only ever needs `_id` and `balance`, which is
// why the whole Originals stack runs unchanged on top of this model.
const userSchema = new mongoose.Schema(
  {
    // Machine identity (role "cabinet"). cabinetId is the human-facing label:
    // "CABINET-0001". The machine key is random, held in the machine's local
    // config file, and stored here only as a sha256 hash.
    cabinetId: {
      type: String,
      trim: true,
      uppercase: true,
    },
    machineKeyHash: {
      type: String,
    },

    // Backoffice admins (role "admin").
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
    },

    // Credits currently on the machine. Cash inserted via the bill validator
    // is credited here; every movement also writes a CashEvent ledger row.
    balance: {
      type: Number,
      default: 0,
    },

    role: {
      type: String,
      enum: ["cabinet", "admin", "operator"],
      default: "cabinet",
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

// Each is unique only when it exists (cabinets have no email; admins have no
// cabinetId).
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ cabinetId: 1 }, { unique: true, sparse: true });

export default mongoose.model("User", userSchema);
