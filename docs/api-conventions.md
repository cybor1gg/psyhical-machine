# Game API Conventions

Internal engineering rules. Every new game follows these so the API stays
predictable for us and for integrators. Deviations need a written reason.

## Route shape

All game endpoints live under `POST/GET /api/games/{game}/{verb}`, player
cookie auth, JSON in and out.

Every game implements the **lifecycle trio**:

| Verb | Method | Purpose |
|---|---|---|
| `start` | POST | Begin a round. Takes `betAmount` plus game options. Debits the stake(s). |
| `active` | GET | Refresh-resume. Returns the full resumable state, never hidden information. |
| *(settle verbs)* | POST | Game-specific, see families below. |

## Game families

**Climb family** (hilo, tower, mines; future: chicken): a sequence of survival
steps with a compounding multiplier and voluntary exit. Exact shared surface:

- `POST /{game}/start` `{ betAmount, ...options }`
- `POST /{game}/guess` `{ ...choice }` — advance one step
- `POST /{game}/cashout` — settle voluntarily (requires ≥ 1 winning step)
- `GET /{game}/active`

Game-specific extras are allowed on top (hilo has `skip` and `table`), but the
four core verbs never change names.

**Table family** (blackjack, war): casino games with real vocabulary. The
lifecycle trio applies, and the action verbs use the game's own standard terms
(`hit`, `stand`, `double`, `split`, `insurance`; `war`, `surrender`). Renaming
`hit` to `guess` would make the API harder to remember, not easier.

**Instant family** (dice, limbo, plinko, keno, roulette, baccarat): the whole
round is one decision, so `start` debits, draws, settles and credits in a
single response (it returns the full settlement envelope). There are no step
verbs, and `active` always answers `{ active: false }` — the lifecycle trio
still holds, which keeps integrators' resume logic uniform across families.
Roulette and baccarat take a `bets` array (many simultaneous stakes) instead
of a single `betAmount`; the envelope is otherwise identical.

## Response envelopes

- `start` always returns: `roundId`, `balance`, `totalStaked`, plus game state.
- Any response that settles a round always includes:
  `status: "cashed_out" | "lost"`, `payout`, `totalStaked`, `balance`.
- Climb-family step responses include: `won`, `multiplier`, `potentialPayout`.
- `active` always returns `{ active: boolean }` plus, when active, `betAmount`
  and everything needed to re-render the round.
- Errors are `{ error: string }` with 400 (bad input), 403 (disabled), 404
  (nothing to act on), 409 (concurrency: duplicate action or already settled).

## Money rules (non-negotiable)

- Round status is claimed atomically exactly once (`active → cashed_out|lost`);
  credits happen only after a successful claim.
- Every settled round records `staked` = total wagered including doubles,
  splits, raises and side bets. All GGR math reads `staked`, never `betAmount`.
- Money values are truncated (never rounded up) via `lib/money.js`.
- A failed debit leaves the round nonexistent; a post-debit crash triggers an
  automatic rollback.

## Fairness rules (non-negotiable)

- Every random draw consumes a nonce from the player's seed chain via the
  helpers in `lib/fair.js`. Nothing random happens outside the chain.
- Each game publishes its draw order (documented in the Fairness page and the
  operator guide) and it never changes after launch.
- Hidden information (hole cards, unclimbed rows) is committed at bet time,
  stored server-side, stripped from every live response, and revealed in full
  at settlement.

## Responsive UX rules (non-negotiable — every game ships against this list)

Games run inside operator iframes, so the viewport is whatever the casino
gives us. Every game must pass this checklist BEFORE it ships, verified at
402×600 (phone Safari inside the casino shell) and 987×636 + 987×500
(laptop iframes):

- **Phone (≤760px)**: viewport-locked — root is `height: useStableViewportHeight()`
  with `overflow: hidden` (mint/FitBox.jsx; the hook clamps to the device
  screen so oversized operator iframes can't push controls below the fold).
  Topbar and controls sheet are pinned; the board sits in a `flex: "1 1 auto",
  minHeight: 0` canvas wrapped in `<FitBox>`, which scales it down to fit.
  NOTHING scrolls and dealing/reveals never change any element's size. The
  Bet/Cashout button sits ABOVE the amount field (tap-repeat betting).
  Controls use the `small` variants (44px action button, 40px inputs). The
  sheet carries `maxHeight: "60%", overflowY: "auto"` as a last-resort valve.
- **Laptop/desktop**: the canvas must contain everything at every height ≥
  500px. Fixed-size content (cards, boards) derives its size from the
  MEASURED canvas (`useCanvasHeight`) instead of hard-coded dimensions —
  scale the content, never clip it. No page scroll on desktop.
- Result banners/plates render inside the canvas, never over the controls.

## Config rules

- New games register in `DEFAULTS` in `lib/config.js`; `KNOWN_GAMES` picks
  them up everywhere (operator sessions, backoffice, partner portal).
- Formula-priced games join `RTP_CONFIGURABLE` and read
  `getEffectiveGameConfig(game, operatorId)`. Rules-priced games keep
  `houseEdge` informational and document their RTP instead.
- Tall-multiplier games respect `maxWinMultiplier` from GameConfig.
