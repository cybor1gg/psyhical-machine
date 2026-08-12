// Cabinet identity + physical cash. The machine is the permanent "player":
// it authenticates once at boot with its machine key (from the local config
// file on the Windows box) and receives the exact same session token the
// game routes already understand — nothing downstream knows or cares that
// the player is a machine.
import { Router } from "express";
import crypto from "crypto";
import User from "../models/User.js";
import CashEvent from "../models/CashEvent.js";
import GameRound from "../models/GameRound.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createToken } from "../lib/auth.js";
import { credit } from "../lib/wallet.js";

const router = Router();

export function hashMachineKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// Notes the (future) bill validator accepts — the real Macedonian denar
// banknote series. The on-screen INSERT CASH panel offers the same set, so
// testing exercises exactly the production path.
export const ACCEPTED_DENOMINATIONS = [10, 50, 100, 200, 500, 1000, 2000, 5000];

// ── POST /session { cabinetId, machineKey } — machine boot handshake ────────
router.post("/session", async (req, res) => {
  try {
    const { cabinetId, machineKey } = req.body ?? {};
    if (typeof cabinetId !== "string" || typeof machineKey !== "string" || !cabinetId.trim() || !machineKey) {
      return res.status(400).json({ error: "cabinetId and machineKey required" });
    }

    const cabinet = await User.findOne({ cabinetId: cabinetId.trim().toUpperCase(), role: "cabinet" });
    if (!cabinet || !cabinet.machineKeyHash) {
      return res.status(401).json({ error: "Unknown cabinet" });
    }

    const given = Buffer.from(hashMachineKey(machineKey), "hex");
    const stored = Buffer.from(cabinet.machineKeyHash, "hex");
    if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
      return res.status(401).json({ error: "Invalid machine key" });
    }

    const token = createToken(cabinet._id.toString());
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: "/",
    });

    // The token is ALSO returned in the body: the kiosk shell keeps it as a
    // Bearer header (api.js setSessionToken), so a cookie hiccup can never
    // brick a machine mid-shift.
    res.json({
      sessionToken: token,
      cabinetId: cabinet.cabinetId,
      balance: cabinet.balance,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /state — current machine identity + credits ─────────────────────────
router.get("/state", requireAuth, async (req, res) => {
  try {
    const cabinet = await User.findById(req.userId).select("cabinetId balance role");
    if (!cabinet || cabinet.role !== "cabinet") {
      return res.status(401).json({ error: "Not a cabinet session" });
    }
    res.json({
      cabinetId: cabinet.cabinetId,
      balance: cabinet.balance,
      denominations: ACCEPTED_DENOMINATIONS,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /cash-in { amount } — a bill was accepted ──────────────────────────
// Called by the validator driver (later) or the dev simulator (now). Credits
// the machine and writes the ledger row in the same request; the ledger is
// what gets reconciled against the physical cash box.
router.post("/cash-in", requireAuth, async (req, res) => {
  try {
    const cabinet = await User.findById(req.userId).select("cabinetId role");
    if (!cabinet || cabinet.role !== "cabinet") {
      return res.status(401).json({ error: "Not a cabinet session" });
    }

    const { amount } = req.body ?? {};
    if (!ACCEPTED_DENOMINATIONS.includes(amount)) {
      return res.status(400).json({ error: `amount must be one of: ${ACCEPTED_DENOMINATIONS.join(", ")}` });
    }

    const credited = await credit(req.userId, amount);
    if (!credited.ok) return res.status(400).json({ error: credited.error });

    await CashEvent.create({
      userId: cabinet._id,
      cabinetId: cabinet.cabinetId,
      type: "cash_in",
      amount,
      source: "simulator",
      balanceAfter: credited.balance,
    });

    res.json({ ok: true, amount, balance: credited.balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /cash-out — player redeems their remaining credits ─────────────────
// Atomically zeroes the balance and writes the ledger row; the attendant pays
// out the recorded amount (a ticket printer can hang off the same event
// later). Refused while a round is in play — settle or cash out the game
// first, so the wallet and the round can never disagree.
router.post("/cash-out", requireAuth, async (req, res) => {
  try {
    const cabinet = await User.findById(req.userId).select("cabinetId role");
    if (!cabinet || cabinet.role !== "cabinet") {
      return res.status(401).json({ error: "Not a cabinet session" });
    }

    const activeRound = await GameRound.findOne({ userId: req.userId, status: "active" }).select("_id gameType");
    if (activeRound) {
      return res.status(409).json({ error: "Finish the round in play first" });
    }

    // Read-and-zero in one atomic step; `before` carries the paid-out amount.
    const before = await User.findOneAndUpdate(
      { _id: req.userId, balance: { $gt: 0 } },
      { $set: { balance: 0 } },
      { returnDocument: "before" }
    );
    if (!before) return res.status(400).json({ error: "No credits to cash out" });

    const amount = before.balance;
    await CashEvent.create({
      userId: cabinet._id,
      cabinetId: cabinet.cabinetId,
      type: "cash_out",
      amount,
      source: "attendant",
      balanceAfter: 0,
    });

    res.json({ ok: true, amount, balance: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
