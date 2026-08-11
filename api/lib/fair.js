import crypto from "crypto";
import Seed from "../models/Seed.js";

export function generateServerSeed() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashServerSeed(serverSeed) {
  return crypto.createHash("sha256").update(serverSeed).digest("hex");
}

export async function ensureActiveSeed(userId) {
  let seed = await Seed.findOne({ userId, active: true });

  if (!seed) {
    const serverSeed = generateServerSeed();
    seed = await Seed.create({
      userId,
      serverSeed,
      serverSeedHash: hashServerSeed(serverSeed),
      clientSeed: crypto.randomBytes(8).toString("hex"),
    });
  }

  return seed;
}

export function rollNumber(serverSeed, clientSeed, nonce) {
  const hmac = crypto
    .createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest("hex");

  const slice = hmac.slice(0, 8);
  const int = parseInt(slice, 16);

  return int / 0x100000000; // float in [0, 1)
}

export function drawCard(serverSeed, clientSeed, nonce) {
  return Math.floor(rollNumber(serverSeed, clientSeed, nonce) * 52);
}

// ── nonce claiming (shared by all games) ─────────────────────────────────
// Every draw consumes a nonce via an atomic $inc, so two concurrent requests
// can never produce the same card. These helpers are the ONLY place nonces
// are claimed — games never touch seed.nonce directly.

// Claim one nonce on a known seed and draw its card.
export async function drawNext(seedId) {
  const seed = await Seed.findOneAndUpdate(
    { _id: seedId },
    { $inc: { nonce: 1 } },
    { returnDocument: "after" }
  );
  const usedNonce = seed.nonce - 1;
  return { index: drawCard(seed.serverSeed, seed.clientSeed, usedNonce), nonce: usedNonce, seedId: seed._id };
}

// Claim one nonce, locating the user's active seed in the same query
// (one round-trip). Null when the user has no active seed yet.
export async function drawNextForUser(userId) {
  const seed = await Seed.findOneAndUpdate(
    { userId, active: true },
    { $inc: { nonce: 1 } },
    { returnDocument: "after" }
  );
  if (!seed) return null;
  const usedNonce = seed.nonce - 1;
  return { index: drawCard(seed.serverSeed, seed.clientSeed, usedNonce), nonce: usedNonce, seedId: seed._id };
}

// Claim COUNT consecutive nonces in ONE atomic query and draw them all —
// blackjack's opening deal takes 4 cards for the cost of a single round-trip.
// Returns cards in nonce order; the caller assigns them by the published
// draw-order convention.
export async function drawMany(seedId, count) {
  const seed = await Seed.findOneAndUpdate(
    { _id: seedId },
    { $inc: { nonce: count } },
    { returnDocument: "after" }
  );
  const first = seed.nonce - count;
  return Array.from({ length: count }, (_, k) => ({
    index: drawCard(seed.serverSeed, seed.clientSeed, first + k),
    nonce: first + k,
    seedId: seed._id,
  }));
}

// Same atomic claim, but returning the RAW floats — for games whose outcome
// isn't a card (dice, limbo, mines, plinko…). One roll per nonce, in order.
export async function rollMany(seedId, count) {
  const seed = await Seed.findOneAndUpdate(
    { _id: seedId },
    { $inc: { nonce: count } },
    { returnDocument: "after" }
  );
  const first = seed.nonce - count;
  return Array.from({ length: count }, (_, k) => ({
    roll: rollNumber(seed.serverSeed, seed.clientSeed, first + k),
    nonce: first + k,
    seedId: seed._id,
  }));
}

