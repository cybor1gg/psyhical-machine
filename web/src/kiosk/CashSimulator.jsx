// INSERT CASH — the money-in panel.
//
// On a real cabinet the bill validator drives this: a note is accepted and the
// driver POSTs /api/cabinet/cash-in. Until that hardware exists (and for
// testing on any machine) the same endpoint is reachable from the screen, so
// a touch cabinet with no keyboard can still be loaded with credits.
//
// Opened by: the INSERT CASH button on the menu, the floating ⌗ button in a
// game, the `cabinet:open-cash` event, or F9 on a desk keyboard.
import { useState, useEffect } from "react";
import { apiPost } from "../api";
import { sfx } from "../space/spaceAudio";
import { fmtMKD } from "../space/format";

const NOTES = [10, 50, 100, 200, 500, 1000];

const T = {
  gold: "#f0d99a", accent: "#d9b26a", text: "#cdd6e4", text2: "#8a94a8",
  muted: "#5d6a80", border: "#2a3345", panel: "rgba(10,14,22,.96)",
};

export function openCashPanel() {
  window.dispatchEvent(new Event("cabinet:open-cash"));
}

export default function CashSimulator() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null); // { amount, balance } | { error }

  useEffect(() => {
    const onKey = (e) => { if (e.key === "F9") { e.preventDefault(); setOpen((o) => !o); } };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("cabinet:open-cash", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("cabinet:open-cash", onOpen);
    };
  }, []);

  async function insert(amount) {
    if (busy) return;
    setBusy(true);
    const { ok, data } = await apiPost("/api/cabinet/cash-in", { amount });
    setBusy(false);
    if (!ok) { setLast({ error: (data?.error || "Rejected").toUpperCase() }); return; }
    setLast({ amount, balance: data.balance });
    sfx.cash();
    // any screen showing credits picks this up without polling
    window.dispatchEvent(new CustomEvent("cabinet:cash-in", { detail: { amount, balance: data.balance } }));
  }

  return (
    <>
      {/* floating opener — always reachable, even mid-game, finger-sized */}
      {!open && (
        <button onClick={() => { sfx.click(); setOpen(true); }} title="Insert cash"
          style={{
            position: "fixed", right: 14, bottom: 14, zIndex: 400,
            width: 62, height: 62, borderRadius: 16, cursor: "pointer",
            border: `2px solid ${T.border}`, background: "rgba(10,14,22,.92)",
            color: T.gold, display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 8px 22px rgba(0,0,0,.5)",
          }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="2.5" y="6" width="19" height="12" rx="2" />
            <circle cx="12" cy="12" r="3" />
            <path d="M6 9.5v5M18 9.5v5" strokeLinecap="round" />
          </svg>
        </button>
      )}

      {open && (
        <div onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 401, background: "rgba(3,4,7,.82)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'DM Sans', Helvetica, sans-serif" }}>
          <div style={{ width: "min(620px, 94vw)", padding: "28px 30px 24px", borderRadius: 24, border: `2px solid ${T.border}`, background: T.panel, boxShadow: "0 24px 70px rgba(0,0,0,.65)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 6, color: T.gold }}>INSERT CASH</div>
              <button onClick={() => { sfx.click(); setOpen(false); }} aria-label="Close"
                style={{ width: 48, height: 48, borderRadius: 12, border: `2px solid ${T.border}`, background: "transparent", color: T.text2, cursor: "pointer", fontSize: 20 }}>✕</button>
            </div>
            <div style={{ fontSize: 13, letterSpacing: 3, color: T.muted, marginBottom: 20 }}>
              TAP A NOTE TO LOAD CREDITS
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              {NOTES.map((n) => (
                <button key={n} disabled={busy} onClick={() => insert(n)}
                  style={{
                    minHeight: 88, borderRadius: 16, cursor: busy ? "default" : "pointer",
                    border: `2px solid ${T.border}`, background: "linear-gradient(180deg, rgba(217,178,106,.16), rgba(217,178,106,.05))",
                    color: T.gold, fontFamily: "'DM Sans', Helvetica, sans-serif",
                    fontSize: 26, fontWeight: 700, letterSpacing: 1, opacity: busy ? 0.55 : 1,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                  }}>
                  {n}
                  <span style={{ fontSize: 11, letterSpacing: 3, color: T.muted }}>МКД</span>
                </button>
              ))}
            </div>

            <div style={{ marginTop: 18, minHeight: 26, fontSize: 15, fontWeight: 600, textAlign: "center", color: last?.error ? "#ff7a6a" : T.text2 }}>
              {last?.error
                ? last.error
                : last
                  ? `ACCEPTED ${fmtMKD(last.amount)} — CREDITS ${fmtMKD(last.balance)}`
                  : " "}
            </div>

            <button onClick={() => { sfx.click(); setOpen(false); }}
              style={{ marginTop: 8, width: "100%", minHeight: 62, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>
              DONE
            </button>
          </div>
        </div>
      )}
    </>
  );
}
