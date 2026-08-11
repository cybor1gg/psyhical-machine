// The kiosk boot gate. Before any route renders, the machine authenticates
// itself with the cabinet API using the identity file deployed next to the
// frontend (public/cabinet.config.json). Players never see a login screen —
// the machine IS the session.
//
// Staff surfaces (/admin, /login, /verify) bypass the gate: they run on the
// admin's own email/password session, and the cabinet Bearer token is
// cleared so it can't shadow the admin cookie.
import { useState, useEffect } from "react";
import { apiPost, setSessionToken } from "../api";
import { setBrandName } from "../lib/brand";

const STAFF_PATH = /^\/(admin|login|verify)/;

function Screen({ children }) {
  return (
    <div style={{
      height: "100dvh", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 18, background: "var(--ink)", color: "var(--text)",
      fontFamily: "var(--font-body)", textAlign: "center", padding: 24,
    }}>
      {children}
    </div>
  );
}

export default function CabinetGate({ children }) {
  const staff = STAFF_PATH.test(window.location.pathname);
  const [state, setState] = useState(staff ? { phase: "ready" } : { phase: "booting" });

  useEffect(() => {
    if (staff) {
      // Never let a lingering machine token impersonate the cabinet on
      // staff pages — the admin cookie is the identity there.
      setSessionToken(null);
      return;
    }
    boot();
  }, []);

  async function boot() {
    setState({ phase: "booting" });
    try {
      const res = await fetch("/cabinet.config.json", { cache: "no-store" });
      if (!res.ok) throw new Error("cabinet.config.json missing");
      const cfg = await res.json();

      const { ok, data } = await apiPost("/api/cabinet/session", {
        cabinetId: cfg.cabinetId,
        machineKey: cfg.machineKey,
      });
      if (!ok) throw new Error(data?.error || "Cabinet session refused");

      setSessionToken(data.sessionToken);
      // The in-game brand mark (card backs, bottom bar) shows the machine
      // identity — useful on the floor and in photos of problem screens.
      setBrandName(data.cabinetId);
      setState({ phase: "ready" });
    } catch (err) {
      setState({ phase: "error", message: err.message });
    }
  }

  if (state.phase === "ready") return children;

  if (state.phase === "error") {
    return (
      <Screen>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22 }}>
          Machine unavailable
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 14, maxWidth: 420 }}>
          {state.message}
        </div>
        <button onClick={boot} style={{
          marginTop: 6, height: 48, padding: "0 26px", borderRadius: 10, cursor: "pointer",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15,
          background: "var(--mint)", color: "var(--text-on-accent)", border: "none",
        }}>
          Retry
        </button>
      </Screen>
    );
  }

  return (
    <Screen>
      <div style={{ fontFamily: "'Unbounded', var(--font-display)", fontWeight: 800, fontSize: 26, letterSpacing: "0.06em" }}>
        MTECH
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Starting machine…</div>
    </Screen>
  );
}
