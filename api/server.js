import "dotenv/config";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
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

// ── the built kiosk, served by this same process ────────────────────────────
// A cabinet runs ONE process: point STATIC_DIR at the built frontend (or drop
// it in ./public) and the whole product answers on one port, same-origin — no
// dev server, no CORS, nothing to configure on the machine. In development
// this block simply finds nothing and Vite keeps serving the UI.
const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.STATIC_DIR
  ? path.resolve(process.env.STATIC_DIR)
  : path.join(here, "public");
if (fs.existsSync(path.join(staticDir, "index.html"))) {
  app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
  // SPA fallback: every non-API route renders the app (deep links, refresh)
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(staticDir, "index.html")));
  console.log("Serving kiosk UI from", staticDir);
}

const port = process.env.PORT || 5001;
connectDB().then(() => {
  app.listen(port, () => console.log(`API running on http://localhost:${port}`));
});