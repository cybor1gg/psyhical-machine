import { Router } from "express";
import User from "../models/User.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

// Session identity — a DELIBERATELY slim shape (never the raw document;
// internal fields like game carry-over state stay server-side).
// `direct: true` is kept for the game pages' guard, which the online
// project used to bounce operator embeds; every cabinet session is direct.
router.get("/", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("email cabinetId balance role");
    if (!user) return res.status(401).json({ error: "User not found" });
    res.json({
      id: user._id,
      email: user.email ?? null,
      cabinetId: user.cabinetId ?? null,
      balance: user.balance,
      role: user.role ?? "cabinet",
      direct: true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
