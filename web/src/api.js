// Production builds default to same-origin relative requests (the frontend
// is served next to the API); dev defaults to the local API port. Set
// VITE_API_URL only to override — e.g. if the API ever moves to its own domain.
const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:5001" : "");

// Embedded game sessions can't rely on the session cookie: mobile browsers
// refuse cookies in cross-site iframes (Safari ITP). The embed exchange hands
// the session back in the body; it lives here (plus partitioned
// sessionStorage, so an in-iframe refresh survives) and rides along as an
// Authorization header. Storage access can throw in strict privacy modes —
// then the session is memory-only, which still covers the whole game session.
import { setBalance, stakeCredits, setBalanceReconciler } from "./lib/balanceStore";

const TOKEN_KEY = "mtb_session";
let sessionToken = null;
try { sessionToken = window.sessionStorage.getItem(TOKEN_KEY); } catch { /* memory-only */ }

export function setSessionToken(token) {
  sessionToken = token || null;
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* memory-only */ }
}

function authHeaders(extra = {}) {
  return sessionToken ? { ...extra, Authorization: `Bearer ${sessionToken}` } : extra;
}

export async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({ error: "Server error" }));
  // Any successful response that carries the wallet keeps the kiosk's
  // bottom-bar credits current — bets, wins, cashouts, cash-in, boot.
  if (res.ok && data && typeof data.balance === "number") setBalance(data.balance);
  return { ok: res.ok, status: res.status, data };
}

// A bet leaves the credits the INSTANT it is pressed — the stake in the
// request body is deducted locally before the round-trip, so the readout
// snaps like a real machine instead of waiting on the network. The server's
// balance always reconciles it (a refused bet snaps straight back).
function stakeOf(path, body) {
  if (!body || typeof body !== "object" || !/^\/api\/games\//.test(path)) return 0;
  if (typeof body.betAmount === "number") return body.betAmount;
  if (Array.isArray(body.bets)) {
    return body.bets.reduce((s, b) => s + (Number(b?.stake) || 0), 0);
  }
  return 0;
}

// `opts.stake` declares a charge the body doesn't carry (blackjack double /
// split, war's raise) so those presses deduct instantly too.
export async function apiPost(path, body, opts) {
  const stake = Number(opts?.stake) > 0 ? Number(opts.stake) : stakeOf(path, body);
  if (stake > 0) stakeCredits(stake);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({ error: "Server error" }));
  // Any successful response that carries the wallet keeps the kiosk's
  // bottom-bar credits current — bets, wins, cashouts, cash-in, boot.
  if (res.ok && data && typeof data.balance === "number") setBalance(data.balance);
  return { ok: res.ok, status: res.status, data };
}

export async function apiPut(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({ error: "Server error" }));
  // Any successful response that carries the wallet keeps the kiosk's
  // bottom-bar credits current — bets, wins, cashouts, cash-in, boot.
  if (res.ok && data && typeof data.balance === "number") setBalance(data.balance);
  return { ok: res.ok, status: res.status, data };
}

// When several rounds overlapped, the per-round balances in their responses
// are projections that disagree with each other, so the store asks for the
// real figure instead of settling onto one of them. apiGet feeds it back in
// through setBalance.
setBalanceReconciler(() => { apiGet("/api/cabinet/state").catch(() => {}); });
