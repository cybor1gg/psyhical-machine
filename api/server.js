import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { connectDB } from "./lib/mongodb.js";
import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import fairRoutes from "./routes/fair.js";
import gamesRoutes from "./routes/games.js";
import blackjackRoutes from "./routes/blackjack.js";
import warRoutes from "./routes/war.js";
import towerRoutes from "./routes/tower.js";
import diceRoutes from "./routes/dice.js";
import limboRoutes from "./routes/limbo.js";
import minesRoutes from "./routes/mines.js";
import plinkoRoutes from "./routes/plinko.js";
import kenoRoutes from "./routes/keno.js";
import rouletteRoutes from "./routes/roulette.js";
import baccaratRoutes from "./routes/baccarat.js";
import chickenRoutes from "./routes/chicken.js";
import adminRoutes from "./routes/admin.js";
import adminOperatorsRoutes from "./routes/adminOperators.js";
import partnerRoutes from "./routes/partner.js";
import operatorRoutes from "./routes/operator.js";
import embedRoutes from "./routes/embed.js";
import { retryFailedCredits } from "./lib/walletRemote.js";

const app = express();

// Exactly ONE CORS policy per request — stacking them would overwrite headers.
// The public verifier is stateless math over caller-supplied seeds, meant to
// be called from OPERATOR frontends on any origin, so it alone answers with *;
// everything else keeps the credentials-locked site policy.
const openCors = cors({ origin: "*" });
const siteCors = cors({ origin: process.env.WEB_ORIGIN, credentials: true });
app.use((req, res, next) => (req.path === "/api/fair/verify" ? openCors : siteCors)(req, res, next));
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/fair", fairRoutes);
app.use("/api/games", gamesRoutes);
app.use("/api/games", blackjackRoutes);
app.use("/api/games", warRoutes);
app.use("/api/games", towerRoutes);
app.use("/api/games", diceRoutes);
app.use("/api/games", limboRoutes);
app.use("/api/games", minesRoutes);
app.use("/api/games", plinkoRoutes);
app.use("/api/games", kenoRoutes);
app.use("/api/games", rouletteRoutes);
app.use("/api/games", baccaratRoutes);
app.use("/api/games", chickenRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin", adminOperatorsRoutes);
app.use("/api/partner", partnerRoutes);
app.use("/api/operator", operatorRoutes);
app.use("/api/embed", embedRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 5001;
connectDB().then(() => {
  app.listen(port, () => console.log(`API running on http://localhost:${port}`));
  // failed-credit recovery: re-deliver payouts the operator wallet rejected
  // (same txId — idempotent on their side). First sweep shortly after boot
  // catches any backlog; then every minute.
  setTimeout(() => retryFailedCredits().catch(() => {}), 15e3);
  setInterval(() => retryFailedCredits().catch(() => {}), 60e3);
});