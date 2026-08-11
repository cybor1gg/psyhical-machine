// Development stand-in for the bill validator. Toggled with F9 (and a small
// floating chip in dev builds); each denomination button behaves exactly like
// the future hardware driver: one accepted note → POST /api/cabinet/cash-in.
//
// Success broadcasts a `cabinet:cash-in` CustomEvent (detail: { balance,
// amount }) so any screen showing credits can update without polling — the
// real validator service will feed the same event through the same endpoint.
import { useState, useEffect } from "react";
import { apiGet, apiPost } from "../api";

const NOTES = [1, 5, 10, 20, 50, 100];

export default function CashSimulator() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null); // { amount, balance } | { error }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "F9") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function insert(amount) {
    if (busy) return;
    setBusy(true);
    const { ok, data } = await apiPost("/api/cabinet/cash-in", { amount });
    setBusy(false);
    if (!ok) return setLast({ error: data?.error || "Rejected" });
    setLast({ amount, balance: data.balance });
    window.dispatchEvent(new CustomEvent("cabinet:cash-in", { detail: { amount, balance: data.balance } }));
  }

  return (
    <>
      {import.meta.env.DEV && !open && (
        <button onClick={() => setOpen(true)} title="Cash simulator (F9)" style={{
          position: "fixed", bottom: 62, right: 10, zIndex: 90, height: 34, padding: "0 12px",
          borderRadius: 999, border: "1px dashed var(--border)", background: "rgba(5,9,15,0.7)",
          color: "var(--text-muted)", fontSize: 11, fontWeight: 700, cursor: "pointer",
          fontFamily: "var(--font-display)", letterSpacing: "0.06em",
        }}>
          DEV · CASH
        </button>
      )}

      {open && (
        <div style={{
          position: "fixed", bottom: 62, right: 10, zIndex: 91, width: 252, padding: 14,
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14,
          boxShadow: "0 18px 44px rgba(0,0,0,0.55)", fontFamily: "var(--font-body)", color: "var(--text)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 12.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Bill validator (sim)
            </span>
            <button onClick={() => setOpen(false)} style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 14 }}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {NOTES.map((n) => (
              <button key={n} disabled={busy} onClick={() => insert(n)} style={{
                height: 48, borderRadius: 10, cursor: "pointer", border: "1px solid var(--border)",
                background: "var(--surface-raised)", color: "var(--text)",
                fontFamily: "var(--font-numeric)", fontWeight: 800, fontSize: 15,
                opacity: busy ? 0.6 : 1,
              }}>
                ${n}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 10, minHeight: 18, fontSize: 12, color: last?.error ? "var(--loss)" : "var(--text-muted)" }}>
            {last?.error
              ? last.error
              : last
                ? `Accepted $${last.amount} — credits $${last.balance.toFixed(2)}`
                : "Insert a note. Toggle with F9."}
          </div>
        </div>
      )}
    </>
  );
}
