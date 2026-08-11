// The machine's credits, shared across the whole kiosk UI. api.js feeds it:
// every API response that carries a numeric `balance` (bets, wins, cashouts,
// cash-in, the boot handshake) updates the store, so the bottom bar is always
// current without touching any game component.
import { useSyncExternalStore } from "react";

let balance = null; // null = not known yet
const listeners = new Set();

export function setBalance(next) {
  if (typeof next !== "number" || Number.isNaN(next)) return;
  balance = next;
  for (const fn of listeners) fn();
}

export function getBalance() {
  return balance;
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
