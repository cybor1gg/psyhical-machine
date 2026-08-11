// MintBets casino chip kit — shared by Roulette and Baccarat. Faithful port of
// the design system's chip visuals (3D disc + dashed ring, tray grouped
// violet → magenta → teal → gold → blue), denominated in dollars to match the
// rest of the platform instead of the design's crypto unit scale.
import React from "react";
import { sound } from "../../lib/sound";

export function chipLbl(n) {
  if (n >= 1e9) return +(n / 1e9).toFixed(n % 1e9 ? 1 : 0) + "B";
  if (n >= 1e6) return +(n / 1e6).toFixed(n % 1e6 ? 1 : 0) + "M";
  if (n >= 1e3) return +(n / 1e3).toFixed(n % 1e3 ? 1 : 0) + "K";
  if (n >= 1) return String(+n.toFixed(2));
  return String(+n.toFixed(2)); // 0.1, 0.5
}

// $ readout used next to chip labels and in win popups.
export function fmtUSD(v) {
  return "$" + (Math.round(v * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Chip palette grouped like a real chip tray: violet → magenta → teal → gold → blue.
const CHIP_GROUPS = {
  violet: { face: "#6d3ff0", ring: "#a78bfa", edge: "#3f2496" },
  magenta: { face: "#c42bce", ring: "#e879f0", edge: "#7c1a82" },
  teal: { face: "#129e90", ring: "#67e8d4", edge: "#0b5f57" },
  gold: { face: "#f3b318", ring: "#fcd96b", edge: "#9a6f08" },
  blue: { face: "#2f7fe6", ring: "#93c5fd", edge: "#1b4f96" },
};
export const CHIP_DEFS = [
  [0.1, "violet"], [0.5, "violet"], [1, "violet"],
  [2, "magenta"], [5, "magenta"], [10, "magenta"],
  [25, "teal"], [50, "teal"], [100, "teal"],
  [250, "gold"], [500, "gold"], [1000, "gold"],
  [5000, "blue"],
].map(([v, g]) => ({ v, label: chipLbl(v), ...CHIP_GROUPS[g] }));

// Representative disc for an arbitrary amount: the largest denomination ≤ amount.
export function repChipDef(amount) {
  let d = CHIP_DEFS[0];
  for (const x of CHIP_DEFS) if (amount >= x.v) d = x;
  return d;
}

export function ChipDisc({ def, size = 50, selected = false, label = null }) {
  const edge = Math.max(2, Math.round(size * 0.07));
  const t = Math.max(2, Math.round(size * 0.08));
  const layers = [];
  for (let i = 1; i <= t; i++) layers.push(`0 ${i}px 0 ${def.edge}`);
  layers.push(`0 ${t + (selected ? 4 : 2)}px ${selected ? 9 : 6}px rgba(0,0,0,0.5)`);
  const txt = label != null ? label : def.label;
  return (
    <div style={{ position: "relative", width: size, height: size, borderRadius: "50%", flex: "0 0 auto", background: def.face, boxShadow: layers.join(", ") }}>
      {selected && <div style={{ position: "absolute", left: -2, top: -2, width: size + 4, height: size + t + 4, borderRadius: 9999, border: "1.6px solid #fff", boxSizing: "border-box", boxShadow: "0 0 5px rgba(255,255,255,0.45)", pointerEvents: "none", zIndex: 3 }} />}
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `${edge}px dashed ${def.ring}`, boxSizing: "border-box" }} />
      <div style={{ position: "absolute", inset: size * 0.16, borderRadius: "50%", border: `1.5px solid ${def.ring}`, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-numeric)", fontWeight: 800, fontSize: size * (txt.length >= 4 ? 0.26 : txt.length >= 3 ? 0.3 : 0.36), color: "#fff", textShadow: "0 1px 1px rgba(0,0,0,0.45)" }}>{txt}</div>
    </div>
  );
}

// Chip-value selector (left panel): scrollable chip rail with edge fades,
// arrow buttons and a chevron popover showing the whole tray.
export function ChipValueSelector({ value, onSelect, disabled, min = 0 }) {
  const DEFS = CHIP_DEFS.filter((d) => d.v >= min);
  const railRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const [hov, setHov] = React.useState(0);
  const scroll = (dir) => { const el = railRef.current; if (el) el.scrollBy({ left: dir * 150, behavior: "smooth" }); };
  const pick = (v) => { if (disabled) return; onSelect(v); sound.chip(); };

  const arrow = (dir) => (
    <button onClick={() => scroll(dir)} disabled={disabled} aria-label={dir < 0 ? "Scroll left" : "Scroll right"}
      onMouseEnter={() => setHov(dir)} onMouseLeave={() => setHov(0)}
      style={{ flex: "0 0 auto", alignSelf: "center", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
        background: hov === dir ? "var(--mint)" : "var(--surface)", border: `1px solid ${hov === dir ? "var(--mint)" : "var(--border)"}`,
        color: hov === dir ? "#0E1512" : "var(--text-muted)", cursor: disabled ? "default" : "pointer", borderRadius: 999,
        boxShadow: "0 1px 3px rgba(0,0,0,0.35)", transition: "background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast)" }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {dir < 0 ? <path d="m15 6-6 6 6 6" /> : <path d="m9 6 6 6-6 6" />}
      </svg>
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, opacity: disabled ? 0.55 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "var(--fs-caption)", color: "var(--text)", fontWeight: 700, whiteSpace: "nowrap" }}>Chip Value</span>
        <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontSize: 13, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fmtUSD(value || 0)}</span>
      </div>
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "stretch", gap: 8, height: 62, padding: "0 8px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
          {arrow(-1)}
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <div ref={railRef} className="mint-hide-scroll" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 12, overflowX: "auto", scrollbarWidth: "none", msOverflowStyle: "none", padding: "0 4px", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
              {DEFS.map((d) => (
                <button key={d.v} onClick={() => pick(d.v)} aria-label={`Chip ${d.label}`} title={fmtUSD(d.v)}
                  style={{ flex: "0 0 auto", background: "none", border: "none", padding: "2px 0", cursor: "pointer", outline: "none" }}>
                  <ChipDisc def={d} size={40} selected={d.v === value} />
                </button>
              ))}
            </div>
            {/* edge fades */}
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 14, pointerEvents: "none", background: "linear-gradient(90deg, var(--surface-raised), transparent)" }} />
            <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 14, pointerEvents: "none", background: "linear-gradient(270deg, var(--surface-raised), transparent)" }} />
          </div>
          {arrow(1)}
        </div>
        {/* chevron toggle (full tray popover) */}
        <button onClick={() => setOpen((o) => !o)} aria-label="All chips"
          style={{ position: "absolute", left: "50%", bottom: -13, transform: "translateX(-50%)", width: 26, height: 26, borderRadius: 999, background: "var(--surface-raised)", border: "1px solid var(--border)", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 4 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform var(--dur-fast)" }}><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {open && (
          // opens UPWARD: the selector always sits in a bottom control strip
          // (cabinet) or bottom sheet (mobile) — downward would leave the
          // viewport
          <div style={{ position: "absolute", left: 0, right: 0, bottom: "calc(100% + 16px)", zIndex: 20, padding: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", boxShadow: "0 12px 30px rgba(0,0,0,0.45)", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, justifyItems: "center", animation: "mb-rise var(--dur-fast) var(--ease-out)" }}>
            {DEFS.map((d) => (
              <button key={d.v} onClick={() => { pick(d.v); setOpen(false); }}
                style={{ background: "none", border: "none", padding: 2, cursor: "pointer", outline: "none" }}>
                <ChipDisc def={d} size={46} selected={d.v === value} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Chips placed on a table spot — up to 3 stacked discs, the top one shows the
// total. Absolute, centered on the spot (Roulette table layers).
export function PlacedChip({ stake, count = 1, size = 30 }) {
  const def = repChipDef(stake);
  const n = Math.min(3, Math.max(1, count));
  const off = Math.max(2, Math.round(size * 0.13));
  const discs = [];
  for (let i = 0; i < n; i++) discs.push(i);
  return (
    <span style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, pointerEvents: "none", zIndex: 5 }}>
      {discs.map((i) => (
        <span key={i} style={{ position: "absolute", left: -size / 2, top: -size / 2 - i * off, animation: "rl-chip-in 240ms cubic-bezier(0.2,0.7,0.2,1)" }}>
          <ChipDisc def={def} size={size} label={i === n - 1 ? chipLbl(stake) : ""} />
        </span>
      ))}
    </span>
  );
}

// Same stack as a normal block element (Baccarat bet spots).
export function ChipStack({ amount, count = 1, size = 40 }) {
  const def = repChipDef(amount);
  const n = Math.min(3, Math.max(1, count));
  const off = Math.max(2, Math.round(size * 0.16));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ position: "absolute", left: 0, bottom: i * off }}>
          <ChipDisc def={def} size={size} label={i === n - 1 ? chipLbl(amount) : ""} />
        </div>
      ))}
    </div>
  );
}
