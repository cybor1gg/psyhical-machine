// Balance bridge to the operator page hosting the embed iframe.
//
// The embedded games show no wallet of their own — the operator's casino
// chrome does. Without a signal from us it can only poll, so its number
// jumps at arbitrary times (often spoiling a result mid-animation). Games
// report at the two moments that matter: the bet click, and the instant the
// presentation settles (the ball seats, the die stops, the banner lands).
//
// Target origin is '*': the embed can't know the operator's origin at
// runtime, and the balance is the player's own number, already on screen.
let seqCounter = 0;
let lastReportedSeq = 0;
let lastKnown = null; // last absolute balance we have been told by the server

function send(payload) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "MTECH_BALANCE", ...payload }, "*");
    }
  } catch {
    /* no reachable parent — standalone page, nothing to tell */
  }
}

/**
 * Claim a sequence number the moment a round RESPONSE arrives — arrival
 * order is ledger-commit order. A game with overlapping rounds (plinko
 * pour) tags each pending report with its seq so a ball that lands out of
 * order can never step the operator wallet backwards onto a stale balance.
 */
export function nextBalanceSeq() {
  return ++seqCounter;
}

/**
 * Seed the absolute balance we start from, when the host tells us one at
 * launch. Seamless-wallet operators return null here (their wallet is the
 * source of truth and exposes no balance to the embed), which is exactly
 * why the stake message below carries a delta instead of relying on this.
 */
export function seedBalance(balance) {
  if (typeof balance === "number" && Number.isFinite(balance)) lastKnown = balance;
}

// Every message carries a `kind` so the operator page can tell them apart:
//   kind: "settled" — server-truth balance from a settled round, sent when
//                     the animation finishes. Authoritative.
//   kind: "stake"   — sent at the bet click. Carries `stake` (the amount
//                     leaving the wallet) and, when we know one, the
//                     resulting `balance`. Marks "a round is in flight".
// Messages from embeds older than this field carry no `kind` — hosts should
// treat those as "settled" (the historical behavior).
export function reportBalance(balance, seq = null, kind = "settled") {
  if (typeof balance !== "number" || !Number.isFinite(balance)) return;
  if (seq != null) {
    if (seq < lastReportedSeq) return; // a newer ledger state already shown
    lastReportedSeq = seq;
  }
  lastKnown = balance;
  send({ balance, kind });
}

/**
 * Fired at the bet CLICK: tells the host the stake is leaving the wallet
 * right now, and marks the round in flight so it can mute its own balance
 * sources until the matching "settled" arrives.
 *
 * ALWAYS sends, even before we know an absolute balance. `stake` is the
 * delta — the host runs the wallet, so it can always apply a deduction,
 * whereas we may not learn an absolute number until the first round
 * answers. This matters most in a plinko pour, where every ball after the
 * first is bet before any balance has come back: gating on a known balance
 * meant a burst of taps produced no bet feedback at all.
 */
export function reportStakeDebit(stake) {
  if (typeof stake !== "number" || !Number.isFinite(stake) || stake <= 0) return;
  if (lastKnown != null) lastKnown = Math.max(0, +(lastKnown - stake).toFixed(2));
  send({ balance: lastKnown, stake, kind: "stake" });
}

/**
 * Closes a round whose outcome moved no money (a bust, or a losing hand
 * whose API response carries no balance). Always sends, so a host that
 * muted on the "stake" message always gets its release — `balance` may be
 * null, meaning "no new number; the round is simply over".
 */
export function reportRoundEnd(balance = null) {
  const b = typeof balance === "number" && Number.isFinite(balance) ? balance : lastKnown;
  if (b != null) lastKnown = b;
  send({ balance: b, kind: "settled" });
}
