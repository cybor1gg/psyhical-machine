// MintBets Mines — visual components, ported from the design system
// (DiamondGfx, BombGfx, ExplosionBurst, MinesBoard, MinesSlider, CashWin).
// Server-driven: tiles render exactly what the API revealed.
import React from "react";

// Faceted diamond used on revealed gem tiles.
export function DiamondGfx({ size = "90%" }) {
  const p = { base: "#2BD64A", stroke: "#0E8A2A", f2: "#62FB6E", f3: "#2EE84E", f4: "#15B636", f7: "#41F25C", f8: "#7DFE82", table: "#33EC55", tableStroke: "#7DFE92" };
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.5))" }}>
      <polygon points="22,14 78,14 96,42 50,94 4,42" fill={p.base} stroke={p.stroke} strokeWidth="2.5" strokeLinejoin="round" />
      <polygon points="22,14 38,14 30,42 4,42" fill={p.f8} />
      <polygon points="62,14 78,14 96,42 70,42" fill={p.f3} />
      <polygon points="4,42 30,42 50,94" fill={p.f7} />
      <polygon points="30,42 70,42 50,94" fill={p.f2} />
      <polygon points="70,42 96,42 50,94" fill={p.f4} />
      <polygon points="38,14 62,14 70,42 30,42" fill={p.table} stroke={p.tableStroke} strokeWidth="1.6" strokeLinejoin="round" />
      <polygon points="38,14 62,14 55,22 45,22" fill="rgba(255,255,255,0.32)" />
      <polygon points="27,17 45,17 40,25 30,25" fill="rgba(255,255,255,0.7)" />
      <polygon points="13,40 20,33 25,42 17,50" fill="rgba(255,255,255,0.4)" />
    </svg>
  );
}

// Cartoon bomb with a lit fuse — the mine.
export function BombGfx({ size = 52 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={{ filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.5))" }}>
      <defs>
        <radialGradient id="mb-bomb-body" cx="0.38" cy="0.34" r="0.75">
          <stop offset="0" stopColor="#4A5763" />
          <stop offset="0.55" stopColor="#222B33" />
          <stop offset="1" stopColor="#0E141A" />
        </radialGradient>
        <linearGradient id="mb-fuse" x1="30" y1="6" x2="38" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E8C56A" />
          <stop offset="1" stopColor="#B6792E" />
        </linearGradient>
      </defs>
      <circle cx="22" cy="29" r="15" fill="url(#mb-bomb-body)" stroke="#05080B" strokeWidth="1" />
      <ellipse cx="16" cy="23" rx="4.6" ry="6" fill="rgba(255,255,255,0.85)" opacity="0.9" transform="rotate(-24 16 23)" />
      <circle cx="25" cy="22" r="1.7" fill="rgba(255,255,255,0.5)" />
      <path d="M19 15.5h7l-1.2 4.2a2 2 0 0 1-1.9 1.4h-0.8a2 2 0 0 1-1.9-1.4z" fill="#3A444E" stroke="#05080B" strokeWidth="0.8" />
      <rect x="18.5" y="13.5" width="8" height="2.6" rx="1.3" fill="#525E69" stroke="#05080B" strokeWidth="0.8" />
      <path d="M25 14C27 9 31 7.5 34 9.5" stroke="url(#mb-fuse)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <circle cx="34.5" cy="9" r="2.4" fill="#FFE9A8" />
      <circle cx="34.5" cy="9" r="1.1" fill="#FF7A3C" />
    </svg>
  );
}

// One-shot explosion over the hit tile.
export function ExplosionBurst() {
  return (
    <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 2 }}>
      <span style={{ position: "absolute", width: "70%", height: "70%", borderRadius: "50%", background: "radial-gradient(circle, rgba(255,210,120,0.95) 0%, rgba(225,91,76,0.85) 40%, rgba(225,91,76,0) 70%)", animation: "mb-blast 520ms var(--ease-out) forwards" }} />
      <span style={{ position: "absolute", inset: 0, borderRadius: 8, border: "2px solid rgba(255,200,120,0.9)", animation: "mb-ring 520ms var(--ease-out) forwards" }} />
    </span>
  );
}

// The square board (5×5 up to 8×8 — cols derives from count). `revealed`
// maps tile → "gem" | "mine"; closed tiles are raised slate keys, revealed
// ones pressed-in wells (the DS Keno look).
export function MinesBoard({ revealed, onPick, dead, count = 25, hitTile = null, cashed = false, lastGem = null, pendingTile = null, maxW = 440 }) {
  const cols = Math.round(Math.sqrt(count));
  const tiles = Array.from({ length: count }, (_, i) => i);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: count > 25 ? 7 : 11, width: "100%", maxWidth: maxW, margin: "0 auto" }}>
      {tiles.map((i) => {
        const st = revealed[i]; // undefined | "gem" | "mine"
        const isOpen = !!st;
        const isHit = i === hitTile;
        const pending = pendingTile === i;
        const tileStyle = {
          position: "relative", aspectRatio: "1", width: "100%", padding: 0, boxSizing: "border-box",
          borderRadius: 8, border: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: isOpen || dead || pending ? "default" : "pointer",
          zIndex: lastGem && lastGem.i === i ? 6 : "auto",
          opacity: dead && !cashed && st == null ? 0.28 : 1,
          animation: pending ? "mb-tile-pending 900ms var(--ease-out) infinite" : (st === "gem" || isHit) ? "mb-tile-pop 480ms var(--ease-in-out)" : "none",
          transition: "opacity 360ms var(--ease-out), background var(--dur-fast), transform var(--dur-fast), box-shadow var(--dur-fast)",
        };
        if (st === "gem") {
          Object.assign(tileStyle, {
            background: "linear-gradient(180deg,#13202C,#18242F)",
            boxShadow: "inset 0 4px 9px rgba(0,0,0,0.65), inset 0 0 0 2.5px #45EA64",
          });
        } else if (st === "mine") {
          Object.assign(tileStyle, {
            background: "linear-gradient(180deg,#13202C,#18242F)",
            boxShadow: isHit
              ? "inset 0 3px 7px rgba(0,0,0,0.55), inset 0 0 0 2.5px #E0455E"
              : "inset 0 3px 7px rgba(0,0,0,0.55), inset 0 0 0 1.5px rgba(224,69,94,0.45)",
          });
        } else {
          Object.assign(tileStyle, {
            background: "linear-gradient(180deg,#3B5570,#2B3E52)",
            boxShadow: "inset 0 2px 0 rgba(255,255,255,0.12), 0 3px 0 #1B2937, 0 6px 9px rgba(0,0,0,0.45)",
          });
        }
        return (
          <button
            key={`${i}-${st || "c"}`}
            onClick={() => { if (!isOpen && !dead && pendingTile == null) onPick(i); }}
            disabled={dead}
            style={tileStyle}
            onMouseEnter={(e) => { if (isOpen || dead) return; e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.background = "linear-gradient(180deg,#44607E,#324760)"; }}
            onMouseLeave={(e) => { if (isOpen || dead) return; e.currentTarget.style.transform = "none"; e.currentTarget.style.background = "linear-gradient(180deg,#3B5570,#2B3E52)"; }}
            onMouseDown={(e) => { if (isOpen || dead) return; e.currentTarget.style.transform = "translateY(2px)"; }}
            onMouseUp={(e) => { if (isOpen || dead) return; e.currentTarget.style.transform = "translateY(-1px)"; }}
          >
            {st === "gem" && (
              <span style={{ position: "absolute", inset: "21%", display: "flex", alignItems: "center", justifyContent: "center", animation: cashed ? "none" : "mb-fade-in 320ms var(--ease-out) both" }}>
                <DiamondGfx size="100%" />
              </span>
            )}
            {lastGem && lastGem.i === i && (
              <span key={lastGem.id} style={{ position: "absolute", left: "50%", bottom: -9, transform: "translateX(-50%)", display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 999, background: "#45EA64", boxShadow: "0 3px 10px rgba(0,0,0,0.5), 0 0 10px rgba(70,180,140,0.4)", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 12, lineHeight: 1.2, color: "#062018", letterSpacing: "-0.02em", pointerEvents: "none", whiteSpace: "nowrap", animation: "mb-gemfloat 1650ms var(--ease-out) forwards" }}>
                {lastGem.mx.toFixed(2)}×
              </span>
            )}
            {st === "mine" && (
              <span style={{ position: "absolute", inset: "17%", display: "flex", alignItems: "center", justifyContent: "center", opacity: cashed && !isHit ? 0.5 : 1, animation: isHit ? "mb-bomb-in 540ms var(--ease-bounce)" : cashed ? `mb-reveal 440ms var(--ease-out) ${(i % cols) * 45 + Math.floor(i / cols) * 45}ms both` : "mb-bomb-in 540ms var(--ease-bounce)" }}>
                <BombGfx size="100%" />
              </span>
            )}
            {isHit && <ExplosionBurst />}
          </button>
        );
      })}
    </div>
  );
}

// Drag-to-choose mines slider: mint (gems) left, red (mines) right.
export function MinesSlider({ mines, setMines, maxMines = 24, disabled = false }) {
  const total = maxMines + 1;
  const gems = total - mines;
  const frac = maxMines > 1 ? (gems - 1) / (maxMines - 1) : 0;
  const trackRef = React.useRef(null);
  const dragging = React.useRef(false);

  const setFromX = (clientX) => {
    const el = trackRef.current;
    if (!el || disabled || maxMines < 2) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left - 9) / (r.width - 18)));
    const g = Math.round(1 + f * (maxMines - 1));
    setMines(total - g);
  };
  const onDown = (e) => { if (disabled) return; dragging.current = true; setFromX(e.clientX); try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} };
  const onMove = (e) => { if (dragging.current) setFromX(e.clientX); };
  const onUp = () => { dragging.current = false; };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, height: 50, padding: "0 14px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", opacity: disabled ? 0.55 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto", color: "var(--mint-bright)" }}>
        <DiamondGfx size={18} />
        <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 14, minWidth: 18, textAlign: "right" }}>{gems}</span>
      </div>
      <div ref={trackRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        style={{ position: "relative", flex: 1, height: 26, display: "flex", alignItems: "center", cursor: disabled ? "default" : "pointer", touchAction: "none" }}>
        <div style={{ position: "absolute", left: 0, right: 0, height: 8, borderRadius: 999, overflow: "hidden", display: "flex", background: "var(--ink)", pointerEvents: "none" }}>
          <div style={{ width: `calc(${frac} * (100% - 18px) + 9px)`, flex: "0 0 auto", background: "linear-gradient(90deg, var(--mint-deep), var(--mint))" }} />
          <div style={{ flex: 1, background: "linear-gradient(90deg, var(--loss), #C94A3D)" }} />
        </div>
        <div style={{ position: "absolute", left: `calc(${frac} * (100% - 18px))`, width: 18, height: 18, borderRadius: "50%", background: "#EAF5EF", border: "3px solid var(--ink)", boxShadow: "0 2px 8px rgba(0,0,0,0.5)", pointerEvents: "none" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto", color: "var(--loss)" }}>
        <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 14, minWidth: 18 }}>{mines}</span>
        <BombGfx size={18} />
      </div>
    </div>
  );
}

// Live multiplier readout once a round starts: current × and next-tile ×.
export function MinesReadout({ current, next }) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden", boxShadow: "var(--shadow-md)", animation: "mb-rise var(--dur-base) var(--ease-out)" }}>
      <div style={{ flex: 1, padding: "8px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>Current</span>
        <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 19, color: "var(--mint-bright)", letterSpacing: "-0.02em" }}>{current.toFixed(2)}×</span>
      </div>
      <div style={{ flex: 1, padding: "8px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, borderLeft: "1px solid var(--border)" }}>
        <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>Next tile</span>
        <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 19, color: "var(--text)", letterSpacing: "-0.02em" }}>{next.toFixed(2)}×</span>
      </div>
    </div>
  );
}

// Cashout celebration plate.
export function CashWin({ mult, profit, gems = null }) {
  const accent = "#37dd84";
  return (
    <div style={{ pointerEvents: "none", animation: "rl-pop-c 360ms cubic-bezier(0.34,1.45,0.5,1)" }}>
      <div style={{ background: accent, borderRadius: 18, padding: 6, boxShadow: "0 20px 55px rgba(0,0,0,0.55)", minWidth: 220 }}>
        <div style={{ padding: "14px 28px 11px", textAlign: "center", fontFamily: "'Unbounded', var(--font-numeric)", fontWeight: 800, fontSize: 30, color: "#062018", letterSpacing: "-0.02em" }}>x{(mult || 0).toFixed(2)}</div>
        <div style={{ background: "#0e1014", border: `2px solid ${accent}`, borderRadius: 13, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: gems != null ? "space-between" : "center", gap: 18 }}>
          <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 16, color: "#fff" }}>${profit}</span>
          {gems != null && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 18, height: 18, display: "inline-flex" }}><DiamondGfx size="100%" /></span>
              <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 16, color: "#fff" }}>{gems}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
