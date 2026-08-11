// Casino War — visual components, following the design system's War table.
// Reuses the blackjack kit's DealtCard (shoe travel + flip) and shoe.
import React from "react";
import { DealtCard } from "./BlackjackVisuals";
import { ChipStack, fmtUSD } from "./ChipKit";

// Felt: oval racetrack + War's own rules ribbon.
export function WarFelt({ compact = false }) {
  const ink = "color-mix(in srgb, var(--text-muted) 58%, var(--ink))";
  const inkFaint = "color-mix(in srgb, var(--text-muted) 32%, var(--ink))";
  const ruleW = compact ? 34 : 54;
  return (
    <>
      <div aria-hidden="true" style={{ position: "absolute", inset: compact ? "7% 4%" : "8% 7%", border: "1.5px solid rgba(143,163,181,0.10)", borderRadius: "50%", pointerEvents: "none" }} />
      <div aria-hidden="true" style={{ position: "absolute", inset: compact ? "11% 9%" : "12% 12%", border: "1px solid rgba(143,163,181,0.05)", borderRadius: "50%", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: compact ? 8 : 12, zIndex: 0, pointerEvents: "none", animation: "mb-rise var(--dur-base) var(--ease-out)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: compact ? 10 : 14 }}>
          <span aria-hidden="true" style={{ width: ruleW, height: 1, background: `linear-gradient(90deg, transparent, ${inkFaint})` }} />
          <span aria-hidden="true" style={{ fontSize: compact ? 11 : 14, lineHeight: 1, color: ink }}>⚔</span>
          <span aria-hidden="true" style={{ width: ruleW, height: 1, background: `linear-gradient(90deg, ${inkFaint}, transparent)` }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: compact ? 4 : 6 }}>
          <span style={{ fontFamily: "'Unbounded', var(--font-display)", fontWeight: 700, fontSize: compact ? 11 : 14, letterSpacing: compact ? "0.14em" : "0.2em", color: ink, whiteSpace: "nowrap" }}>HIGHEST CARD WINS</span>
          <span style={{ fontFamily: "'Unbounded', var(--font-display)", fontWeight: 600, fontSize: compact ? 8 : 10, letterSpacing: compact ? "0.18em" : "0.26em", color: inkFaint, whiteSpace: "nowrap" }}>DRAW TRIGGERS WAR · DRAW PAYS 10 TO 1</span>
        </div>
      </div>
    </>
  );
}

// One side of the table: label + a fixed two-card stage. Cards sit on
// transform offsets with a slow transition, so when a WAR card is dealt the
// first card SLIDES gently left to make room instead of jumping — and the
// stage width never changes, so the felt around it never reflows.
// `labelColor` overrides the label tint; `badge` renders the label as a bold
// result pill (Win / Lose / Surrender) that reads clearly over the felt text.
export function WarSlot({ label, cards, ringColor = null, w = 104, active = false, labelColor = null, badge = false }) {
  const H = Math.round(w * 1.4);
  const step = Math.round((w + 10) / 2); // half the two-card footprint
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9, zIndex: 1 }}>
      <span style={badge ? {
        fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15, letterSpacing: "0.12em", textTransform: "uppercase",
        color: labelColor || "var(--text)", padding: "4px 18px", borderRadius: 999,
        background: "var(--ink)", border: `1.5px solid ${labelColor || "var(--border)"}`,
        boxShadow: "0 4px 14px rgba(0,0,0,0.45)", animation: "mb-pop-scale 260ms var(--ease-bounce)",
      } : {
        fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase",
        color: labelColor || (active ? "var(--mint-bright)" : "var(--text-muted)"),
      }}>
        {label}
      </span>
      <div style={{ position: "relative", width: w * 2 + 10, height: H }}>
        {cards.map((card, i) => (
          <div key={i} style={{
            position: "absolute", left: "50%", top: 0,
            transform: `translateX(calc(-50% + ${cards.length < 2 ? 0 : i === 0 ? -step : step}px))`,
            transition: "transform 650ms var(--ease-out)",
          }}>
            <DealtCard card={card} w={w} ringColor={ringColor} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Tie decision — surrender for half, or raise and go to war.
export function WarPrompt({ warCost, surrenderReturns, onWar, onSurrender, busy }) {
  const btn = (label, sub, tone, onClick) => (
    <button onClick={onClick} disabled={busy}
      style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
        padding: "10px 16px", borderRadius: "var(--r-md)", cursor: busy ? "default" : "pointer",
        background: tone === "war" ? "linear-gradient(180deg, var(--mint-bright) 0%, var(--mint) 55%, var(--mint-deep) 100%)" : "var(--surface-raised)",
        border: tone === "war" ? "none" : "1.5px solid var(--loss)",
        color: tone === "war" ? "var(--text-on-accent)" : "var(--loss)",
        fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14,
        opacity: busy ? 0.55 : 1,
        boxShadow: tone === "war" ? "var(--glow-mint)" : "none",
      }}>
      {label}
      <span style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.8 }}>{sub}</span>
    </button>
  );
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
      padding: "14px 20px", borderRadius: "var(--r-xl)", zIndex: 5,
      background: "var(--ink)", border: "1px solid var(--gold)",
      boxShadow: "var(--shadow-md)", animation: "mb-pop var(--dur-base) var(--ease-bounce)",
    }}>
      <span style={{ fontFamily: "'Unbounded', var(--font-display)", fontWeight: 800, fontSize: 16, letterSpacing: "0.12em", color: "var(--gold)" }}>
        ⚔ WAR!
      </span>
      <div style={{ display: "flex", gap: 10, width: "100%", minWidth: 300 }}>
        {btn("Surrender", `take $${surrenderReturns.toFixed(2)} back`, "surrender", onSurrender)}
        {btn("Go to War", `raise $${warCost.toFixed(2)}`, "war", onWar)}
      </div>
    </div>
  );
}

// Desktop side-bet spot defs — same shape as Baccarat's BACC_SPOTS. Draw
// golds like Baccarat's Tie; Colour Draw takes the azure.
export const WAR_SIDE_SPOTS = [
  { key: "tie", label: "Draw", odds: "10 : 1", color: "var(--gold)", bright: "#F2D789" },
  { key: "ctie", label: "Colour Draw", odds: "20 : 1", color: "var(--azure)", bright: "#7DC0EE" },
];

// One clickable side-bet spot on the felt — a lean cousin of Baccarat's
// BaccSpot: chip well + label + odds; a settled hit swaps the odds for the
// +$ amount and brightens the ring.
export function WarSideSpot({ spot, amount, active, won, hit, onPlace, w = null }) {
  const has = amount > 0;
  const edge = won ? spot.bright : has ? spot.color : "var(--border)";
  return (
    // fixed `w` pins the spot into a felt corner; without it the spot flexes
    <div style={w ? { flex: "0 0 auto", width: w, display: "flex", flexDirection: "column" } : { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <button onClick={() => active && onPlace()} disabled={!active} aria-label={`Bet on ${spot.label}`}
        style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "9px 14px", cursor: active ? "pointer" : "default",
          background: won || has ? "var(--surface-raised)" : "var(--surface)",
          borderLeft: `1.5px solid ${edge}`, borderRight: `1.5px solid ${edge}`, borderBottom: `1.5px solid ${edge}`,
          borderTop: `3px solid ${spot.color}`,
          borderRadius: "var(--r-lg)",
          transition: "border-color var(--dur-base), background var(--dur-base)", outline: "none" }}>
        <div style={{ minHeight: 52, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div style={{ position: "relative", width: 46, height: 46, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
            border: `2px dashed ${has ? "transparent" : "rgba(147,164,196,0.28)"}`, transition: "border-color var(--dur-base)" }}>
            {has ? (
              <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}>
                <ChipStack amount={amount} size={40} />
              </div>
            ) : (
              <span style={{ fontSize: 22, lineHeight: 1, fontWeight: 300, color: "rgba(147,164,196,0.4)" }}>+</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15, letterSpacing: "0.03em", color: won ? spot.bright : "var(--text)" }}>{spot.label}</span>
          <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 12, color: won ? spot.bright : "var(--text-muted)", whiteSpace: "nowrap" }}>
            {won ? `+${fmtUSD(hit)}` : spot.odds}
          </span>
        </div>
      </button>
    </div>
  );
}

// Consecutive-tie streak chip — the ladder climber's progress bar.
export function StreakChip({ streak }) {
  if (!streak) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px",
      borderRadius: "var(--r-pill)", background: "var(--ink)", border: "1px solid var(--gold)",
      fontFamily: "'Unbounded', var(--font-display)", fontWeight: 700, fontSize: 10,
      letterSpacing: "0.12em", color: "var(--gold)", zIndex: 2,
      animation: "mb-pop-scale 260ms var(--ease-bounce)",
    }}>
      DRAW STREAK ×{streak}
    </span>
  );
}
