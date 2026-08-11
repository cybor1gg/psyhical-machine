import User from "../models/User.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

export function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

// Partner-portal token — a DIFFERENT shape on purpose: it carries `kind` and
// operator claims and no userId, so it can never pass requireAuth, and player
// tokens (no `kind`) can never pass the portal middleware. One secret, two
// non-overlapping realms.
export function createPortalToken(operatorUserId, operatorId) {
  return jwt.sign(
    { kind: "operator", operatorUserId, operatorId },
    JWT_SECRET,
    { expiresIn: "24h" }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
