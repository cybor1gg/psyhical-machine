import { verifyToken } from "../lib/auth.js";
import User from "../models/User.js";

export async function requireAdmin(req, res, next) {
  // The admin realm reads its OWN cookie: `token` is shared with player
  // sessions and gets overwritten by the embed exchange whenever a game is
  // tested in the same browser — which used to silently end admin sessions.
  const token = req.cookies?.admin_token;
  const payload = token ? verifyToken(token) : null;

  if (!payload) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const user = await User.findById(payload.userId);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  req.userId = user._id.toString();
  req.user = user;
  next();
}