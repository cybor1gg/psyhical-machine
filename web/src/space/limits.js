// Bet limits, straight from the backoffice.
//
// Every screen used to carry `const MAX_BET = 500`, so changing a game's limit
// in the backoffice changed nothing on the machine — the server rejected the
// bet instead, which reads as a broken game rather than a lowered limit. The
// limits are now fetched once per session and shared.
import { useSyncExternalStore } from "react";
import { apiGet } from "../api";

const FALLBACK = { minBet: 50, maxBet: 500 };
let limits = null;          // gameType -> { minBet, maxBet, enabled }
let inflight = null;
const listeners = new Set();

function publish() { for (const fn of listeners) fn(); }

export function loadLimits() {
  if (limits || inflight) return inflight;
  inflight = apiGet("/api/cabinet/limits")
    .then(({ ok, data }) => { if (ok && data && data.limits) { limits = data.limits; publish(); } })
    .catch(() => { /* keep the fallback */ })
    .finally(() => { inflight = null; });
  return inflight;
}

// Re-read after the backoffice saves, without a reload.
export function refreshLimits() { limits = null; inflight = null; return loadLimits(); }

const snapshot = (gameType) => (limits && limits[gameType]) || FALLBACK;

/** The live limits for one game. Falls back to 50..500 until they arrive. */
export function useBetLimits(gameType) {
  loadLimits();
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => snapshot(gameType)
  );
}

/** Just the ceiling — the name the screens already use for it. */
export function useMaxBet(gameType) { return useBetLimits(gameType).maxBet; }
