import { Router } from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { createToken } from "../lib/auth.js";

const router = Router();

router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email required" });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ email, passwordHash });

    res.status(201).json({ id: user._id, email: user.email, balance: user.balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = createToken(user._id.toString());

    const cookieOpts = {
      httpOnly: true,
      // HTTPS-only in production; lax is enough because the frontend is
      // served from the same origin as the API.
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: "/",
    };
    res.cookie("token", token, cookieOpts);
    // Admins get their session in a SEPARATE cookie: the embed exchange
    // overwrites `token` with a player token whenever a game is tested in the
    // same browser, which used to log the admin out of the backoffice.
    if (user.role === "admin") {
      res.cookie("admin_token", token, cookieOpts);
    }

    res.json({ id: user._id, email: user.email, balance: user.balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Clears the session cookie. Cookie identity is name+path, so this also
// clears embed sessions despite their different sameSite attribute.
router.post("/logout", (req, res) => {
  res.clearCookie("token", { httpOnly: true, path: "/" });
  res.clearCookie("admin_token", { httpOnly: true, path: "/" });
  res.json({ ok: true });
});

export default router;