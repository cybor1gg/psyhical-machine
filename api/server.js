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
import cabinetRoutes from "./routes/cabinet.js";

const app = express();

app.use(cors({ origin: process.env.WEB_ORIGIN, credentials: true }));
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
app.use("/api/cabinet", cabinetRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 5001;
connectDB().then(() => {
  app.listen(port, () => console.log(`API running on http://localhost:${port}`));
});