import mongoose from "mongoose";

// A human login for an operator's backoffice — deliberately separate from the
// opk_ API keys (server credentials) and from player accounts. One collection
// so "add a second user for their finance team" is a row, not a redesign.
const OperatorUserSchema = new mongoose.Schema(
  {
    operatorId: { type: mongoose.Schema.Types.ObjectId, ref: "Operator", required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.models.OperatorUser ||
  mongoose.model("OperatorUser", OperatorUserSchema);
