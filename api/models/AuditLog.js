import mongoose from "mongoose";

// Paper trail for anything money-adjacent (RTP, rev-share, bounds, operator
// lifecycle). Append-only by convention: nothing in the codebase updates or
// deletes these.
const AuditLogSchema = new mongoose.Schema(
  {
    actorType: { type: String, enum: ["admin", "operator"], required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    actorLabel: { type: String, default: null },      // email/name for display
    operatorId: { type: mongoose.Schema.Types.ObjectId, ref: "Operator", default: null },
    action: { type: String, required: true },          // e.g. "config.update"
    gameType: { type: String, default: null },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

AuditLogSchema.index({ createdAt: -1 });

export default mongoose.models.AuditLog || mongoose.model("AuditLog", AuditLogSchema);
