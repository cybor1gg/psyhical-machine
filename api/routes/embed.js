import { Router } from "express";
import LaunchToken from "../models/LaunchToken.js";
import User from "../models/User.js";
import { createToken } from "../lib/auth.js";
import Operator from "../models/Operator.js";
import { remoteBalance } from "../lib/walletRemote.js";

const router = Router();

router.post("/exchange", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }

    const launch = await LaunchToken.findOneAndUpdate(
      { token, used: false, expiresAt: { $gt: new Date() } },
      { used: true },
      { returnDocument: "after" }
    );

    if (!launch) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const user = await User.findById(launch.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    const operator = await Operator.findById(launch.operatorId);
    // Demo players read their local fake balance even under a remote operator.
    const isRemote = operator && operator.walletMode === "remote" && !user.isDemo;

    const jwt = createToken(user._id.toString());

    res.cookie("token", jwt, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 1000 * 60 * 60 * 2,
      path: "/",
    });

    // The cookie above is refused by mobile browsers inside cross-site
    // iframes (Safari ITP blocks third-party-context cookies wholesale), so
    // the same session also travels in the body: the embed keeps it in
    // memory/sessionStorage and sends it as an Authorization bearer header.
    res.json({
      ok: true,
      gameType: launch.gameType,
      // Remote operators hold the money, so ask their wallet for it (falls
      // back to null if they don't expose POST {walletUrl}/balance).
      balance: isRemote ? await remoteBalance(user, operator) : user.balance,
      sessionToken: jwt,
      // white-labeling: card backs (and any future brand marks) show the
      // operator's name inside their embeds
      operatorName: operator?.name ?? null,
      // Try-mode session: the embed shows a DEMO badge and the balance is fake.
      demo: !!user.isDemo,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;