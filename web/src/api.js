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
import { setBalance } from "./lib/balanceStore";

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

export async function apiPost(path, body) {
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