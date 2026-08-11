import { Router } from "express";
import crypto from "crypto";
import Seed from "../models/Seed.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { ensureActiveSeed, generateServerSeed, hashServerSeed, rollNumber } from "../lib/fair.js";
import { RANKS, SUITS } from "../lib/games/hilo.js";
import { laneDeadly, parseDifficulty, DIFFICULTIES as CHICKEN_DIFFICULTIES } from "../lib/games/chicken.js";
import { KNOWN_GAMES } from "../lib/config.js";

const router = Router();

// ── POST /fair/verify — public, stateless recompute ─────────────────────────
// Pure math over caller-supplied seeds: no auth, no data access, open CORS.
// Operators call this from their OWN frontend to offer the same verifier we
// host — either a manual form (player pastes the seeds from the Fair Play
// modal) or one-click from bet history (seeds fetched server-side via
// GET /api/operator/rounds/:roundId/fairness). Every draw carries every
// game's projection of the same roll — one verifier serves all games —
// plus a `derived` block when gameType names the round's game.
router.post("/verify", (req, res) => {
  const { serverSeed, clientSeed, nonceStart, count, gameType, houseEdge, gridSize, difficulty } = req.body ?? {};

  if (typeof serverSeed !== "string" || !serverSeed.trim() || serverSeed.length > 256) {
    return res.status(400).json({ error: "serverSeed must be a non-empty string (max 256 chars)" });
  }
  if (typeof clientSeed !== "string" || !clientSeed.trim() || clientSeed.length > 128) {
    return res.status(400).json({ error: "clientSeed must be a non-empty string (max 128 chars)" });
  }
  const start = Number(nonceStart);
  if (!Number.isInteger(start) || start < 0 || start > 1e12) {
    return res.status(400).json({ error: "nonceStart must be a non-negative integer" });
  }
  const n = count == null ? 1 : Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    return res.status(400).json({ error: "count must be an integer between 1 and 100" });
  }
  if (gameType != null && !KNOWN_GAMES.includes(gameType)) {
    return res.status(400).json({ error: "Unknown gameType" });
  }
  const edge = houseEdge == null ? 0.01 : Number(houseEdge);
  if (!Number.isFinite(edge) || edge < 0 || edge > 0.5) {
    return res.status(400).json({ error: "houseEdge must be between 0 and 0.5" });
  }
  // only meaningful for gameType "mines" — the size of the removal pool
  const grid = gridSize == null ? 25 : Number(gridSize);
  if (![25, 36, 49, 64].includes(grid)) {
    return res.status(400).json({ error: "gridSize must be one of 25, 36, 49, 64" });
  }
  // only meaningful for gameType "chicken" — picks the per-lane death odds k
  const chickenDifficulty = parseDifficulty(difficulty);
  if (chickenDifficulty == null) {
    return res.status(400).json({ error: "difficulty must be one of " + Object.keys(CHICKEN_DIFFICULTIES).join(", ") });
  }

  const draws = [];
  for (let k = 0; k < n; k++) {
    const nonce = start + k;
    const roll = rollNumber(serverSeed, clientSeed, nonce);
    const cardIndex = Math.floor(roll * 52);
    draws.push({
      nonce,
      roll,
      cardIndex,
      cardLabel: RANKS[cardIndex % 13] + SUITS[Math.floor(cardIndex / 13)],
      dice: Math.floor(roll * 10000) / 100,
      roulettePocket: Math.floor(roll * 37),
      plinkoDirection: Math.floor(roll * 2),
      limboResult: Math.max(1, Math.floor(((1 - edge) / (1 - roll)) * 100) / 100),
      towerTile: { 2: Math.floor(roll * 2), 3: Math.floor(roll * 3), 4: Math.floor(roll * 4) },
      // per-difficulty projections: deadly iff roll < death (5% / 12% / 24% / 45%)
      chickenDeadly: {
        easy: laneDeadly(roll, 0.05), medium: laneDeadly(roll, 0.12),
        hard: laneDeadly(roll, 0.24), daredevil: laneDeadly(roll, 0.45),
      },
    });
  }

  // drawing WITHOUT replacement — mines picks tiles 0..gridSize-1, keno numbers 1..40
  const removal = (pool) =>
    draws.map((d) => {
      const idx = Math.floor(d.roll * pool.length);
      return pool.splice(idx, 1)[0];
    });

  let derived = null;
  if (gameType === "mines") derived = { minePositions: removal(Array.from({ length: grid }, (_, i) => i)) };
  else if (gameType === "keno") derived = { drawnNumbers: removal(Array.from({ length: 40 }, (_, i) => i + 1)) };
  else if (gameType === "plinko") {
    const directions = draws.map((d) => d.plinkoDirection);
    derived = { directions, bucket: directions.reduce((s, v) => s + v, 0) };
  } else if (gameType === "roulette") derived = { pocket: draws[0].roulettePocket };
  else if (gameType === "dice") derived = { result: draws[0].dice };
  else if (gameType === "limbo") derived = { result: draws[0].limboResult, houseEdgeUsed: edge };
  else if (gameType === "tower") derived = {
    tiles2col: draws.map((d) => d.towerTile[2]),
    tiles3col: draws.map((d) => d.towerTile[3]),
    tiles4col: draws.map((d) => d.towerTile[4]),
  };
  else if (gameType === "chicken") {
    const { death } = CHICKEN_DIFFICULTIES[chickenDifficulty];
    const deadlyLanes = draws.map((d) => laneDeadly(d.roll, death));
    const firstDeadly = deadlyLanes.indexOf(true);
    derived = {
      difficulty: chickenDifficulty,
      deadlyLanes,
      firstDeadlyLane: firstDeadly === -1 ? null : firstDeadly + 1, // 1-based lane
    };
  }
  else if (gameType) derived = { cards: draws.map((d) => d.cardLabel) };

  res.json({
    // compare against the hash the player saw before playing — proves the
    // revealed seed is the committed one
    serverSeedHash: hashServerSeed(serverSeed),
    draws,
    derived,
  });
});

router.get("/seed", requireAuth, async (req, res) => {
  try {
    const seed = await ensureActiveSeed(req.userId);
    res.json({
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: seed.nonce,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/rotate", requireAuth, async (req, res) => {
  try {
    const oldSeed = await Seed.findOneAndUpdate(
      { userId: req.userId, active: true },
      { active: false, revealedAt: new Date() },
      { returnDocument: "after" }
    );

    const bodySeed = req.body?.clientSeed;
    const newClientSeed =
      typeof bodySeed === "string" && bodySeed.trim()
        ? bodySeed.trim().slice(0, 64)
        : crypto.randomBytes(8).toString("hex");

    const serverSeed = generateServerSeed();
    const newSeed = await Seed.create({
      userId: req.userId,
      serverSeed,
      serverSeedHash: hashServerSeed(serverSeed),
      clientSeed: newClientSeed,
    });

    res.json({
      revealed: oldSeed
        ? {
            serverSeed: oldSeed.serverSeed,
            serverSeedHash: oldSeed.serverSeedHash,
            clientSeed: oldSeed.clientSeed,
            lastNonce: oldSeed.nonce,
          }
        : null,
      next: {
        serverSeedHash: newSeed.serverSeedHash,
        clientSeed: newSeed.clientSeed,
        nonce: 0,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;