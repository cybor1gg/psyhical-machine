import { verifyToken } from "../lib/auth.js";

export function requireAuth(req, res, next) {
  // Bearer first: embedded game sessions send the token as a header because
  // mobile browsers refuse cookies in cross-site iframes. When the header is
  // present it IS the session — no silent fallback to a possibly-stale cookie.
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : req.cookies?.token;
  const payload = token ? verifyToken(token) : null;

  if (!payload || !payload.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  req.userId = payload.userId;
  next();
}