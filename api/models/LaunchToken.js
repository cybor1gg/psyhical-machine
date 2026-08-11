import mongoose from "mongoose";

const LaunchTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    operatorId: { type: mongoose.Schema.Types.ObjectId, ref: "Operator", required: true },
    gameType: { type: String, required: true },
    used: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

LaunchTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.LaunchToken ||
  mongoose.model("LaunchToken", LaunchTokenSchema);