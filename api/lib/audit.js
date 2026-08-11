import AuditLog from "../models/AuditLog.js";

// Fire-and-forget audit write. Auditing must never break the action being
// audited — failures are logged and swallowed.
export function logAudit(entry) {
  AuditLog.create(entry).catch((err) => console.error("audit write failed:", err.message));
}
