// MintBets Blackjack — visual components, ported from the design system's
// Blackjack.jsx (shoe, DealtCard travel+flip, BJHand fan + value pill, action
// buttons, result banner). Server-driven: these render exactly what the API
// returned; no game math beyond summing VISIBLE pips for the value pill.
import React from "react";
import { PlayingCard } from "./PlayingCard";
import { sound } from "../../lib/sound";

// Measure a canvas element's height so card sizes can be derived from the
// space that actually exists (laptop iframes give ~500-640px canvases; the
// old fixed card widths overflowed and got clipped by the rounded canvas).
export function useCanvasHeight() {
  const ref = React.useRef(null);
  const [h, setH] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setH(el.clientHeight || 0);
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return [ref, h];
}

// Blackjack total of the VISIBLE cards — presentation only (the pill has to
// count up as cards land during the deal). Outcomes still come from the API.
export function handTotal(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (!c) continue;
    const v = c.r >= 14 ? 11 : c.r >= 11 ? 10 : c.r;
    total += v;
    if (v === 11) aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

// The table felt: a faint oval racetrack + the house-rules ribbon, centered
// and absolutely positioned so cards and dealing never shift it. Ported from
// the design's BJRibbon; the oval matches the reference layout.
export const BJTableFelt = React.memo(function BJTableFelt({ compact = false, dimmed = false }) {
  const ink = "color-mix(in srgb, var(--text-muted) 58%, var(--ink))";
  const inkFaint = "color-mix(in srgb, var(--text-muted) 32%, var(--ink))";
  const ruleW = compact ? 34 : 54;
  // Phones: a TRUE circle (aspect-ratio locked, so it stays round on every
  // width) — percentage insets scaled with the stage and read as an egg.
  const ring = (side, borderStyle) => compact
    ? { position: "absolute", left: side, right: side, top: "50%", transform: "translateY(-50%)", aspectRatio: "1 / 1", border: borderStyle, borderRadius: "50%", pointerEvents: "none" }
    : null;
  return (
    <>
      {/* racetrack ring */}
      <div aria-hidden="true" style={compact ? ring("4%", "1.5px solid rgba(143,163,181,0.10)") : {
        position: "absolute", inset: "8% 7%",
        border: "1.5px solid rgba(143,163,181,0.10)",
        borderRadius: "50%",
        pointerEvents: "none",
      }} />
      <div aria-hidden="true" style={compact ? ring("9%", "1px solid rgba(143,163,181,0.05)") : {
        position: "absolute", inset: "12% 12%",
        border: "1px solid rgba(143,163,181,0.05)",
        borderRadius: "50%",
        pointerEvents: "none",
      }} />
      {/* rules ribbon — dead centre, behind the cards; fades away while cards
          are on the table so the value pills never overlap the text */}
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: compact ? 8 : 12, zIndex: 0, pointerEvents: "none", animation: "mb-rise var(--dur-base) var(--ease-out)", opacity: dimmed ? 0 : 1, transition: "opacity 320ms var(--ease-out)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: compact ? 10 : 14 }}>
          <span aria-hidden="true" style={{ width: ruleW, height: 1, background: `linear-gradient(90deg, transparent, ${inkFaint})` }} />
          <span aria-hidden="true" style={{ fontSize: compact ? 11 : 14, lineHeight: 1, color: ink }}>♠</span>
          <span aria-hidden="true" style={{ width: ruleW, height: 1, background: `linear-gradient(90deg, ${inkFaint}, transparent)` }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: compact ? 4 : 6 }}>
          <span style={{ fontFamily: "'Unbounded', var(--font-display)", fontWeight: 700, fontSize: compact ? 10 : 14, letterSpacing: compact ? "0.1em" : "0.2em", color: ink, whiteSpace: "nowrap" }}>BLACKJACK PAYS 3 TO 2</span>
          <span style={{ fontFamily: "'Unbounded', var(--font-display)", fontWeight: 600, fontSize: compact ? 7.5 : 10, letterSpacing: compact ? "0.14em" : "0.26em", color: inkFaint, whiteSpace: "nowrap" }}>INSURANCE PAYS 2 TO 1</span>
        </div>
      </div>
    </>
  );
});

// Insurance decision — slides up when the dealer shows an ace. The premium is
// half the bet; the server resolves the peek only after this answer.
export function BJInsurancePrompt({ amount, onAnswer, busy }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
      padding: "14px 22px", borderRadius: "var(--r-xl)",
      background: "var(--ink)", border: "1px solid var(--border)",
      boxShadow: "var(--shadow-md)", zIndex: 5,
      animation: "mb-rise var(--dur-base) var(--ease-out)",
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mint-bright)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" /><path d="M9 12l2 2 4-4" /></svg>
        Take insurance?
      </span>
      <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", fontWeight: 600 }}>
        Pays 2 to 1 if the dealer has blackjack · Costs ${Number(amount).toFixed(2)}
      </span>
      <div style={{ display: "flex", gap: 8, width: "100%" }}>
        <BJActionButton label="Yes" tone="mint" onClick={() => onAnswer(true)} disabled={busy} />
        <BJActionButton label="No" tone="loss" onClick={() => onAnswer(false)} disabled={busy} />
      </div>
    </div>
  );
}

// The card shoe. `mid` centers it on the RIGHT EDGE of the felt (blackjack's
// dealing deck); default keeps the top-right corner (War). DealtCard reads
// this element's position so every card visibly travels OUT of the shoe.
export const BJShoe = React.memo(function BJShoe({ w = 74, mobile = false, mid = false }) {
  const pos = mid
    ? { top: "50%", right: mobile ? 0 : 14, transform: "translateY(-50%)" }
    : { top: mobile ? 10 : 16, right: mobile ? 10 : 18 };
  return (
    <div id="bj-shoe-origin" style={{ position: "absolute", ...pos, zIndex: 1, pointerEvents: "none" }}>
      {[2, 1, 0].map((k) => (
        <div key={k} style={{ position: "absolute", top: -k * 3, right: k * 2 }}>
          <PlayingCard card={null} faceDown w={w} dealt={false} style={{ boxShadow: "0 4px 10px rgba(0,0,0,0.35)" }} />
        </div>
      ))}
      {/* spacer so the absolute stack has size */}
      <div style={{ width: w, height: Math.round(w * 1.4) }} />
    </div>
  );
});

// Ported from the design's DealtCard: on mount the card animates from the
// shoe's real screen position to its slot (face-down), then flips to its
// value. A face-down card (the hole) flips in place the moment `card` arrives.
export function DealtCard({ card, w, delay = 0, style, ringColor = null, exiting = false }) {
  const outer = React.useRef(null);
  const inner = React.useRef(null);
  const dealtSound = React.useRef(false);
  const [revealed, setRevealed] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = outer.current;
    if (!el || !el.animate) return;
    // Once-guard: StrictMode re-runs this effect, and the re-run would both
    // double the sound AND measure the card while the first animation already
    // holds it at the deck — producing a second zero-length flight that
    // overrides the real one and pins the card in place.
    if (dealtSound.current) return;
    dealtSound.current = true;
    sound.cardDeal();
    let dx = 130, dy = -210, launch = 0.78;
    const cr = el.getBoundingClientRect();
    // The flight is measured in SCREEN pixels but animated in the element's
    // LOCAL pixels — under a scaled ancestor (mobile FitBox) those differ, and
    // uncompensated the card launches from the wrong spot and visibly jerks.
    const scale = el.offsetWidth ? cr.width / el.offsetWidth : 1;
    const shoe = document.getElementById("bj-shoe-origin");
    if (shoe) {
      const sr = shoe.getBoundingClientRect();
      dx = ((sr.left + sr.width / 2) - (cr.left + cr.width / 2)) / scale;
      dy = ((sr.top + sr.height / 2) - (cr.top + cr.height / 2)) / scale;
      // Launch at the DECK card's size (the deck is bigger than hand cards,
      // so the card shrinks into place) — it reads as the deck's top card.
      if (cr.width > 0) launch = Math.max(0.5, Math.min(1.6, sr.width / cr.width));
    }
    // Flight: a dense keyframe path (15 samples of an eased bézier arc), the
    // card upright the whole way. Baking ease-in-out into the SAMPLES keeps
    // per-segment interpolation linear and dirt-cheap, the slow start means
    // dropped frames on weak phones never read as a mid-air teleport, and it
    // is transform-only so the whole flight runs on the compositor. The 50ms
    // hold on the deck gives slow GPUs one frame to rasterize the card first.
    const N = 14;
    const bowX = -dy * 0.10, bowY = dx * 0.10; // gentle perpendicular arc
    const cxp = dx * 0.5 + bowX, cyp = dy * 0.5 + bowY;
    const frames = [];
    for (let i = 0; i <= N; i++) {
      const p = i / N;
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // easeInOutCubic
      const inv = 1 - e;
      const x = inv * inv * dx + 2 * inv * e * cxp;
      const y = inv * inv * dy + 2 * inv * e * cyp;
      const s = launch + (1 - launch) * e;
      frames.push({ transform: `translate(${x}px, ${y}px) scale(${s})`, offset: p });
    }
    el.animate(frames, { duration: 430, delay: delay + 50, easing: "linear", fill: "both" });
  }, []);

  // New-round sweep: the old cards fly BACK to the shoe (the reference's
  // round transition) — same scale-compensated vector as the entry, reversed.
  React.useEffect(() => {
    if (!exiting) return;
    const el = outer.current;
    if (!el || !el.animate) return;
    const cr = el.getBoundingClientRect();
    const scale = el.offsetWidth ? cr.width / el.offsetWidth : 1;
    let dx = 220, dy = -40;
    const shoe = document.getElementById("bj-shoe-origin");
    if (shoe) {
      const sr = shoe.getBoundingClientRect();
      dx = ((sr.left + sr.width / 2) - (cr.left + cr.width / 2)) / scale;
      dy = ((sr.top + sr.height / 2) - (cr.top + cr.height / 2)) / scale;
    }
    el.animate(
      [
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(9deg)`, opacity: 0.7 },
      ],
      { duration: 230, easing: "cubic-bezier(0.4,0,1,1)", fill: "forwards" }
    );
  }, [exiting]);

  // Flip when the face becomes known. On first appearance wait out the travel
  // so the card reaches its slot face-down, THEN flips — the dealt feel.
  //
  // BOTH faces are pre-rendered in a 3D flipper and the turn is ONE
  // compositor-side rotateY: no React state change, no DOM swap and no
  // rasterization happen during the animation, so the flip can't hitch even
  // on weak GPUs. `revealed` is only the fill-forward FALLBACK for throttled
  // tabs where the animation is swallowed (the animation overrides it).
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (!card || revealed) { firstRun.current = false; return; }
    const fl = inner.current;
    if (!fl || !fl.animate) { setRevealed(true); firstRun.current = false; return; }
    const travelDelay = firstRun.current ? delay + 500 : 60; // hold 50 + fly 430 + beat
    firstRun.current = false;
    const t1 = setTimeout(() => {
      // Ease-in-out with a subtle mid-turn lift: the card accelerates into the
      // turn and settles out of it — still ONE compositor animation.
      fl.animate(
        [
          { transform: "rotateY(0deg) scale(1)" },
          { transform: "rotateY(90deg) scale(1.06)", offset: 0.5 },
          { transform: "rotateY(180deg) scale(1)" },
        ],
        { duration: 300, easing: "cubic-bezier(0.45,0,0.25,1)", fill: "forwards" }
      );
      setTimeout(() => setRevealed(true), 380); // fallback only; animation wins
    }, travelDelay);
    return () => clearTimeout(t1);
  }, [card]);

  return (
    // will-change pre-promotes both animated wrappers to compositor layers —
    // older GPUs otherwise rasterize mid-flight and the first frames hitch
    <div ref={outer} style={{ willChange: "transform", ...style }}>
      <div ref={inner} style={{ position: "relative", display: "flex", willChange: "transform", transformStyle: "preserve-3d", transform: revealed ? "rotateY(180deg)" : "none" }}>
        <div style={{ backfaceVisibility: "hidden" }}>
          <PlayingCard card={null} faceDown w={w} dealt={false} />
        </div>
        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)", display: "flex" }}>
          <PlayingCard
            card={card || null} faceDown={!card}
            w={w} dealt={false}
            style={ringColor ? { boxShadow: `0 0 0 3px ${ringColor}, 0 6px 16px rgba(0,0,0,0.42)` } : undefined}
          />
        </div>
      </div>
    </div>
  );
}

// Overlapping fan with the total pill above. `cards` may contain null — a
// face-down slot (the hole card, which the server hasn't sent). Slots are
// keyed by POSITION: blackjack hands only append, so a slot whose card
// arrives later (the hole) flips in place instead of remounting.
export function BJHand({ cards, value = null, soft = false, result = null, doubled = false, w = 96, label: handLabel = null, active = false, exiting = false }) {
  const resColor =
    result === "win" || result === "blackjack" ? "var(--mint-bright)"
    : result === "lose" || result === "bust" ? "var(--loss)"
    : result === "push" ? "var(--gold)" : null;
  const overlap = -Math.round(w * 0.42);

  const holeHidden = cards.some((c) => !c);
  const shown = handTotal(cards);
  const total = value != null && !holeHidden ? value : (shown.total || null);
  const isSoft = value != null && !holeHidden ? soft : shown.soft;
  const label = total == null ? null
    : isSoft && total < 21 && total - 10 > 0 ? `${total - 10}, ${total}` : `${total}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
      {(handLabel || doubled) && (
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: active ? "var(--mint-bright)" : resColor || "var(--text-muted)" }}>
          {handLabel || ""}{doubled ? (handLabel ? " · 2×" : "2×") : ""}
        </span>
      )}
      <div style={{ height: 23, display: "flex", alignItems: "center", gap: 8 }}>
        {label != null && (
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 48, height: 23,
            padding: "0 16px", borderRadius: "var(--r-pill)",
            background: resColor || "var(--surface-raised)",
            border: resColor ? `1px solid ${resColor}` : active ? "1px solid var(--mint-32)" : "1px solid var(--border)",
            fontFamily: "'Unbounded', var(--font-numeric)", fontWeight: 700, fontSize: 13,
            color: resColor ? "#0E1512" : "var(--text)",
            animation: active ? "mb-glow-pulse 1.6s var(--ease-out) infinite" : "mb-pop-scale 220ms var(--ease-bounce)",
          }} key={label}>{label}{holeHidden ? "+" : ""}</span>
        )}
      </div>
      <div style={{ display: "flex", minHeight: Math.round(w * 1.4) + 14 }}>
        {cards.map((card, i) => (
          <span key={i} style={{ marginLeft: i === 0 ? 0 : overlap, marginTop: i * Math.round(w * 0.12) }}>
            <DealtCard card={card} w={w} ringColor={resColor} exiting={exiting} />
          </span>
        ))}
      </div>
    </div>
  );
}

// Hit (solid mint) / Stand (red outline) / Double (gold outline, ×2) — the
// design's BJAction palette. `stacked`: phone mode — icon above a small
// label so all four actions fit ONE row and the Bet button stays on screen.
export function BJActionButton({ label, tone = "mint", icon, onClick, disabled = false, stacked = false }) {
  const [hover, setHover] = React.useState(false);
  const colors = {
    mint: { bg: "var(--mint)", bgH: "var(--mint-bright)", fg: "#0E1512" },
    loss: { bg: "var(--surface-raised)", bgH: "var(--surface)", fg: "var(--loss)", bd: "var(--loss)" },
    gold: { bg: "var(--surface-raised)", bgH: "var(--surface)", fg: "var(--gold)", bd: "var(--gold)" },
    blue: { bg: "var(--surface-raised)", bgH: "var(--surface)", fg: "#7DC0EE", bd: "#5BA9E1" },
  }[tone];
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        flex: 1, minWidth: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
        flexDirection: stacked ? "column" : "row", gap: stacked ? 3 : 7,
        height: stacked ? 46 : 42, borderRadius: "var(--r-md)", cursor: disabled ? "default" : "pointer",
        background: disabled ? "var(--surface-raised)" : hover ? colors.bgH : colors.bg,
        color: disabled ? "var(--text-muted)" : colors.fg,
        border: colors.bd && !disabled ? `1.5px solid ${colors.bd}` : "1.5px solid transparent",
        opacity: disabled ? 0.55 : 1,
        fontFamily: "var(--font-display)", fontWeight: 700, fontSize: stacked ? 10 : 13.5,
        letterSpacing: stacked ? "0.03em" : "normal", textTransform: stacked ? "uppercase" : "none",
        transition: "background var(--dur-fast), transform var(--dur-fast), opacity var(--dur-fast)",
        transform: hover && !disabled ? "translateY(-1px)" : "none",
      }}>
      {icon}
      {label}
    </button>
  );
}

export const BJ_ICONS = {
  hit: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>,
  stand: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /></svg>,
  double: <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15, lineHeight: 1 }}>×2</span>,
  split: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H3v5M16 3h5v5M3 3l7 7M21 3l-7 7M12 10v11" /></svg>,
};

// Result banner — pops after the dealer reveal finishes. With split hands the
// headline follows the NET (the server's money is per-hand); an insurance
// outcome gets its own line so the math never looks mysterious.
export function BJBanner({ result, net, insurance = null }) {
  const map = {
    blackjack: { t: "Blackjack!", c: "var(--gold)" },
    win: { t: "You win", c: "var(--mint-bright)" },
    lose: { t: "Dealer wins", c: "var(--loss)" },
    bust: { t: "Bust", c: "var(--loss)" },
    push: { t: "Push", c: "var(--gold)" },
  };
  const m = map[result] || map.push;
  const pos = net > 0;
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 20px",
      borderRadius: 16, background: "var(--ink)", border: `2px solid ${m.c}`,
      animation: "mb-fade-in 160ms var(--ease-out)", zIndex: 4,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 17, color: m.c }}>{m.t}</span>
        <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 14, color: pos ? "var(--mint-bright)" : net < 0 ? "var(--loss)" : "var(--text-muted)" }}>
          {pos ? "+" : ""}${Math.abs(net).toFixed(2)}{net < 0 ? " lost" : ""}
        </span>
      </div>
      {insurance?.taken && (
        <span style={{ fontSize: "var(--fs-caption)", fontWeight: 600, color: insurance.result === "won" ? "var(--mint-bright)" : "var(--text-muted)" }}>
          {insurance.result === "won"
            ? `Insurance paid $${(insurance.amount * 3).toFixed(2)}`
            : `Insurance lost ($${Number(insurance.amount).toFixed(2)})`}
        </span>
      )}
    </div>
  );
}
