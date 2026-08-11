// Minimal-table blackjack presentation (the "originals" style your client
// asked for): flat surface, corner-index cards, stair-stacked hands with a
// side value pill, snappy short deals. Structure and pacing are measured
// from the reference; every asset here is our own drawing in the MintBets
// palette, and card backs keep the operator's white-label mark.
//
// Deliberately LIGHT: a face-up card is 4 DOM nodes (no pips), the table has
// no decoration layers, and every animation is transform-only (compositor).
import React from "react";
import { getBrandMark } from "../../lib/brand";
import { rankLabel, cardFromApi } from "./PlayingCard";
import { handTotal } from "./BlackjackVisuals";
import { sound } from "../../lib/sound";

export { cardFromApi, handTotal };

const SUIT_CHAR = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RED = new Set(["H", "D"]);

// ── Corner-index card ─────────────────────────────────────────────────────
// Face: BIG rank + suit stacked on the left (the reference proportions).
// Back: white card with an inset mint panel carrying the operator's mark.
export function SBJCard({ card, faceDown = false, w = 80, style }) {
  const h = Math.round(w * 1.5);
  const base = {
    width: w, height: h, borderRadius: Math.max(4, Math.round(w * 0.07)),
    position: "relative", flex: "0 0 auto", boxSizing: "border-box",
    boxShadow: "0 3px 8px rgba(0,0,0,0.35)",
    ...style,
  };
  if (faceDown || !card) {
    const mark = getBrandMark();
    const markFs = Math.max(5, Math.min(w * 0.11, (w * 0.9) / (1.15 * mark.length)));
    return (
      <div style={{ ...base, background: "#F2F6F3", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: Math.max(3, Math.round(w * 0.07)),
          borderRadius: Math.max(3, Math.round(w * 0.06)),
          background: "linear-gradient(150deg, #37A97D 0%, #1E6E50 58%, #16503B 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{
            fontFamily: "'Unbounded', var(--font-display)", fontWeight: 800, fontSize: markFs,
            letterSpacing: "0.14em", textTransform: "uppercase", whiteSpace: "nowrap",
            writingMode: "vertical-rl", transform: "rotate(180deg)", color: "rgba(11,46,33,0.55)",
          }}>{mark}</span>
        </div>
      </div>
    );
  }
  const red = RED.has(card.s);
  const ink = red ? "var(--loss)" : "#1B2733";
  return (
    <div style={{ ...base, background: "#FFFFFF", overflow: "hidden" }}>
      <div style={{
        position: "absolute", top: Math.round(w * 0.03), left: Math.round(w * 0.09),
        display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.02,
        color: ink, fontFamily: "var(--font-numeric)", fontWeight: 800,
      }}>
        <span style={{ fontSize: Math.round(w * 0.42), letterSpacing: "-0.03em" }}>{rankLabel(card.r)}</span>
        <span style={{ fontSize: Math.round(w * 0.40), marginTop: Math.round(w * 0.05) }}>{SUIT_CHAR[card.s]}</span>
      </div>
    </div>
  );
}

// ── Dealing deck: a WIDE fanned stack (card edges peeking out to the left),
// tight against the right edge and half-clipped by the table's TOP edge —
// the stage's overflow:hidden does the clipping.
export const SBJShoe = React.memo(function SBJShoe({ w = 72, right = 8 }) {
  const h = Math.round(w * 1.5);
  const LAYERS = 6, STEP = Math.max(2.5, w * 0.045);
  const fanW = w + Math.round((LAYERS - 1) * STEP);
  return (
    <>
      {/* the deck GRAPHIC pokes half-clipped out of the table's top edge */}
      <div aria-hidden="true" style={{ position: "absolute", top: -Math.round(h * 0.45), right, zIndex: 1, pointerEvents: "none" }}>
        {Array.from({ length: LAYERS }, (_, i) => LAYERS - 1 - i).map((k) => (
          <div key={k} style={{ position: "absolute", top: 0, right: k * STEP }}>
            <SBJCard faceDown w={w} />
          </div>
        ))}
        <div style={{ width: fanW, height: h }} />
      </div>
      {/* invisible LAUNCH ANCHOR fully inside the table: flights aim at this,
          so cards depart from the deck's visible bottom edge and are never
          cut by the clip line above */}
      <div id="sbj-shoe-origin" style={{ position: "absolute", top: 20, right, width: fanW, height: h, pointerEvents: "none" }} />
    </>
  );
});

// ── A dealt card: quick flight from the deck, then a fast silent flip ────
// Same proven machinery as the classic table (15-sample eased flight so a
// weak phone's dropped frames never read as teleports; 3D pre-rendered flip;
// StrictMode once-guard), tuned to the reference's snappy pace.
// `landRotate` (deg) rotates the card's VISIBLE face (baccarat's sideways
// third card) on an inner wrapper — the flight wrapper stays unrotated so
// the travel vector math is unaffected.
export function SBJDealtCard({ card, w, delay = 0, ringColor = null, landRotate = 0 }) {
  const outer = React.useRef(null);
  const inner = React.useRef(null);
  const dealtOnce = React.useRef(false);
  const [revealed, setRevealed] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = outer.current;
    if (!el || !el.animate) return;
    if (dealtOnce.current) return; // StrictMode re-run: keep the first flight
    dealtOnce.current = true;
    sound.cardDeal();
    let dx = 140, dy = -160;
    const cr = el.getBoundingClientRect();
    const scale = el.offsetWidth ? cr.width / el.offsetWidth : 1;
    const shoe = document.getElementById("sbj-shoe-origin");
    if (shoe) {
      const sr = shoe.getBoundingClientRect();
      dx = ((sr.left + sr.width / 2) - (cr.left + cr.width / 2)) / scale;
      dy = ((sr.top + sr.height / 2) - (cr.top + cr.height / 2)) / scale;
    }
    // CONSTANT size in flight — no launch scaling. The card travels at its
    // final size the whole way (the reference behavior); resizing mid-air
    // read as unnatural once the deck and hand cards diverged in size.
    const N = 12;
    const cxp = dx * 0.5 - dy * 0.06, cyp = dy * 0.5 + dx * 0.06;
    const frames = [];
    for (let i = 0; i <= N; i++) {
      const p = i / N;
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const inv = 1 - e;
      frames.push({
        transform: `translate(${inv * inv * dx + 2 * inv * e * cxp}px, ${inv * inv * dy + 2 * inv * e * cyp}px)`,
        offset: p,
      });
    }
    flightRef.current = el.animate(frames, { duration: 430, delay: delay + 30, easing: "linear", fill: "both" });
  }, []);

  const flightRef = React.useRef(null);
  React.useEffect(() => {
    if (!card || revealed) return;
    const fl = inner.current;
    if (!fl || !fl.animate) { setRevealed(true); return; }
    let dead = false, fired = false;
    const fire = () => {
      if (dead || fired) return;
      fired = true;
      fl.animate(
        [
          { transform: "rotateY(0deg) scale(1)" },
          { transform: "rotateY(90deg) scale(1.05)", offset: 0.5 },
          { transform: "rotateY(180deg) scale(1)" },
        ],
        { duration: 260, easing: "cubic-bezier(0.45,0,0.28,1)", fill: "forwards" }
      );
      setTimeout(() => setRevealed(true), 340); // fallback for throttled tabs
    };
    // Flip strictly AFTER the flight actually finished — keyed off the
    // animation's OWN completion (resolves immediately if already landed),
    // never a parallel timer: on a busy main thread the compositor can start
    // the flight late and a wall-clock timer would flip the card mid-air.
    const fa = flightRef.current;
    let t1;
    if (fa) {
      t1 = setTimeout(fire, delay + 980); // hard fallback for throttled tabs
      fa.finished
        .then(() => { if (!dead) { clearTimeout(t1); setTimeout(fire, 40); } })
        .catch(() => {});
    } else {
      t1 = setTimeout(fire, 60);
    }
    return () => { dead = true; clearTimeout(t1); };
  }, [card]);

  const flipper = (
    <div ref={inner} style={{ position: "relative", display: "flex", willChange: "transform", transformStyle: "preserve-3d", transform: revealed ? "rotateY(180deg)" : "none" }}>
      <div style={{ backfaceVisibility: "hidden" }}>
        <SBJCard faceDown w={w} />
      </div>
      <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)", display: "flex" }}>
        <SBJCard
          card={card || null} faceDown={!card} w={w}
          style={ringColor ? { boxShadow: `0 0 0 4px ${ringColor}, 0 4px 12px rgba(0,0,0,0.4)` } : undefined}
        />
      </div>
    </div>
  );
  return (
    <div ref={outer} style={{ willChange: "transform" }}>
      {landRotate ? <div style={{ display: "flex", transform: `rotate(${landRotate}deg)` }}>{flipper}</div> : flipper}
    </div>
  );
}

// ── Hand: value pill floating above-right, cards stair-stepping DOWN-right
// with heavy overlap (the reference layout). When a new card lands the hand
// re-centres — existing cards SLIDE to their new spot (FLIP) instead of
// jumping, which is what made the deal feel laggy.
const PILL_H = 26;
export function SBJHand({ cards, w, value = null, soft = false, result = null, active = false, doubled = false, finished = false }) {
  const resColor =
    result === "win" || result === "blackjack" ? "var(--mint-bright)"
    : result === "lose" || result === "bust" ? "var(--loss)"
    : result === "push" ? "var(--gold)" : null;

  const holeHidden = cards.some((c) => !c);
  const shown = handTotal(cards);
  const total = value != null && !holeHidden ? value : (shown.total || null);
  const isSoft = value != null && !holeHidden ? soft : shown.soft;
  // soft totals show both counts only while the hand is still being played —
  // a settled hand (any outcome, dealer included) shows its one final total
  const label = total == null ? null
    : !finished && result == null && isSoft && total < 21 && total - 10 > 0 ? `${total - 10}, ${total}` : `${total}`;

  const stair = Math.round(w * 0.18);
  const stackH = Math.round(w * 1.5) + stair * Math.max(0, cards.length - 1);

  // FLIP glide: remember each card slot's (and the pill's) screen position —
  // BOTH axes. When a new card mounts, the stack also gets TALLER (the stair
  // step), and a bottom-anchored hand shifts its old cards UP; compensating
  // only x made them hop up then slide left. Gliding the full (dx, dy) delta
  // moves them up-and-left TOGETHER as one smooth diagonal, the reference
  // motion. Duration/easing pair with the incoming card's flight.
  const slotRefs = React.useRef([]);
  const pillRef = React.useRef(null);
  const prevPos = React.useRef({});
  React.useLayoutEffect(() => {
    // fresh table (new round): forget old positions so the opening cards get
    // only their deck flight, never a leftover slide from last round's layout
    if (cards.length === 0) { prevPos.current = {}; slotRefs.current = []; return; }
    const glide = (el, dx, dy, ty) => el.animate(
      [{ transform: `translate(${dx}px, ${dy + ty}px)` }, { transform: `translate(0px, ${ty}px)` }],
      { duration: 540, easing: "cubic-bezier(0.35,0,0.15,1)" }
    );
    const track = (el, key, ty) => {
      const r = el.getBoundingClientRect();
      const scale = el.offsetWidth ? r.width / el.offsetWidth : 1;
      const prev = prevPos.current[key];
      if (prev && el.animate) {
        const dx = (prev.x - r.left) / scale;
        const dy = (prev.y - r.top) / scale;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) glide(el, dx, dy, ty);
      }
      prevPos.current[key] = { x: r.left, y: r.top };
    };
    slotRefs.current.forEach((el, i) => { if (el) track(el, i, i * stair); });
    // the pill drifts with the stack instead of snapping to the new edge
    if (pillRef.current) track(pillRef.current, "pill", 0);
  }, [cards.length, w]);

  return (
    <div style={{ position: "relative", display: "inline-flex", paddingTop: PILL_H + 6 }}>
      {label != null && (
        // NO remount key: the pill stays mounted so value changes update the
        // number in place (a remount replayed the pop and snapped the pill to
        // the stack's new edge — the visible "jump" in the deal)
        <span ref={pillRef} style={{
          position: "absolute", top: 0, right: -6, zIndex: 8,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          minWidth: 64, height: PILL_H, padding: "0 18px", borderRadius: 999,
          background: resColor || "var(--surface-raised)",
          border: active ? "1.5px solid var(--mint-bright)" : "1.5px solid transparent",
          boxSizing: "border-box",
          fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums",
          fontWeight: 800, fontSize: 14.5, color: resColor ? "#0E1512" : "var(--text)",
          transition: "background 200ms ease, color 200ms ease",
          animation: "mb-pop-scale 160ms var(--ease-bounce)",
        }}>{label}{doubled ? " ·2×" : ""}</span>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", minHeight: stackH }}>
        {cards.map((card, i) => (
          <span key={i} ref={(el) => { slotRefs.current[i] = el; }}
            style={{ marginLeft: i === 0 ? 0 : -Math.round(w * 0.5), transform: `translate(0px, ${i * stair}px)`, zIndex: i, position: "relative", display: "flex" }}>
            <SBJDealtCard card={card} w={w} ringColor={resColor} />
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Rules ribbon: banner bar with folded wing ends. PINNED to one fixed
// spot (16px below centre = half the pill headroom, which makes the visible
// dealer/player gaps equal in the standard state) — it NEVER moves, no
// matter what the hands grow to during dealing.
export const SBJRibbon = React.memo(function SBJRibbon({ compact = false }) {
  const wing = "color-mix(in srgb, var(--surface-raised) 55%, var(--ink))";
  const bar = "color-mix(in srgb, var(--surface-raised) 82%, var(--ink))";
  const ink = "color-mix(in srgb, var(--text-muted) 62%, var(--ink))";
  const inkFaint = "color-mix(in srgb, var(--text-muted) 40%, var(--ink))";
  const wingW = compact ? 16 : 24, wingH = compact ? 21 : 30;
  return (
    <div aria-hidden="true" style={{ position: "absolute", top: "calc(50% + 16px)", left: "50%", transform: "translate(-50%,-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: compact ? 5 : 7, zIndex: 0, pointerEvents: "none" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <span style={{ position: "absolute", left: -wingW + 4, top: 5, width: wingW, height: wingH, background: wing, clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%, 34% 50%)" }} />
        <span style={{ position: "absolute", right: -wingW + 4, top: 5, width: wingW, height: wingH, background: wing, clipPath: "polygon(0 0, 100% 0, 66% 50%, 100% 100%, 0 100%)" }} />
        <span style={{ position: "relative", display: "inline-flex", alignItems: "center", height: wingH + 8, padding: compact ? "0 14px" : "0 20px", borderRadius: 6, background: bar, fontFamily: "'Unbounded', var(--font-display)", fontWeight: 700, fontSize: compact ? 8.5 : 12.5, letterSpacing: compact ? "0.1em" : "0.12em", color: ink, whiteSpace: "nowrap" }}>
          BLACKJACK PAYS 3 TO 2
        </span>
      </div>
      <span style={{ fontFamily: "'Unbounded', var(--font-display)", fontWeight: 700, fontSize: compact ? 7 : 10, letterSpacing: compact ? "0.12em" : "0.14em", color: inkFaint, whiteSpace: "nowrap" }}>INSURANCE PAYS 2 TO 1</span>
    </div>
  );
});

// ── Uniform action button (the reference uses one neutral tone; each action
// gets its own accent-colored icon). `big` = the chunky phone variant.
export function SBJButton({ label, onClick, disabled = false, big = false, icon = null, iconColor = null }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        flex: 1, minWidth: 0, height: big ? 48 : 44, borderRadius: 8,
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: big ? 8 : 6,
        cursor: disabled ? "default" : "pointer",
        background: disabled ? "color-mix(in srgb, var(--surface-raised) 62%, var(--surface))" : hover ? "color-mix(in srgb, var(--surface-raised) 78%, white)" : "var(--surface-raised)",
        color: disabled ? "var(--text-muted)" : "var(--text)",
        border: "none", opacity: disabled ? 0.85 : 1,
        fontFamily: "var(--font-display)", fontWeight: 700, fontSize: big ? 14 : 13.5,
        transition: "background 120ms ease, transform 80ms ease",
        transform: hover && !disabled ? "translateY(-1px)" : "none",
      }}>
      {label}
      {icon && <span style={{ display: "inline-flex", color: disabled ? "var(--text-muted)" : (iconColor || "currentColor"), opacity: disabled ? 0.6 : 0.95, transform: big ? "scale(1.1)" : "none" }}>{icon}</span>}
    </button>
  );
}
