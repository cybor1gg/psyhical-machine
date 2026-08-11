// MintBets Keno — visual components, ported from the design system: faceted
// gem on hits, purple raised picks, pressed-in misses, payout ladder + hit
// counter docked under the grid.
import React from "react";

// Faceted emerald (green) / neutral (white) gem.
export function KenoGem({ size = "90%", tone = "green" }) {
  const p = tone === "white"
    ? { base: "#E4E9F0", stroke: "#9AA6B5", f1: "#FFFFFF", f2: "#F2F5F9", f3: "#DCE2EB", f4: "#BAC4D1", f5: "#AEB9C8", f6: "#C8D1DD", f7: "#EDF1F6", f8: "#FBFCFE", table: "#F0F3F8", tableStroke: "#FFFFFF" }
    : { base: "#2BD64A", stroke: "#0E8A2A", f1: "#9BFF7E", f2: "#62FB6E", f3: "#2EE84E", f4: "#15B636", f5: "#0FA52E", f6: "#1FC83C", f7: "#41F25C", f8: "#7DFE82", table: "#33EC55", tableStroke: "#7DFE92" };
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.5))" }}>
      <polygon points="26,4 74,4 96,26 96,74 74,96 26,96 4,74 4,26" fill={p.base} stroke={p.stroke} strokeWidth="2.5" strokeLinejoin="round" />
      <polygon points="26,4 74,4 64,20 36,20" fill={p.f1} />
      <polygon points="74,4 96,26 80,36 64,20" fill={p.f2} />
      <polygon points="96,26 96,74 80,64 80,36" fill={p.f3} />
      <polygon points="96,74 74,96 64,80 80,64" fill={p.f4} />
      <polygon points="74,96 26,96 36,80 64,80" fill={p.f5} />
      <polygon points="26,96 4,74 20,64 36,80" fill={p.f6} />
      <polygon points="4,74 4,26 20,36 20,64" fill={p.f7} />
      <polygon points="4,26 26,4 36,20 20,36" fill={p.f8} />
      <polygon points="30,7 52,7 47,15 35,15" fill="rgba(255,255,255,0.7)" />
      <polygon points="7,30 16,21 22,34 13,46" fill="rgba(255,255,255,0.45)" />
      <polygon points="36,20 64,20 80,36 80,64 64,80 36,80 20,64 20,36" fill={p.table} stroke={p.tableStroke} strokeWidth="1.6" strokeLinejoin="round" />
      <polygon points="36,20 64,20 56,30 44,30" fill="rgba(255,255,255,0.32)" />
    </svg>
  );
}

export function fmtMult(m) {
  if (m >= 1000) return m.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (m >= 100) return m.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return m.toFixed(2);
}

// The 40-number grid. `picks` Set, `drawn` Set (revealed so far).
export function KenoBoard({ picks, drawn, onToggle, locked }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "clamp(5px,1.1vw,11px)", width: "100%" }}>
      {Array.from({ length: 40 }, (_, i) => i + 1).map((n) => {
        const sel = picks.has(n);
        const hit = drawn.has(n);
        const isHit = sel && hit;
        const isMiss = hit && !sel;
        const isPick = sel && !hit;
        const tileStyle = {
          position: "relative", aspectRatio: "1", borderRadius: 8,
          display: "flex", alignItems: "center", justifyContent: "center", border: "none",
          fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums",
          fontWeight: 600, fontSize: "clamp(13px,2.6vw,22px)",
          cursor: locked ? "default" : "pointer", padding: 0,
          transition: "background var(--dur-fast), color var(--dur-fast), transform var(--dur-fast), box-shadow var(--dur-fast)",
        };
        let inner = n;
        if (isHit) {
          Object.assign(tileStyle, {
            background: "linear-gradient(180deg,#13202C,#18242F)",
            boxShadow: "inset 0 4px 9px rgba(0,0,0,0.65), inset 0 0 0 2.5px #45EA64",
            animation: "mb-pop-scale 0.32s var(--ease-bounce)",
          });
          inner = (
            <>
              <span style={{ position: "absolute", inset: "13%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <KenoGem size="100%" />
              </span>
              <span style={{ position: "relative", fontSize: "0.62em", color: "#1A8233", textShadow: "0 1.5px 0 rgba(190,255,205,0.55), 0 -1px 1px rgba(10,60,25,0.5)" }}>{n}</span>
            </>
          );
        } else if (isPick) {
          Object.assign(tileStyle, {
            background: "linear-gradient(180deg,#C06CF8,#9A30EE)",
            color: "#fff",
            boxShadow: "inset 0 2px 0 rgba(255,255,255,0.4), inset 0 -5px 9px rgba(80,10,150,0.4), 0 4px 0 #6A18B0, 0 9px 13px rgba(0,0,0,0.5)",
            textShadow: "0 1px 2px rgba(50,0,100,0.6)",
          });
        } else if (isMiss) {
          Object.assign(tileStyle, {
            background: "linear-gradient(180deg,#13202C,#18242F)",
            color: "#E0455E",
            boxShadow: "inset 0 3px 7px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(224,69,94,0.10)",
            textShadow: "0 1px 2px rgba(0,0,0,0.5)",
          });
        } else {
          Object.assign(tileStyle, {
            background: "linear-gradient(180deg,#3B5570,#2B3E52)",
            color: "#B7C6DE",
            boxShadow: "inset 0 2px 0 rgba(255,255,255,0.12), 0 4px 0 #1B2937, 0 8px 11px rgba(0,0,0,0.5)",
            textShadow: "0 1px 2px rgba(0,0,0,0.5)",
          });
        }
        return (
          <button key={n} onClick={() => onToggle(n)} style={tileStyle} disabled={locked && !sel}
            onMouseEnter={(e) => { if (hit || locked || sel) return; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.background = "linear-gradient(180deg,#44607E,#324760)"; }}
            onMouseLeave={(e) => { if (hit || locked || sel) return; e.currentTarget.style.transform = "none"; e.currentTarget.style.background = "linear-gradient(180deg,#3B5570,#2B3E52)"; }}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

// Payout ladder + hit counter dock. `table` scaled multipliers by hit count;
// `liveHits` = hits revealed so far (-1 when idle); `resultHits` on settle.
export function KenoDock({ table, liveHits, resultHits, settled }) {
  if (!table) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${table.length}, 1fr)`, gap: "clamp(2px,0.4vw,4px)" }}>
        {table.map((m, h) => {
          const achieved = settled && resultHits === h && m >= 1;
          return (
            <div key={h} style={{
              padding: "clamp(5px,1.2vw,8px) clamp(1px,0.5vw,3px)", borderRadius: "var(--r-sm)", textAlign: "center",
              background: achieved ? "rgba(13,20,28,0.92)" : "var(--surface-raised)",
              border: achieved ? "1px solid var(--mint)" : "1px solid transparent",
              fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 600,
              fontSize: "clamp(8px,1.4vw,13px)", letterSpacing: "-0.02em",
              whiteSpace: "nowrap", overflow: "hidden",
              color: m >= 1 ? "var(--text)" : "var(--text-muted)",
              transition: "all var(--dur-base)",
            }}>{fmtMult(m)}x</div>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${table.length}, 1fr)`, gap: "clamp(2px,0.4vw,4px)", background: "var(--surface-raised)", borderRadius: "var(--r-md)", padding: "8px 0" }}>
        {table.map((_, h) => {
          const reached = liveHits === h;
          return (
            <div key={h} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(1px,0.5vw,4px)", minWidth: 0, overflow: "hidden" }}>
              <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: "clamp(8px,1.5vw,13px)", letterSpacing: "-0.02em", color: "var(--text)" }}>{h}x</span>
              <span style={{ width: "clamp(9px,2.2vw,13px)", height: "clamp(9px,2.2vw,13px)", flex: "none", display: "flex", transform: reached ? "scale(1.12)" : "none", transition: "transform var(--dur-base)" }}>
                <KenoGem size="100%" tone={reached ? "green" : "white"} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
