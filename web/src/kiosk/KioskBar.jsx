// Shared kiosk wallet chrome: the live credits readout and the Cash Out
// button (confirm → attendant-payout screen). Used by the lobby's bottom bar
// and every game's bottom bar, all fed by lib/balanceStore.
import { useState } from "react";
import { apiPost } from "../api";
import { useBalance } from "../lib/balanceStore";

export function BalanceReadout({ large = false }) {
  const balance = useBalance();
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 10, pointerEvents: "none", userSelect: "none" }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: large ? 13 : 11, letterSpacing: "0.14em", color: "var(--text-muted)" }}>
        CREDITS
      </span>
      <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: large ? 30 : 22, color: "var(--mint-bright)", textShadow: "0 0 18px rgba(70,180,140,0.35)" }}>
        ${balance == null ? "—" : Number(balance).toFixed(2)}
      </span>
    </span>
  );
}

export function CashOutButton({ large = false }) {
  const balance = useBalance();
  const [phase, setPhase] = useState("idle"); // idle | confirm | busy | done
  const [paid, setPaid] = useState(0);
  const [error, setError] = useState("");

  async function confirm() {
    setPhase("busy");
    setError("");
    const { ok, data } = await apiPost("/api/cabinet/cash-out");
    if (!ok) {
      setError(data?.error || "Cash out failed");
      setPhase("confirm");
      return;
    }
    setPaid(data.amount);
    setPhase("done");
  }

  const h = large ? 56 : 44;
  const disabled = !balance;

  return (
    <>
      <button
        onClick={() => { setError(""); setPhase("confirm"); }}
        disabled={disabled}
        style={{
          height: h, padding: large ? "0 26px" : "0 18px", borderRadius: 12, border: "none",
          cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1,
          background: "linear-gradient(180deg, #f4cf6a 0%, #dfa93c 60%, #b8842a 100%)",
          color: "#231a06", fontFamily: "var(--font-display)", fontWeight: 800,
          fontSize: large ? 16 : 13.5, letterSpacing: "0.08em",
        }}>
        CASH OUT
      </button>

      {phase !== "idle" && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(5,9,15,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "min(420px, 100%)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 26, textAlign: "center", boxShadow: "0 22px 60px rgba(0,0,0,0.6)" }}>
            {phase === "done" ? (
              <>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 21, marginBottom: 8 }}>Collect your payout</div>
                <div style={{ fontFamily: "var(--font-numeric)", fontWeight: 800, fontSize: 40, color: "var(--mint-bright)", margin: "6px 0 10px" }}>${paid.toFixed(2)}</div>
                <p style={{ margin: "0 0 20px", color: "var(--text-muted)", fontSize: 14, lineHeight: 1.5 }}>
                  Please see the attendant to receive your cash.
                </p>
                <button onClick={() => setPhase("idle")} style={{ height: 54, width: "100%", borderRadius: 12, border: "none", cursor: "pointer", background: "var(--mint)", color: "var(--text-on-accent)", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16 }}>
                  DONE
                </button>
              </>
            ) : (
              <>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 21, marginBottom: 8 }}>Cash out?</div>
                <p style={{ margin: "0 0 6px", color: "var(--text-muted)", fontSize: 14 }}>
                  Your remaining credits will be paid out by the attendant.
                </p>
                <div style={{ fontFamily: "var(--font-numeric)", fontWeight: 800, fontSize: 34, color: "var(--mint-bright)", margin: "8px 0 14px" }}>
                  ${Number(balance ?? 0).toFixed(2)}
                </div>
                {error && (
                  <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 10, background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: 13, fontWeight: 600 }}>
                    {error}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setPhase("idle")} disabled={phase === "busy"} style={{ flex: 1, height: 54, borderRadius: 12, cursor: "pointer", background: "var(--surface-raised)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>
                    Keep playing
                  </button>
                  <button onClick={confirm} disabled={phase === "busy"} style={{ flex: 1, height: 54, borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(180deg, #f4cf6a 0%, #dfa93c 60%, #b8842a 100%)", color: "#231a06", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15, opacity: phase === "busy" ? 0.6 : 1 }}>
                    {phase === "busy" ? "…" : "CASH OUT"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
