// Shared shell pieces for the space-theme game screens (from the handoff):
// header (title + status chip + credits), the left control panel, the gold
// primary button, secondary tiles, the 4-step sound button and the BET
// stepper. All sizes clamp()-based so the UI compresses 900×540 → 4K.
import { useState } from "react";
import { useVol, cycleVol, sfx, VOL_LABELS } from "./spaceAudio";
import { apiPost } from "../api";
import { useBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import "./space.css";

export const T = {
  page: "radial-gradient(120% 92% at 50% -12%, #0d1626 0%, #070a12 55%, #05060a 100%)",
  panelBg: "rgba(11,16,26,.94)",
  panelBorder: "#1d2536",
  ctlBorder: "#2a3345",
  accent: "#d9b26a",
  gold: "#f0d99a",
  goldDeep: "#a9843e",
  text: "#cdd6e4",
  text2: "#8a94a8",
  muted: "#5d6a80",
  disabled: "#3d4759",
  win: "#3ae0a1",
  lose: "#ff7a6a",
};

// Full-screen page root (landscape, no scroll).
export function SpaceRoot({ children, style }) {
  return (
    <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", fontFamily: "'DM Sans', Helvetica, sans-serif", color: T.text, background: "transparent", WebkitUserSelect: "none", userSelect: "none", ...style }}>
      {children}
    </div>
  );
}

// Cash out. This lived on the lobby; the lobby is now just games, so the
// control belongs on the screen where the player actually has credits at
// stake. Shared here so all twelve games get exactly the same one.
function CashoutModal({ onClose }) {
  const balance = useBalance() ?? 0;
  const [phase, setPhase] = useState("confirm"); // confirm | busy | done
  const [paid, setPaid] = useState(0);
  const [error, setError] = useState("");
  const confirm = async () => {
    setPhase("busy");
    const { ok, data } = await apiPost("/api/cabinet/cash-out");
    if (!ok) { setError(data?.error || "Cash out failed"); setPhase("confirm"); return; }
    setPaid(data.amount);
    setPhase("done");
    sfx.cash();
  };
  const btn = (extra) => ({ padding: "18px 40px", borderRadius: 46, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 4, cursor: "pointer", ...extra });
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(3,4,7,.82)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "min(560px, 92vw)", padding: "38px 40px", borderRadius: 24, border: `2px solid ${T.ctlBorder}`, background: "rgba(10,14,22,.96)", textAlign: "center", fontFamily: "'DM Sans', Helvetica, sans-serif" }}>
        {phase === "done" ? (
          <>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>COLLECT YOUR PAYOUT</div>
            <div style={{ fontSize: 46, fontWeight: 700, color: T.win, margin: "18px 0 8px" }}>{fmtMKD(paid)}</div>
            <div style={{ fontSize: 15, color: T.text2, letterSpacing: 1, marginBottom: 26 }}>Please see the attendant to receive your cash.</div>
            <button onClick={onClose} style={btn({ border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", width: "100%" })}>DONE</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>CASH OUT?</div>
            <div style={{ fontSize: 42, fontWeight: 700, color: T.gold, margin: "16px 0 6px" }}>{fmtMKD(balance)}</div>
            <div style={{ fontSize: 15, color: T.text2, letterSpacing: 1, marginBottom: 22 }}>Your remaining credits will be paid out by the attendant.</div>
            {error && <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,122,106,.5)", background: "rgba(255,122,106,.12)", color: T.lose, fontSize: 14, fontWeight: 600 }}>{error}</div>}
            <div style={{ display: "flex", gap: 14 }}>
              <button onClick={onClose} disabled={phase === "busy"} style={btn({ flex: 1, border: `2px solid ${T.ctlBorder}`, background: "rgba(255,255,255,.04)", color: T.text })}>KEEP PLAYING</button>
              <button onClick={confirm} disabled={phase === "busy" || balance <= 0} style={btn({ flex: 1, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", opacity: phase === "busy" || balance <= 0 ? 0.6 : 1 })}>
                {phase === "busy" ? "…" : "CASH OUT"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Header: game title left, status + credits chips right. `chip` is
// { label, color } (multiplier / last win readout).
export function SpaceHeader({ title, chip }) {
  const balance = useBalance();
  const [cashOpen, setCashOpen] = useState(false);
  return (
    <div style={{ position: "relative", zIndex: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, padding: "18px 40px 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 15 }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 9, color: T.gold }}>{title}</div>
        <div style={{ fontSize: 12, letterSpacing: 5, color: T.muted }}>M-TECH ORIGINALS</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {chip && (
          <div style={{ padding: "9px 18px", borderRadius: 30, border: `2px solid ${T.ctlBorder}`, background: "rgba(5,7,12,.78)", fontSize: 16, fontWeight: 700, letterSpacing: 2, color: chip.color || T.text2 }}>
            {chip.label}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "9px 18px", borderRadius: 14, border: `2px solid ${T.ctlBorder}`, background: "rgba(5,7,12,.78)" }}>
          <span style={{ fontSize: 11, letterSpacing: 4, color: T.text2 }}>CREDITS</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: T.gold }}>{fmtMKD(balance ?? 0)}</span>
        </div>
        <button onClick={() => { sfx.click(); setCashOpen(true); }} className="sp-hover-gold"
          style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 20px", borderRadius: 14, border: `2px solid ${T.ctlBorder}`, background: "rgba(5,7,12,.78)", color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v13M7 11l5 5 5-5M4 20h16" />
          </svg>
          CASHOUT
        </button>
      </div>
      {cashOpen && <CashoutModal onClose={() => setCashOpen(false)} />}
    </div>
  );
}

// The left control panel shell: fixed clamp width, centered column.
export function SpaceSidebar({ children }) {
  return (
    <div style={{ flex: "none", width: "clamp(230px, 24vw, 340px)", display: "flex", flexDirection: "column", justifyContent: "center", gap: "clamp(8px, 2.2vh, 18px)", margin: "14px 0 20px clamp(10px, 1.6vw, 24px)", padding: "clamp(10px, 2vh, 20px) clamp(10px, 1.2vw, 18px)", borderRadius: 24, border: `2px solid ${T.panelBorder}`, background: T.panelBg, overflow: "hidden" }}>
      {children}
    </div>
  );
}

export function SectionLabel({ children }) {
  return <div style={{ fontSize: 14, letterSpacing: 4, color: T.muted }}>{children}</div>;
}

// Secondary tile/button style used across sidebars and bottom bars.
export function tileStyle(extra = {}) {
  return {
    border: `2px solid ${T.ctlBorder}`, background: "rgba(255,255,255,.03)", borderRadius: 16,
    color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontWeight: 700, cursor: "pointer",
    ...extra,
  };
}

// Selected/unselected pill (field size / risk / rows).
export function pillStyle(on, extra = {}) {
  return {
    border: `2px solid ${on ? T.accent : T.ctlBorder}`,
    background: on ? "rgba(217,178,106,.16)" : "rgba(255,255,255,.03)",
    color: on ? T.gold : T.text2,
    borderRadius: 16, fontFamily: "'DM Sans', Helvetica, sans-serif", fontWeight: 700, cursor: "pointer", transition: "all .2s ease",
    ...extra,
  };
}

// Primary gold action button (BET / DROP / DEAL / PLAY).
export function GoldButton({ label, sub, onClick, disabled, style, labelSize = "clamp(22px, 4vh, 32px)" }) {
  return (
    <button onClick={onClick} disabled={disabled} className="sp-hover-gold"
      style={{
        minHeight: "clamp(56px, 11vh, 88px)", borderRadius: 22, cursor: disabled ? "default" : "pointer",
        border: disabled ? `2px solid ${T.ctlBorder}` : "3px solid #f6f1e6",
        background: disabled ? "rgba(255,255,255,.04)" : "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)",
        color: disabled ? T.muted : "#1a1408",
        boxShadow: disabled ? "none" : "0 12px 34px rgba(240,217,154,.3)",
        fontFamily: "'DM Sans', Helvetica, sans-serif", fontWeight: 700,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
        padding: "0 clamp(18px, 3vw, 44px)",
        ...style,
      }}>
      <span style={{ fontSize: labelSize, letterSpacing: 6, lineHeight: 1.05 }}>{label}</span>
      {sub && <span style={{ fontSize: "clamp(11px, 1.8vh, 15px)", letterSpacing: 2, opacity: 0.85 }}>{sub}</span>}
    </button>
  );
}

// SOUND cycle button: OFF → LOW → MEDIUM → HIGH; bars light with level.
export function SoundButton() {
  const vol = useVol();
  const barsLit = vol === 0 ? 0 : vol; // 0..3 bars
  return (
    <button onClick={() => { cycleVol(); sfx.click(); }} title={VOL_LABELS[vol]} className="sp-hover-gold"
      style={tileStyle({ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, minHeight: "clamp(50px, 9vh, 76px)", padding: "0 14px", fontSize: "clamp(15px, 2.3vh, 20px)", letterSpacing: 3 })}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3z" /></svg>
      <span style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 26 }}>
        {[13, 19, 25].map((h, i) => (
          <span key={i} style={{ display: "block", width: 7, height: h, borderRadius: 3, background: i < barsLit ? T.accent : T.ctlBorder }} />
        ))}
      </span>
      <span style={{ minWidth: 96, textAlign: "left" }}>{VOL_LABELS[vol]}</span>
    </button>
  );
}

// BET stepper: − / value / + and MAX BET. Step 50, min 50, max = balance
// (capped by the platform's max bet where the game passes one).
export function BetStepper({ bet, setBet, disabled, maxBet }) {
  const balance = useBalance() ?? 0;
  // The ceiling is whichever runs out first: the backoffice limit for this
  // game, or the credits actually on the machine.
  const cap = Math.max(50, Math.min(maxBet ?? Infinity, Math.floor(balance)));
  const step = (d) => {
    sfx.click();
    setBet(Math.max(50, Math.min(cap, bet + d * 50)));
  };
  // x2 / x10 multiply what is on the stepper right now, rounded to the 50 the
  // stepper works in, and stop at the cap rather than refusing.
  const times = (k) => {
    sfx.click();
    setBet(Math.max(50, Math.min(cap, Math.round((bet * k) / 50) * 50)));
  };
  const atCap = bet >= cap;
  const sq = { flex: "none", width: "clamp(50px, 9vh, 76px)", minHeight: "clamp(50px, 9vh, 76px)", fontSize: "clamp(26px, 4.5vh, 38px)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? "none" : "auto", transition: "opacity .2s ease" }}>
      <SectionLabel>BET</SectionLabel>
      <div style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
        <button onClick={() => step(-1)} className="sp-hover-gold" style={tileStyle(sq)}>−</button>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "clamp(50px, 9vh, 76px)", border: `2px solid ${T.ctlBorder}`, borderRadius: 16, background: "rgba(255,255,255,.03)", fontSize: "clamp(17px, 3vh, 25px)", fontWeight: 700, color: T.gold, whiteSpace: "nowrap" }}>
          {fmtMKD(bet)}
        </div>
        <button onClick={() => step(1)} className="sp-hover-gold" style={tileStyle({ ...sq, fontSize: "clamp(24px, 4.2vh, 36px)" })}>+</button>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {[2, 10].map((k) => (
          <button key={k} onClick={() => times(k)} disabled={atCap} className="sp-hover-gold"
            style={tileStyle({ flex: 1, minHeight: "clamp(42px, 7vh, 58px)", fontSize: "clamp(14px, 2.1vh, 18px)", letterSpacing: 2, opacity: atCap ? 0.4 : 1 })}>
            ×{k}
          </button>
        ))}
      </div>
      <button onClick={() => { sfx.click(); setBet(cap); }} disabled={atCap} className="sp-hover-gold"
        style={tileStyle({ minHeight: "clamp(42px, 7vh, 58px)", fontSize: "clamp(14px, 2.1vh, 18px)", letterSpacing: 4, opacity: atCap ? 0.4 : 1 })}>
        MAX BET
      </button>
    </div>
  );
}
