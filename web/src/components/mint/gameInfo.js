// Per-game info shown in the header (i) popover — explanation, settings, RTP
// and max win. Content follows the design system's GAME_INFO, with numbers
// corrected to THIS platform's engines (api/lib/games/*.js). RTP for
// formula-priced games is the platform default; the popover adds a note that
// the casino sets the live value.
export const GAME_INFO = {
  hilo: {
    title: "Hi-Lo",
    how: "A card is drawn. Guess whether the next card is higher or lower. Your multiplier grows with every correct call. Cash out anytime; one wrong guess ends the round.",
    settings: "Skip deals a fresh card without ending the round. Ace is low, King is high.",
    rtp: "99%", rtpConfigurable: true, maxWin: "10,000× cap",
  },
  blackjack: {
    title: "Blackjack",
    how: "Beat the dealer without going over 21. Hit to draw, Stand to hold, Double to draw one card at twice the stake, or Split a matching pair. Dealer draws to 17. A natural blackjack pays 3:2.",
    settings: "Insurance is offered on a dealer ace. Re-split up to 4 hands (split aces get one card), double on any two cards.",
    rtp: "≈ 99.5%", rtpConfigurable: false, maxWin: "3:2 blackjack",
  },
  war: {
    title: "War",
    how: "You and the dealer each draw one card. The higher card wins even money. On a tie you can surrender for half your bet or go to War, doubling your stake for a single high-stakes showdown.",
    settings: "Optional Tie side bet pays 10:1, with streak ladders above it.",
    rtp: "≈ 97%", rtpConfigurable: false, maxWin: "11× tie bet",
  },
  tower: {
    title: "Dragon Tower",
    how: "Pick a tile on each row to climb the tower. Eggs climb, dragons end the round. Every row multiplies your payout. Cash out any time after the first climb.",
    settings: "Five difficulties, from Easy (one dragon per row) to Master (one safe tile per row).",
    rtp: "99%", rtpConfigurable: true, maxWin: "10,000× cap",
  },
  dice: {
    title: "Dice",
    how: "Pick a target and bet Over or Under. Moving the slider trades win chance for multiplier: lower chance pays more. Roll for an instant result.",
    settings: "Type an exact target, multiplier or win chance. They stay in sync.",
    rtp: "99%", rtpConfigurable: true, maxWin: "≈ 49.5×",
  },
  limbo: {
    title: "Limbo",
    how: "Set a target multiplier and roll. If the random result lands at or above your target, you win the target multiplier. Higher targets pay more but win less often.",
    settings: "Any target from 1.01× upward; payouts cap at 10,000×.",
    rtp: "99%", rtpConfigurable: true, maxWin: "10,000×",
  },
  mines: {
    title: "Mines",
    how: "Reveal tiles one by one. Each gem raises your multiplier. Hit a mine and the round ends. More mines means higher risk and bigger payouts. Cash out anytime.",
    settings: "Grids from 5×5 up to 8×8; 1 to N−1 mines on an N-tile grid.",
    rtp: "99%", rtpConfigurable: true, maxWin: "10,000× cap",
  },
  chicken: {
    title: "Chicken Cross",
    how: "Guide the chicken across the road one lane at a time. Every lane you clear compounds your multiplier; a car ends the round. Cash out any time after the first lane — cross every lane and you're paid automatically.",
    settings: "Four difficulties, from Easy (24 lanes, 5% deadly) to Daredevil (13 lanes, 45% deadly). Some lanes leak gas — watch the manholes.",
    rtp: "99%", rtpConfigurable: true, maxWin: "10,000× cap",
  },
  plinko: {
    title: "Plinko",
    how: "Drop a ball through the pins. It bounces left or right into a multiplier slot at the bottom. More rows and higher risk push the edge payouts up and the centre down.",
    settings: "8–16 rows and Low / Medium / High risk. Pour as many balls as your balance allows.",
    rtp: "99%", rtpConfigurable: true, maxWin: "1,000×",
  },
  keno: {
    title: "Keno",
    how: "Pick up to 10 numbers, then 10 are drawn. The more of your picks that hit, the more you win. The table shows the live payout for every hit count.",
    settings: "Pick 1–10 numbers from 40.",
    rtp: "99%", rtpConfigurable: true, maxWin: "1,000×",
  },
  roulette: {
    title: "Roulette",
    how: "Place chips on numbers, colours, dozens or columns, then spin. The ball lands on one of 37 European pockets. Straight numbers pay 35:1, even-money bets pay 1:1.",
    settings: "Chips from $0.10 to $5K; splits and corners are placeable on the table lines.",
    rtp: "97.30%", rtpConfigurable: false, maxWin: "36×",
  },
  baccarat: {
    title: "Baccarat",
    how: "Bet on Player, Banker or Tie. Both hands draw to baccarat rules. The one closest to 9 wins. Player pays 1:1, Banker pays 0.95:1, Tie pays 8:1.",
    settings: "Bet any mix of Player, Tie and Banker in one coup.",
    rtp: "≈ 98.9%", rtpConfigurable: false, maxWin: "9× tie",
  },
};
