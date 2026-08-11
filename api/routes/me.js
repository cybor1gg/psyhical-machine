import { Router } from "express";
import User from "../models/User.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

// Session identity — a DELIBERATELY slim shape (never the raw user document;
// internal fields like game carry-over state stay server-side).
//   direct: true  → in-house account (email login on our lobby)
//   direct: false → an operator's player, here via an embed token exchange.
// In-house surfaces (lobby, /games/*) require direct; embed surfaces don't.
router.get("/", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("email externalId balance role operatorId");
    if (!user) return res.status(401).json({ error: "User not found" });
    res.json({
      id: user._id,
      email: user.email ?? null,
      externalId: user.externalId ?? null,
      balance: user.balance,
      role: user.role ?? "player",
      direct: !user.operatorId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
