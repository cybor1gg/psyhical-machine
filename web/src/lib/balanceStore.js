// The machine's credits, shared across the whole kiosk UI. api.js feeds it:
// every API response that carries a numeric `balance` (bets, wins, cashouts,
// cash-in, the boot handshake) updates the store, so the bottom bar is always
// current without touching any game component.
//
// SUSPENSE: the server answers long before a game's animation finishes, so a
// raw feed would spoil the outcome — the credits would jump while the ball is
// still bouncing. A game calls holdBalance() before its request and
// releaseBalance() at the moment its animation reveals the result; updates
// that land in between are staged and published on release (latest wins).
import { useSyncExternalStore } from "react";

let balance = null; // null = not known yet
let holds = 0;      // >0 while a game is animating its reveal
let staged = null;  // newest balance received while held
let holdTimer = 0;  // safety net: never strand a hold forever
const listeners = new Set();

function publish() {
  for (const fn of listeners) fn();
}

export function setBalance(next) {
  if (typeof next !== "number" || Number.isNaN(next)) return;
  if (holds > 0) { staged = next; return; }
  balance = next;
  publish();
}

// Freeze the readout until the reveal lands. Always pair with
// releaseBalance(); the 20s watchdog only exists so a crashed animation can
// never leave the credits stale.
export function holdBalance() {
  holds++;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { holds = 0; flush(); }, 20000);
}

function flush() {
  if (staged != null) { balance = staged; staged = null; publish(); }
}

export function releaseBalance() {
  if (holds > 0) holds--;
  if (holds === 0) { clearTimeout(holdTimer); flush(); }
}

export function getBalance() {
  // the truth including anything staged — game logic (max-bet caps,
  // "can I afford this") must see real credits even mid-animation
  return staged != null ? staged : balance;
}

export function useBalance() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => balance
  );
}
