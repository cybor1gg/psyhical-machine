// MintBets bet panel — a faithful "lite" port (Manual mode only; no auto-bet yet).
// Amount field with ½ / 2X / Max, a children slot for game controls, a stat
// readout, and the pinned primary action button.
import React from "react";

// `compact`: half-width mode (two inputs sharing a row on phones) — the Max
// quick button is dropped so the digits keep room.
// `small`: phone-size type ramp — shorter field, smaller label/digits.
export function BetAmountInput({ value, onChange, currency = "$", onHalf, onDouble, onMax, label = "Bet Amount", disabled = false, compact = false, small = false, topRight = null }) {
  const [focus, setFocus] = React.useState(false);

  const Quick = ({ children, onClick, first }) => (
    <button onClick={onClick} disabled={disabled}
      style={{
        height: small ? 36 : 44, minWidth: compact ? 38 : small ? 42 : 50, padding: compact ? "0 9px" : small ? "0 10px" : "0 13px", background: "transparent", color: "var(--text-muted)",
        border: "none", borderLeft: first ? "none" : "1px solid var(--border)", borderRadius: 0,
        cursor: disabled ? "default" : "pointer", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--fs-caption)",
        transition: "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)",
      }}
      onMouseEnter={(e) => { if (disabled) return; e.currentTarget.style.background = "var(--mint)"; e.currentTarget.style.color = "var(--text-on-accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}>
      {children}
    </button>
  );

  return (
    <div>
      <div style={{ marginBottom: small ? 4 : 6, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: small ? "var(--fs-caption)" : "var(--fs-sm)", color: small ? "var(--text-muted)" : "var(--text)", fontWeight: 600, fontFamily: "var(--font-display)" }}>
        <span>{label}</span>
        {topRight != null && <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>{topRight}</span>}
      </div>
      <div style={{
        display: "flex", alignItems: "center", height: small ? 44 : 54, background: "var(--surface-raised)",
        border: "1px solid " + (focus ? "var(--mint)" : "var(--border)"),
        borderRadius: "var(--r-md)", boxShadow: focus ? "var(--ring)" : "none",
        padding: compact ? "0 5px 0 10px" : "0 7px 0 14px", opacity: disabled ? 0.6 : 1,
        transition: "border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
      }}>
        <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-numeric)", fontWeight: 600, fontSize: small ? 13.5 : 15, marginRight: small ? 5 : 7 }}>{currency}</span>
        <input
          value={value} disabled={disabled}
          onChange={(e) => {
            let v = e.target.value.replace(/[^0-9.]/g, "");
            const i = v.indexOf(".");
            if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, "");
            onChange(v);
          }}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          inputMode="decimal"
          style={{
            flex: 1, minWidth: 0, height: "100%", background: "transparent", border: "none", outline: "none",
            color: "var(--text)", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums",
            fontSize: small ? 16 : 17, fontWeight: 700, letterSpacing: "var(--ls-tight)", padding: 0,
          }}
        />
        <div style={{ display: "flex", alignItems: "center", flex: "0 0 auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", overflow: "hidden" }}>
          <Quick first onClick={onHalf}>1/2</Quick>
          <Quick onClick={onDouble}>2X</Quick>
          {!compact && <Quick onClick={onMax}>Max</Quick>}
        </div>
      </div>
    </div>
  );
}

// Field-styled native dropdown (16px font so iOS never zooms; OS picker
// sheet on phones). options: [{ value, label }].
export function SelectField({ label, value, options, onChange, disabled = false }) {
  return (
    <div>
      <div style={{ marginBottom: 6, fontSize: "var(--fs-caption)", color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ position: "relative" }}>
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--mint)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
          style={{
            width: "100%", height: 50, padding: "0 36px 0 12px", appearance: "none", WebkitAppearance: "none",
            borderRadius: "var(--r-md)", border: "1px solid var(--border)", background: "var(--surface-raised)",
            // System font (not the async Poppins web font): the OS renders the
            // native option list with a font it already has, so the list can't
            // mis-measure its rows and flash a scrollbar on first open.
            color: "var(--text)", fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontWeight: 700, fontSize: 16,
            cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1, outline: "none",
          }}>
          {options.map((o) => (
            <option key={o.value} value={o.value} style={{ background: "#1E2B3A", color: "#fff", fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontSize: 16 }}>{o.label}</option>
          ))}
        </select>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}><path d="m6 9 6 6 6-6" /></svg>
      </div>
    </div>
  );
}

export function StatField({ label, value, tone }) {
  return (
    <div>
      <div style={{ marginBottom: 6, fontSize: "var(--fs-caption)", color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
      <div style={{
        height: 46, display: "flex", alignItems: "center", padding: "0 12px",
        background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-md)",
        fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "var(--fs-base)",
        color: tone === "mint" ? "var(--mint-bright)" : "var(--text)",
      }}>{value}</div>
    </div>
  );
}

export function ActionButton({ label, tone = "primary", onClick, disabled = false, glow = false, small = false }) {
  const [hover, setHover] = React.useState(false);
  const bg = tone === "gold"
    ? "linear-gradient(180deg, #F2D68A 0%, var(--gold) 55%, #C9A147 100%)"
    : "linear-gradient(180deg, var(--mint-bright) 0%, var(--mint) 55%, var(--mint-deep) 100%)";
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: "100%", height: small ? 48 : 58, border: "none", borderRadius: "var(--r-md)",
        background: bg, color: "var(--text-on-accent)",
        fontFamily: "var(--font-display)", fontWeight: 700, fontSize: small ? 15 : 16.5, letterSpacing: "0.02em",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
        // `glow` is accepted for API compatibility but intentionally unused —
        // the client asked for flat bet buttons with no glow on any game.
        boxShadow: disabled ? "none" : "var(--shadow-sm)",
        filter: !disabled && hover ? "brightness(1.06)" : "none",
        transform: "translateY(0)",
        transition: "filter var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast), opacity var(--dur-fast)",
      }}
      // Pointer events, not mouse events: the press feedback must fire on a
      // touchscreen too — this is cabinet hardware first.
      onPointerDown={(e) => { if (!disabled) e.currentTarget.style.transform = "translateY(1px) scale(0.985)"; }}
      onPointerUp={(e) => { e.currentTarget.style.transform = "translateY(0) scale(1)"; }}
      onPointerLeave={(e) => { e.currentTarget.style.transform = "translateY(0) scale(1)"; }}>
      {label}
    </button>
  );
}

export function BetPanelLite({ amount, onAmount, betLocked, actionLabel, actionTone, onAction, actionDisabled, glow, children, error, betTopRight = null, onMax }) {
  const half = () => onAmount(String(Math.max(0, (parseFloat(amount) || 0) / 2).toFixed(2)));
  const dbl = () => onAmount(String(((parseFloat(amount) || 0) * 2).toFixed(2)));
  return (
    <div style={{
      width: "100%", boxSizing: "border-box", background: "var(--surface)",
      border: "1px solid var(--border)", borderRadius: "var(--r-xl)",
      padding: 14, display: "flex", flexDirection: "column", gap: 12,
    }}>
      <BetAmountInput value={amount} onChange={onAmount} disabled={betLocked} onHalf={half} onDouble={dbl} onMax={onMax || (() => {})}
        topRight={betTopRight} compact={betTopRight != null} />
      {children}
      {error && (
        <div style={{ padding: "10px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-sm)", fontWeight: 600, animation: "mb-rise var(--dur-fast) var(--ease-out)" }}>
          {error}
        </div>
      )}
      <ActionButton label={actionLabel} tone={actionTone} onClick={onAction} disabled={actionDisabled} glow={glow} />
    </div>
  );
}
