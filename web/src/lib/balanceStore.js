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

export function holdBalance() {
  holds++;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { holds = 0; settle(); }, 20000);
}

function settle() {
  if (typeof truth === "number" && truth !== shown) { shown = truth; publish(); }
}

export function releaseBalance() {
  if (holds > 0) holds--;
  if (holds === 0) { clearTimeout(holdTimer); settle(); }
}

// Real money — bet caps and affordability checks must never read the
// optimistic display value.
export function getBalance() {
  return typeof truth === "number" ? truth : shown;
}

export function useBalance() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => shown
  );
}
