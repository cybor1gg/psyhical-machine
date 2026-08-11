import mongoose from "mongoose";

const OperatorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    apiKeyHash: { type: String, required: true, unique: true },
    active: { type: Boolean, default: true },
    walletUrl: { type: String, default: null },
    sharedSecret: { type: String, default: null },
    walletMode: { type: String, enum: ["local", "remote"], default: "local" },
  },
  { timestamps: true }
);

export default mongoose.models.Operator ||
  mongoose.model("Operator", OperatorSchema);