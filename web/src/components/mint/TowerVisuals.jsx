// Dragon Tower — visual components, styled after the reference dungeon look:
// stone hall with pillars and torches, crystal tiles, glowing picks with
// multiplier badges, and a shattered red gem on the dragon.
import React from "react";

// Faceted crystal. tone: "dim" (unclimbed), "face" (current row), "bright"
// (picked safe, mint glow).
export function GemIcon({ size = 24, tone = "dim" }) {
  const fills = {
    dim: { body: "#3a4763", edge: "#4c5b7d", glow: "none" },
    face: { body: "#4c5b7d", edge: "#6a7ea6", glow: "none" },
    bright: { body: "var(--mint-bright)", edge: "#a8f2d4", glow: "var(--mint-32)" },
  }[tone];
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 24 30" fill="none">
      {fills.glow !== "none" && <ellipse cx="12" cy="15" rx="11" ry="14" fill={fills.glow} opacity="0.55" />}
      <path d="M12 2L21 13L12 28L3 13Z" fill={fills.body} />
      <path d="M12 2L21 13H3Z" fill={fills.edge} opacity="0.75" />
      <path d="M12 2L15.5 13L12 28L8.5 13Z" fill="#ffffff" opacity={tone === "bright" ? 0.28 : 0.1} />
    </svg>
  );
}

// Shattered crystal — the dragon you hit.
export function ShatterIcon({ size = 26, faint = false }) {
  const o = faint ? 0.35 : 1;
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" opacity={o}>
      <path d="M13 3l4 5-5 3z" fill="var(--loss)" />
      <path d="M20 9l4 4-6 2z" fill="#c24334" />
      <path d="M6 8l5 2-3 5z" fill="#f0685a" />
      <path d="M15 14l5 4-7 3z" fill="var(--loss)" />
      <path d="M7 17l5-1-1 7z" fill="#c24334" />
      <path d="M12 12l2 2-3 2z" fill="#ffb3a8" opacity="0.8" />
    </svg>
  );
}

// The dungeon: stone wall, pillars, torch flames. Pure CSS, sits behind the
// tower inside the game canvas. On compact screens the pillars hug the very
// edges as slivers (the reference framing) and the torches are dropped.
export function TowerBackdrop({ compact = false }) {
  const pillarW = compact ? 18 : 52;
  const pillar = (side) => (
    <div key={side} style={{ position: "absolute", [side]: compact ? 0 : "5%", top: 0, bottom: 0, width: pillarW, display: "flex", flexDirection: "column", alignItems: "center", pointerEvents: "none" }}>
      <div style={{ width: pillarW, height: compact ? 12 : 16, background: "#242e48", borderRadius: 3, boxShadow: "0 3px 6px rgba(0,0,0,0.4)" }} />
      <div style={{ flex: 1, width: Math.round(pillarW * (compact ? 0.9 : 0.72)), background: "linear-gradient(90deg, #1a2238 0%, #273250 45%, #141b2e 100%)", boxShadow: "inset 0 0 18px rgba(0,0,0,0.55)" }} />
      <div style={{ width: pillarW, height: compact ? 10 : 13, background: "#242e48", borderRadius: 3 }} />
    </div>
  );
  const torch = (side) => (
    <div key={"t" + side} style={{ position: "absolute", [side]: "14%", bottom: "9%", display: "flex", flexDirection: "column", alignItems: "center", pointerEvents: "none" }}>
      <div style={{ width: 14, height: 20, position: "relative", marginBottom: -4 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50% 50% 40% 40%", background: "radial-gradient(circle at 50% 75%, #9fd4ff 0%, #3f7fe8 45%, rgba(45,90,200,0.0) 78%)", filter: "blur(1px)", animation: "mb-flicker 1.3s ease-in-out infinite" }} />
      </div>
      <div style={{ width: 22, height: 7, background: "#2a3454", borderRadius: "50%" }} />
      <div style={{ width: 8, height: 14, background: "linear-gradient(180deg, #2a3454, #1b2338)" }} />
      <div style={{ width: 26, height: 6, background: "#242e48", borderRadius: 2 }} />
    </div>
  );
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", borderRadius: "inherit" }}>
      {/* wall: clean dark surface with depth lighting — a soft glow behind
          the tower and a vignette pulling the edges into shadow. Texture is
          felt, never seen: no visible grid lines. */}
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(180deg, #131a2e 0%, #171f36 55%, #10162a 100%)",
      }} />
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(58% 48% at 50% 44%, rgba(84,120,220,0.09), transparent 75%)",
      }} />
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(120% 100% at 50% 50%, transparent 55%, rgba(5,8,16,0.55) 100%)",
      }} />
      {!compact && <div style={{ position: "absolute", left: "8%", bottom: "4%", width: 180, height: 140, background: "radial-gradient(ellipse at center, rgba(80,140,255,0.14), transparent 70%)" }} />}
      {!compact && <div style={{ position: "absolute", right: "8%", bottom: "4%", width: 180, height: 140, background: "radial-gradient(ellipse at center, rgba(80,140,255,0.14), transparent 70%)" }} />}
      {pillar("left")}{pillar("right")}
      {!compact && torch("left")}{!compact && torch("right")}
      {/* floor steps */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: compact ? 10 : 16, background: "#1b2338", boxShadow: "0 -4px 12px rgba(0,0,0,0.4)" }} />
    </div>
  );
}

// One tile. States:
//   dim          unclimbed row (faint crystal)
//   face         current row, clickable
//   pending      pick in flight (pulse)
//   picked-safe  climbed pick — bright gem + multiplier badge (blooms in)
//   empty        unpicked tile in a climbed row
//   safe-reveal  settle reveal: this tile was safe (cascades in)
//   dragon-faint settle reveal: a dragon you never touched (cascades in)
//   bust         the dragon you hit (shakes + shatters)
// Stone block — beveled, not gridded: a top light catch over a smooth stone
// gradient. Depth comes from the tile's inset shadows, no visible joints.
// (No background shorthand: mixing it with backgroundImage makes React drop
// one of them.)
const stoneLayers = (light = false) => ({
  backgroundColor: light ? "#2a3457" : "#1d2440",
  backgroundImage:
    (light
      ? "linear-gradient(180deg, rgba(255,255,255,0.08), transparent 32%),"
      : "linear-gradient(180deg, rgba(255,255,255,0.035), transparent 32%),") +
    (light
      ? "linear-gradient(180deg, #313c63 0%, #2a3457 60%, #252e4e 100%)"
      : "linear-gradient(180deg, #222944 0%, #1d2440 60%, #1a2039 100%)"),
});

export function TowerTile({ state, badge = null, clickable = false, onClick, w = 100, h = 52, revealDelay = 0 }) {
  const [hover, setHover] = React.useState(false);
  // no background here: stone states set backgroundColor/Image longhands, and
  // result states set their own — mixing shorthand + longhand trips React.
  const base = {
    position: "relative", width: w, height: h, borderRadius: 7,
    display: "flex", alignItems: "center", justifyContent: "center",
    border: "1px solid rgba(74,90,143,0.35)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -2px 6px rgba(0,0,0,0.3)",
    cursor: clickable ? "pointer" : "default", padding: 0, boxSizing: "border-box",
    transition: "transform 180ms cubic-bezier(0.22,1,0.36,1), border-color 160ms ease, box-shadow 220ms ease, background 160ms ease",
  };
  const gemSize = Math.round(h * 0.5);

  if (state === "picked-safe" || state === "bust") {
    const win = state === "picked-safe";
    return (
      <div style={{
        ...base,
        border: win ? "2px solid var(--mint-bright)" : "2px solid var(--loss)",
        background: win ? "rgba(70,180,140,0.13)" : "rgba(225,91,76,0.13)",
        boxShadow: win ? "0 0 16px 2px rgba(84,214,166,0.35)" : "0 0 18px 3px rgba(225,91,76,0.4)",
        animation: win ? "mb-gem-bloom 620ms var(--ease-out) both" : "mb-shake 480ms ease-in-out",
      }}>
        <span style={{ display: "flex", animation: win ? "none" : "mb-pop-scale 320ms var(--ease-bounce)" }}>
          {win ? <GemIcon size={gemSize} tone="bright" /> : <ShatterIcon size={gemSize + 8} />}
        </span>
        {badge && (
          <span style={{
            position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)",
            padding: "2px 10px", borderRadius: 6, whiteSpace: "nowrap",
            background: win ? "linear-gradient(180deg, #26BD81, #178F62)" : "linear-gradient(180deg, #E4604F, #C24334)",
            color: "#fff", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums",
            fontWeight: 700, fontSize: 11, border: "1px solid rgba(255,255,255,0.22)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
            animation: "mb-pop-scale 300ms var(--ease-bounce) 180ms both",
          }}>{badge}</span>
        )}
      </div>
    );
  }

  if (state === "pending") {
    return (
      <div style={{ ...base, ...stoneLayers(true), border: "2px solid var(--mint-32)", animation: "mb-tile-pending 650ms ease-in-out infinite" }}>
        <GemIcon size={gemSize} tone="face" />
      </div>
    );
  }

  if (state === "empty") {
    return <div style={{ ...base, ...stoneLayers(false), opacity: 0.5 }} />;
  }

  if (state === "safe-reveal" || state === "dragon-faint") {
    const dragon = state === "dragon-faint";
    return (
      <div style={{
        ...base,
        ...stoneLayers(false),
        opacity: dragon ? 0.75 : 0.78,
        border: dragon ? "1px solid rgba(225,91,76,0.35)" : base.border,
        animation: `mb-fade-in 380ms var(--ease-out) ${revealDelay}ms both`,
      }}>
        {dragon ? <ShatterIcon size={gemSize + 4} faint /> : <GemIcon size={gemSize} tone="dim" />}
      </div>
    );
  }

  if (state === "dim") {
    // plain stone — no icons before anything is revealed (the reference look)
    return <div style={{ ...base, ...stoneLayers(false), opacity: 0.92 }} />;
  }

  // face — clickable lighter stone on the active row; the gem only glints
  // through on hover (desktop) — a tap on mobile goes straight to the pick.
  return (
    <button onClick={onClick} disabled={!clickable}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        ...base,
        ...stoneLayers(true),
        border: clickable && hover ? "1.5px solid var(--mint-bright)" : "1px solid rgba(105,125,180,0.55)",
        transform: clickable && hover ? "translateY(-2px) scale(1.02)" : "none",
        boxShadow: clickable && hover
          ? "0 6px 20px rgba(84,214,166,0.3), inset 0 1px 0 rgba(255,255,255,0.08)"
          : "inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -2px 6px rgba(0,0,0,0.25)",
        animation: "mb-rise 300ms var(--ease-out) both",
      }}>
      {hover && clickable && <GemIcon size={gemSize} tone="bright" />}
    </button>
  );
}

// The tower. Row width is CONSTANT — tiles stretch to fill it, so Hard mode's
// two tiles are twice as wide as Easy's four (the premium Rainbet look).
// rowsState (bottom row first): { kind, dragons, pick, bust }
export function TowerGrid({ rowsState, tilesPerRow, onPick, busy, pendingTile, ladderValues, rowWidth = 440, tileH = 52, compact = false }) {
  const gap = compact ? 4 : 9;
  const tileW = Math.floor((rowWidth - (tilesPerRow - 1) * gap) / tilesPerRow);
  const fmt = (v) => (typeof v === "number" ? "x" + (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2)) : v);
  // cascade origin: reveals ripple upward from the bust row
  const firstRevealed = rowsState.findIndex((r) => r.kind === "revealed");
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column-reverse", gap, zIndex: 1, padding: compact ? "6px 5px 8px" : "14px 14px 20px", borderRadius: compact ? 8 : 14, background: "rgba(9,12,23,0.6)", border: "1px solid rgba(70,90,140,0.3)", boxShadow: "0 10px 40px rgba(0,0,0,0.35)" }}>
      {rowsState.map((row, r) => (
        <div key={r} style={{
          display: "flex", gap, padding: compact ? 2 : 4, borderRadius: compact ? 8 : 11,
          border: row.kind === "active" ? "1.5px solid var(--mint-32)" : "1.5px solid transparent",
          background: row.kind === "active" ? "rgba(123,240,196,0.06)" : "transparent",
          // the breathing box-shadow repaints constantly — desktop only
          animation: row.kind === "active" && !compact ? "mb-glow-pulse 1.9s var(--ease-out) infinite" : "none",
          transition: "border-color 240ms ease, background 240ms ease",
        }}>
          {Array.from({ length: tilesPerRow }, (_, t) => {
            let state = "dim", badge = null, clickable = false, revealDelay = 0;
            if (row.kind === "active") {
              state = pendingTile === t ? "pending" : "face";
              clickable = !busy && pendingTile == null;
            } else if (row.kind === "climbed") {
              if (t === row.pick) {
                state = row.bust ? "bust" : "picked-safe";
                badge = row.bust ? "bust" : fmt(ladderValues[r]);
              } else state = "empty";
            } else if (row.kind === "revealed") {
              state = row.dragons.includes(t) ? "dragon-faint" : "safe-reveal";
              revealDelay = Math.max(0, r - Math.max(0, firstRevealed)) * 70;
            }
            return (
              <TowerTile key={`${t}-${state}`} state={state} badge={badge} clickable={clickable}
                onClick={() => onPick(t)} w={tileW} h={tileH} revealDelay={revealDelay} />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Difficulty selector pills.
export function DifficultyPicker({ value, onChange, disabled }) {
  const opts = ["easy", "medium", "hard", "expert", "master"];
  // Native select in a field-styled shell: OS-native option sheet on mobile,
  // 16px font so iOS never zooms the page on focus.
  return (
    <div>
      <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>Difficulty</div>
      <div style={{ position: "relative" }}>
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--mint)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
          style={{
            width: "100%", height: 44, padding: "0 36px 0 12px", appearance: "none", WebkitAppearance: "none",
            borderRadius: "var(--r-md)", border: "1px solid var(--border)", background: "var(--surface-raised)",
            // System font, not async Poppins — the native option list can't
            // mis-measure and flash a scrollbar on first open. See SelectField.
            color: "var(--text)", fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontWeight: 700, fontSize: 16,
            cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1, outline: "none",
          }}>
          {opts.map((o) => (
            <option key={o} value={o} style={{ background: "#1E2B3A", color: "#fff", fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontSize: 16 }}>{o[0].toUpperCase() + o.slice(1)}</option>
          ))}
        </select>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}><path d="m6 9 6 6 6-6" /></svg>
      </div>
    </div>
  );
}
