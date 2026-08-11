// Why each rules-priced game's RTP is not a dial — the ONE place this copy
// lives. Every backoffice surface (platform settings, operator detail,
// partner portal) renders from here, so a new rules-priced game gets one
// entry and no surface can drift. Numbers match the engine docs in
// api/lib/games/*.js.
//
// Which games are rules-priced is decided by the API (`rtpConfigurable` on
// every config payload, from RTP_CONFIGURABLE in api/lib/config.js) — the
// frontend must never keep its own list.

// Long form — the platform-settings and partner-settings cards.
export const RULES_PRICED_LONG = {
  blackjack: (
    <>Blackjack's RTP comes from the table rules (dealer stands on 17,
      blackjack pays 3:2, double any two, one split): roughly <b>99.5%</b> with
      basic strategy. There is no manual house-edge knob; changing the RTP
      would mean changing the rules themselves.</>
  ),
  war: (
    <>War's RTP comes from the tie rules (war risks 2 to win 1, surrender
      forfeits half): about <b>97%</b> going to war; the tie side bet pays
      10:1 (~<b>84.6%</b> RTP). No manual house-edge knob; the rules are the RTP.</>
  ),
  roulette: (
    <>Roulette's RTP comes from the single green zero. Every bet type pays
      true odds minus the zero, so the edge is exactly 1/37 ≈ 2.70% and the RTP
      is <b>97.30%</b> on every bet. No manual house-edge knob; the wheel is the RTP.</>
  ),
  baccarat: (
    <>Baccarat's RTP comes from the fixed drawing tableau and the 5% banker
      commission: <b>98.94%</b> on Banker, <b>98.76%</b> on Player, and the Tie
      bet pays 8:1 (~<b>85.6%</b> RTP). No manual house-edge knob; the tableau is the RTP.</>
  ),
};

// Short form — the per-game row in the operator-detail RTP panel.
export const RULES_PRICED_SHORT = {
  blackjack: "Rules-based (~99.5% with basic strategy), not a configurable number.",
  war: "Rules-based (~97% going to war; tie side bet ~84.6%), not a configurable number.",
  roulette: "Rules-based (single zero, 97.30% on every bet), not a configurable number.",
  baccarat: "Rules-based (tableau + 5% commission: Banker 98.94%, Player 98.76%), not a configurable number.",
};

const FALLBACK_LONG = (
  <>This game's RTP comes from its rules, not a formula; there is no manual
    house-edge knob.</>
);
const FALLBACK_SHORT = "Rules-based, not a configurable number.";

export function rulesPricedLong(gameType) {
  return RULES_PRICED_LONG[gameType] ?? FALLBACK_LONG;
}
export function rulesPricedShort(gameType) {
  return RULES_PRICED_SHORT[gameType] ?? FALLBACK_SHORT;
}
