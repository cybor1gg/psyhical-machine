// Minimal flat-table baccarat pieces, matched to the reference screenshot.
// Hands are LEFT-ANCHORED in a fixed-width zone: card 1 lands at its final
// spot, card 2 beside it, a third extends right — NOTHING ever re-centres,
// so the value pill sits at one fixed point above the fan and never drifts
// during dealing. Cards reuse blackjack's SBJDealtCard (constant-size
// flights, silent flips, deal sound at mount). All artwork ours.
import React from "react";
import { SBJDealtCard } from "./StakeBJ";

// Baccarat hand value: A=1, 2-9 pip, tens/faces 0 — total modulo 10.
export function baccValue(cards) {
  let t = 0;
  for (const c of cards) {
    if (!c) continue;
    t += c.r >= 10 ? (c.r === 14 ? 1 : 0) : c.r;
  }
  return t % 10;
}

const PILL_H = 26;

// ── One side of the table ─────────────────────────────────────────────────
// The stack reserves the TWO-card footprint from the start (centred in a
// fixed zone), so the opening pair lands with zero movement. A third card
// grows the fan past the reservation and the centred layout shifts the
// first two — animated as a pure SIDEWAYS glide (blackjack's FLIP, and the
// stair keeps y constant so there is no vertical component). The pill is
// pinned to the zone and never moves.
export function SBaccHand({ cards, w = 72, value = null, result = null, z = 1 }) {
  const resColor =
    result === "win" ? "var(--mint-bright)"
    : result === "push" ? "var(--gold)" : null;
  const stair = Math.round(w * 0.18);
  const h = Math.round(w * 1.5);
  const twoW = w + Math.round(w * 0.58);   // reserved opening footprint
  const zoneW = Math.round(w * 2.3);       // covers the three-card fan

  const slotRefs = React.useRef([]);
  const prevPos = React.useRef({});
  React.useLayoutEffect(() => {
    if (cards.length === 0) { prevPos.current = {}; slotRefs.current = []; return; }
    slotRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const scale = el.offsetWidth ? r.width / el.offsetWidth : 1;
      const prev = prevPos.current[i];
      const ty = i * stair;
      if (prev && el.animate) {
        const dx = (prev.x - r.left) / scale;
        const dy = (prev.y - r.top) / scale;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          el.animate(
            [{ transform: `translate(${dx}px, ${dy + ty}px)` }, { transform: `translate(0px, ${ty}px)` }],
            { duration: 540, easing: "cubic-bezier(0.35,0,0.15,1)" }
          );
        }
      }
      prevPos.current[i] = { x: r.left, y: r.top };
    });
  }, [cards.length, w]);

  return (
    // own stacking context (isolation) + layer order: cards flying INTO this
    // hand can never paint over a higher-layered sibling hand's placed cards
    <div style={{ position: "relative", zIndex: z, isolation: "isolate", width: zoneW, paddingTop: PILL_H + 8, boxSizing: "content-box", flex: "0 0 auto", display: "flex", justifyContent: "center" }}>
      {value != null && (
        <span style={{
          position: "absolute", top: 0, left: "50%", transform: `translateX(calc(-50% + ${Math.round(w * 0.25)}px))`,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          minWidth: 44, height: PILL_H, padding: "0 15px", borderRadius: 999,
          background: resColor || "var(--surface-raised)", boxSizing: "border-box",
          fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums",
          fontWeight: 800, fontSize: 14.5, color: resColor ? "#0E1512" : "var(--text)",
          transition: "background 200ms ease, color 200ms ease",
          animation: "mb-pop-scale 160ms var(--ease-bounce)",
        }}>{value}</span>
      )}
      <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "flex-start", minWidth: twoW, minHeight: h + stair * 2 }}>
        {cards.map((card, i) => (
          <span key={i} ref={(el) => { slotRefs.current[i] = el; }}
            style={{ marginLeft: i === 0 ? 0 : -Math.round(w * 0.42), transform: `translate(0px, ${i * stair}px)`, zIndex: i, position: "relative", display: "flex" }}>
            <SBJDealtCard card={card} w={w} ringColor={resColor} />
          </span>
        ))}
      </div>
    </div>
  );
}

// ── "TIE PAYS 8 TO 1" ribbon — the reference's single-line banner ─────────
export const SBaccRibbon = React.memo(function SBaccRibbon({ compact = false }) {
  const wing = "color-mix(in srgb, var(--surface-raised) 55%, var(--ink))";
  const bar = "color-mix(in srgb, var(--surface-raised) 82%, var(--ink))";
  const ink = "color-mix(in srgb, var(--text-muted) 62%, var(--ink))";
  const wingW = compact ? 16 : 24, wingH = compact ? 21 : 28;
  return (
    <div aria-hidden="true" style={{ position: "relative", display: "flex", alignItems: "center", zIndex: 0, pointerEvents: "none", flex: "0 0 auto" }}>
      <span style={{ position: "absolute", left: -wingW + 4, top: 5, width: wingW, height: wingH, background: wing, clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%, 34% 50%)" }} />
      <span style={{ position: "absolute", right: -wingW + 4, top: 5, width: wingW, height: wingH, background: wing, clipPath: "polygon(0 0, 100% 0, 66% 50%, 100% 100%, 0 100%)" }} />
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center", height: wingH + 8, padding: compact ? "0 14px" : "0 20px", borderRadius: 6, background: bar, fontFamily: "'Unbounded', var(--font-display)", fontWeight: 700, fontSize: compact ? 8.5 : 11.5, letterSpacing: "0.12em", color: ink, whiteSpace: "nowrap" }}>
        TIE PAYS 8 TO 1
      </span>
    </div>
  );
});

// ── Win toast: multiplier over the payout in a glowing mint frame, popped
// dead-centre with a soft bounce — the reference's win presentation. ──────
export function SBaccWinToast({ mult, amount }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
      minWidth: 164, padding: "22px 30px", borderRadius: 16, boxSizing: "border-box",
      background: "var(--ink)", border: "3px solid var(--mint-bright)",
      boxShadow: "0 0 26px rgba(84,214,166,0.45), 0 10px 30px rgba(0,0,0,0.45)",
      animation: "mb-pop-scale 460ms var(--ease-bounce)",
    }}>
      <span style={{ fontFamily: "'Unbounded', var(--font-display)", fontWeight: 800, fontSize: 24, color: "var(--mint-bright)", letterSpacing: "0.02em" }}>
        {mult.toFixed(2)}×
      </span>
      <span aria-hidden="true" style={{ width: "72%", height: 1, background: "color-mix(in srgb, var(--text-muted) 40%, transparent)" }} />
      <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 17, color: "var(--mint-bright)" }}>
        ${amount.toFixed(2)}
      </span>
    </div>
  );
}

// ── Bet spot (Player / Tie / Banker): narrower and TALLER, thin border,
// label over the staked amount; the winner glows mint on settle. ──────────
export function SBaccSpot({ spot, amount, active, won, onPlace, mob }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={onPlace} disabled={!active}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        flex: 1, minWidth: 0, padding: mob ? "12px 4px" : "26px 6px",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
        borderRadius: 8, cursor: active ? "pointer" : "default",
        background: hover && active ? "color-mix(in srgb, var(--surface-raised) 70%, var(--ink))" : "color-mix(in srgb, var(--surface-raised) 45%, var(--ink))",
        border: won ? "2px solid var(--mint-bright)" : "1px solid color-mix(in srgb, var(--text-muted) 28%, transparent)",
        boxShadow: won ? "0 0 18px rgba(84,214,166,0.35)" : "none",
        boxSizing: "border-box", opacity: active || won ? 1 : 0.8,
        transition: "background 120ms ease, border-color 200ms ease, box-shadow 200ms ease",
      }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: mob ? 15.5 : 18, color: won ? "var(--mint-bright)" : "var(--text)" }}>{spot.label}</span>
      <span style={{
        minHeight: 16, display: "inline-flex", alignItems: "center",
        fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums",
        fontWeight: 700, fontSize: mob ? 12.5 : 13.5,
        color: amount > 0 ? "var(--mint-bright)" : "var(--text-muted)",
      }}>{amount > 0 ? `$${amount.toFixed(2)}` : "$0.00"}</span>
    </button>
  );
}
