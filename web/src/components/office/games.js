// Display metadata for every game, in one place. Pages must never render raw
// gameType keys — a new game gets its entry here and every table, tab and
// audit row picks it up.
export const GAME_META = {
  hilo: { name: "Hi-Lo", family: "Climb" },
  blackjack: { name: "Blackjack", family: "Table" },
  war: { name: "War", family: "Table" },
  tower: { name: "Dragon Tower", family: "Climb" },
  mines: { name: "Mines", family: "Climb" },
  chicken: { name: "Chicken Cross", family: "Climb" },
  dice: { name: "Dice", family: "Instant" },
  limbo: { name: "Limbo", family: "Instant" },
  plinko: { name: "Plinko", family: "Instant" },
  keno: { name: "Keno", family: "Instant" },
  roulette: { name: "Roulette", family: "Table" },
  baccarat: { name: "Baccarat", family: "Table" },
  bonanza: { name: "Nova Bonanza", family: "Instant" },
  lander: { name: "Star Lander", family: "Instant" },
};

export const GAME_ORDER = Object.keys(GAME_META);

export function gameName(gameType) {
  return GAME_META[gameType]?.name ?? gameType;
}

// Sort helper: RTP-configurable games first (they're the ones people edit),
// then platform order.
export function sortGames(list, key = (x) => x) {
  const rank = (g) => (g.rtpConfigurable ? 0 : 1) * 100 + GAME_ORDER.indexOf(key(g));
  return [...list].sort((a, b) => rank(a) - rank(b));
}
