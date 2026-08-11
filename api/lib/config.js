import GameConfig from "../models/GameConfig.js";

const DEFAULTS = {
  hilo: { houseEdge: 0.01, minBet: 1, maxBet: 500, enabled: true },
  // Blackjack's and War's edges come from the RULES (who acts when, what ties
  // pay), not from a multiplier formula — houseEdge here is informational and
  // no payout math reads it. War ≈ 2.96% main bet (going to war), tie side
  // bet 10:1 ≈ 15.4%.
  blackjack: { houseEdge: 0, minBet: 1, maxBet: 500, enabled: true },
  war: { houseEdge: 0, minBet: 1, maxBet: 500, enabled: true },
  // Dragon Tower is formula-priced like hilo: every row's multiplier is
  // (1 − edge) / P(safe), so its RTP is a real dial.
  tower: { houseEdge: 0.01, minBet: 1, maxBet: 500, enabled: true },
  // Sprint-1 instant/climb games — all formula-priced: payout multiplier is
  // (1 − edge) / winChance, so RTP is a real dial on each.
  dice: { houseEdge: 0.01, minBet: 1, maxBet: 500, enabled: true },
  limbo: { houseEdge: 0.01, minBet: 1, maxBet: 500, enabled: true },
  mines: { houseEdge: 0.01, minBet: 1, maxBet: 500, enabled: true },
  // Sprint-2 instant games — payout tables exact-EV scaled to (1 − edge).
  plinko: { houseEdge: 0.01, minBet: 1, maxBet: 500, enabled: true },
  keno: { houseEdge: 0.01, minBet: 1, maxBet: 500, enabled: true },
  // Sprint-3 rules-priced games — edge is the rules, not a formula.
  // Roulette: the single green zero → exactly 2.70% on every bet.
  // Baccarat: the drawing tableau + 5% banker commission (banker ≈ 1.06%).
  roulette: { houseEdge: 0, minBet: 1, maxBet: 500, enabled: true },
  baccarat: { houseEdge: 0, minBet: 1, maxBet: 500, enabled: true },
  // Chicken Cross is formula-priced like tower: every crossed lane multiplies
  // by (1 − edge) / P(safe), so its RTP is a real dial.
  chicken: { houseEdge: 0.01, minBet: 1, maxBet: 500, enabled: true },
};

// Every game the platform knows — used for validation and to make sure config
// docs exist for the backoffice.
export const KNOWN_GAMES = Object.keys(DEFAULTS);

// Games whose RTP is a formula parameter (tunable within the platform
// window). Everything else earns its edge from the rules and is published
// as fixed.
export const RTP_CONFIGURABLE = ["hilo", "tower", "dice", "limbo", "mines", "plinko", "keno", "chicken"];

// Config is read on EVERY game action but only changes through the backoffice,
// so a short in-memory TTL takes the DB round-trips off the hot path.
const cache = new Map(); // gameType -> { value, at }
const TTL_MS = 5000;

function cacheGet(key) {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < TTL_MS ? hit.value : null;
}

export async function getGameConfig(gameType) {
  const key = gameType;
  const hit = cacheGet(key);
  if (hit) return hit;

  let config = await GameConfig.findOne({ gameType });
  if (!config && DEFAULTS[gameType]) {
    try {
      config = await GameConfig.create({ gameType, ...DEFAULTS[gameType] });
    } catch (err) {
      // Two concurrent first reads race the create; the loser hits the unique
      // index (E11000) — the winner's doc is the answer either way.
      if (err?.code !== 11000) throw err;
      config = await GameConfig.findOne({ gameType });
    }
  }

  cache.set(key, { value: config, at: Date.now() });
  return config;
}

// The config a round actually plays under. Kept as a named alias of
// getGameConfig so the game routes read the same as the online project
// they were derived from.
export async function getEffectiveGameConfig(gameType) {
  return getGameConfig(gameType);
}

export function invalidateGameConfig(gameType) {
  cache.delete(gameType);
}
