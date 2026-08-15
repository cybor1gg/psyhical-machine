// The machine's credits, shared across the whole kiosk UI.
//
// Two numbers, on purpose:
//   truth — the server's balance (authoritative, may be held back)
//   shown — what the player sees
//
// A real machine deducts the stake the instant you press BET (that snap is
// what makes it feel responsive) but only pays the win when the reels/ball/
// cards finish. So:
//   • stakeCredits(amount) drops `shown` immediately, without waiting for any
//     round-trip — the press feels instant.
//   • holdBalance() keeps the server's settled balance from landing early
//     (it would spoil the outcome); releaseBalance() publishes it at the
//     moment the animation reveals the result, which is also what corrects
//     any optimistic guess (a rejected bet simply snaps back).
import { useSyncExternalStore } from "react";

let shown = null;   // what useBalance() returns — null = not known yet
let truth = null;   // newest server value
let holds = 0;      // >0 while a game is animating its reveal
let holdTimer = 0;  // safety net: never strand the readout
let peakHolds = 0;  // most rounds that were ever in flight at once
let reconcile = null; // set by api.js — reads the authoritative balance
const listeners = new Set();

const publish = () => { for (const fn of listeners) fn(); };

export function setBalance(next) {
  if (typeof next !== "number" || Number.isNaN(next)) return;
  truth = next;
  if (holds === 0) { shown = next; publish(); }
}

// Instant, optimistic stake deduction at the moment of the press. Always
// reconciled by the next release (or the next unheld server balance), so it
// can never drift: a refused bet snaps straight back.
export function stakeCredits(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || typeof shown !== "number") return;
  shown = Math.max(0, Math.round((shown - n) * 100) / 100);
  publish();
}

// The mirror of stakeCredits: pay a win into the readout at the exact moment
// its own animation lands. Multi-ball games (plinko) need this — each ball
// must pay as IT lands, not all together when the last one settles. The next
// release still reconciles `shown` to the server's truth.
export function creditCredits(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || typeof shown !== "number") return;
  shown = Math.round((shown + n) * 100) / 100;
  publish();
}

// Registered once by api.js. Used only when rounds overlapped and the
// server's per-round balance figures cannot be trusted (see settle).
export function setBalanceReconciler(fn) { reconcile = fn; }

export function holdBalance() {
  holds++;
  if (holds > peakHolds) peakHolds = holds;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { holds = 0; settle(); }, 20000);
}

// A game reports `balance` per ROUND, and for instant games that figure is a
// projection: the post-debit balance plus that round's payout, computed
// before the credit has landed. With one round at a time it is exact. With
// several overlapping — plinko's whole point is a sky full of balls — each
// response projects from its own debit and is blind to the others, so they
// disagree and whichever lands last would win. That is how a ball could pay
// out and the credits still drop.
//
// So when rounds overlapped, we do NOT settle onto that number. `shown` is
// already the honest running total (every stake taken on the press, every win
// paid as its own ball landed); we keep it and ask the server for the real
// figure, which arrives through setBalance a moment later.
function settle() {
  const overlapped = peakHolds > 1;
  peakHolds = 0;
  if (overlapped && reconcile) { reconcile(); return; }
  if (typeof truth === "number" && truth !== shown) { shown = truth; publish(); }
}

// A long feature outlives the 20s watchdog; a replay that is still running
// re-arms it without stacking another hold, so the balance stays frozen
// until the LAST free spin has settled.
export function refreshHold() {
  if (holds > 0) {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { holds = 0; settle(); }, 20000);
  }
}

export function releaseBalance() {
  if (holds > 0) holds--;
  if (holds === 0) { clearTimeout(holdTimer); settle(); }
}

// The server's last reported figure. Only meaningful when nothing is in
// flight — see settle() for why it cannot be trusted mid-flight.
export function getBalance() {
  return typeof truth === "number" ? truth : shown;
}

// What the player can actually commit right now. `shown` has every stake
// already taken out and only counts wins that have really landed, so it is
// never higher than the money available — which is exactly what an
// affordability check wants. The server's atomic debit is still the last word.
export function getSpendable() {
  return typeof shown === "number" ? shown : truth;
}

export function useBalance() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => shown
  );
}
