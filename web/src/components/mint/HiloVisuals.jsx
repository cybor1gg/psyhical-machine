// MintBets Hilo — visual components v2.
// Side cards are fully server-driven: label, multiplier and win % arrive as a
// "call" object from the API. Supports the "Same" call on Ace/King.
import React from "react";
import { PlayingCard, rankLabel } from "./PlayingCard";

export function useHiloMobile() {
  const [m, setM] = React.useState(() => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 760px)").matches);
  React.useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 760px)");
    const f = () => setM(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", f); else mq.addListener(f);
    // Also track plain resize/orientation: some engines (and embedded webviews)
    // don't deliver matchMedia "change" reliably, which would otherwise leave
    // the desktop panel mounted on a phone-width screen.
    window.addEventListener("resize", f);
    window.addEventListener("orientationchange", f);
    f(); // resync in case the width changed between first render and mount
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", f); else mq.removeListener(f);
      window.removeEventListener("resize", f);
      window.removeEventListener("orientationchange", f);
    };
  }, []);
  return m;
}

// Short viewport = landscape phone. The portrait stack (topbar → history →
// table → tall control column) needs ~585px of height; a landscape phone gives
// ~360, which pushed the Bet button below the fold. Callers collapse to a
// single control row when this is true.
export function useShortViewport() {
  const q = "(max-height: 520px)";
  const [s, setS] = React.useState(() => typeof window !== "undefined" && window.matchMedia && window.matchMedia(q).matches);
  React.useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(q);
    const f = () => setS(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", f); else mq.addListener(f);
    window.addEventListener("resize", f);
    window.addEventListener("orientationchange", f);
    f();
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", f); else mq.removeListener(f);
      window.removeEventListener("resize", f);
      window.removeEventListener("orientationchange", f);
    };
  }, []);
  return s;
}

function CallArrow({ choice, size = 34, sw = 3.4, color }) {
  if (choice === "same") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round">
        <path d="M5 9h14M5 15h14" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {choice === "higher" ? <path d="M4 15l8-8 8 8" /> : <path d="M4 9l8 8 8-8" />}
    </svg>
  );
}

// ── the table: [low-side call] [deck] [high-side call] ──────
// calls: [highSide, lowSide] from the server (or null pre-bet)
export function HiloTable({ cur, faceDown, flash, active, calls, onCall, onSkip, skipEnabled }) {
  const mobile = useHiloMobile();
  // Mobile sizes: side height matches the deck column (deckW*1.4 + 22 = 218) so
  // the three columns read as one composed unit instead of the call cards
  // hanging 18px short of the deck. Natural row width is 376px, which the
  // self-scaler shrinks to ~0.94 on a 360px phone — an invisible downscale.
  const sideW = mobile ? 104 : 172, sideH = mobile ? 218 : 240;
  const deckW = mobile ? 140 : 188;
  const gap = mobile ? 10 : 42;
  // True rendered width of the row, plus a small breathing margin.
  const NAT_W = 2 * sideW + deckW + 2 * gap + 8;
  const NAT_H = Math.max(sideH + 30, Math.round(deckW * 1.4) + 22);
  const wrapRef = React.useRef(null);
  const [scale, setScale] = React.useState(1);

  // Fit the table to whatever space it actually has. This must not depend on
  // ResizeObserver alone: if RO is unavailable or its first callback is late,
  // the table would stay at scale(1) and spill off a phone screen. So measure
  // synchronously on layout and re-measure on resize/orientation as well.
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.clientWidth || (el.parentElement ? el.parentElement.clientWidth : 0);
      const ph = el.parentElement ? el.parentElement.clientHeight : NAT_H;
      const byWidth = w > 0 ? (w - 8) / NAT_W : 1;
      const byHeight = ph > 0 ? (ph - 12) / NAT_H : 1;
      const next = Math.min(1, byWidth, byHeight);
      // Guard against 0/negative during transient layouts (a collapsed flex
      // parent would otherwise set a negative scale and invert the table).
      setScale(Number.isFinite(next) && next > 0.2 ? next : 1);
    };

    measure();

    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
      if (el.parentElement) ro.observe(el.parentElement);
    }
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [NAT_W, NAT_H]);

  const hi = calls ? calls[0] : null;
  const lo = calls ? calls[1] : null;

  return (
    <div ref={wrapRef} style={{ width: "100%", display: "flex", justifyContent: "center", height: Math.round(NAT_H * scale) }}>
      <div style={{ display: "flex", alignItems: "center", gap, transform: `scale(${scale})`, transformOrigin: "center center" }}>
        <HiloCallCard call={lo} side="lo" active={active} onClick={() => lo && onCall(lo)} W={sideW} H={sideH} />
        <HiloDeck cur={cur} faceDown={faceDown} flash={flash} onSkip={onSkip} skipEnabled={skipEnabled} W={deckW} />
        <HiloCallCard call={hi} side="hi" active={active} onClick={() => hi && onCall(hi)} W={sideW} H={sideH} />
      </div>
    </div>
  );
}

// ── centre: card on deck, skip chip perched on the corner ───
export function HiloDeck({ cur, faceDown, flash, onSkip, skipEnabled, W = 188 }) {
  const H = Math.round(W * 1.4);
  return (
    <div style={{ position: "relative", width: W, height: H + 22, flex: "0 0 auto" }}>
      {[3, 2, 1].map((k) => (
        <div key={k} style={{ position: "absolute", left: 0, width: W, top: k * 6, height: H, borderRadius: 10,
          background: "linear-gradient(150deg, #2E8C68 0%, #1E6E50 48%, #154A37 100%)",
          border: "1.5px solid rgba(123,240,196,0.30)", boxShadow: "0 6px 14px rgba(0,0,0,0.4)", boxSizing: "border-box",
          overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: W * 0.1, borderRadius: W * 0.06, border: "1.5px solid rgba(166,230,206,0.22)" }} />
        </div>
      ))}
      <PlayingCard key={cur ? cur.id : "back"} card={cur} faceDown={faceDown} w={W} glow={flash} style={{ position: "absolute", top: 0, left: 0, borderRadius: 10 }} />
      <button onClick={onSkip} disabled={!skipEnabled} aria-label="Skip card" title="Skip card"
        onMouseEnter={(e) => { if (!skipEnabled) return; e.currentTarget.style.transform = "scale(1.08)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        // 44px: the minimum comfortable touch target — this chip is a real
        // game control (free re-deal), not decoration.
        style={{ position: "absolute", top: -19, right: -19, width: 44, height: 44, borderRadius: "50%",
          background: "linear-gradient(180deg, #5FDCA9 0%, #2E9E72 100%)", border: "2px solid #0E1512", color: "#0E1512",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: skipEnabled ? "pointer" : "default",
          opacity: skipEnabled ? 1 : 0.45,
          boxShadow: "0 5px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)",
          transition: "transform var(--dur-fast) var(--ease-out), opacity var(--dur-fast)", zIndex: 3 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5l7 7-7 7M13 5l7 7-7 7" /></svg>
      </button>
    </div>
  );
}

// ── clickable call card: label + multiplier + win % (server data only) ──
export function HiloCallCard({ call, side, active, onClick, W = 172, H = 240 }) {
  const isHi = side === "hi";
  const [hover, setHover] = React.useState(false);
  // touch feedback: phones have no hover, so the press itself must respond —
  // a quick sink on pointer-down makes the call feel instant
  const [pressed, setPressed] = React.useState(false);
  const isSame = call && call.choice === "same";
  const accent = isSame ? "var(--gold)" : isHi ? "var(--mint-bright)" : "#7DC0EE";
  const ringRGB = isSame ? "232,197,106" : isHi ? "84,214,166" : "125,192,238";
  const fillBg = isSame
    ? "radial-gradient(120% 90% at 50% -20%, rgba(232,197,106,0.20), transparent 55%), linear-gradient(168deg, #6B5A2C 0%, #4E421F 52%, #332B14 100%)"
    : isHi
    ? "radial-gradient(120% 90% at 50% -20%, rgba(123,240,196,0.20), transparent 55%), linear-gradient(168deg, #21755A 0%, #17553F 52%, #10382A 100%)"
    : "radial-gradient(120% 90% at 50% -20%, rgba(125,192,238,0.20), transparent 55%), linear-gradient(168deg, #2B6290 0%, #1E486C 52%, #16334E 100%)";

  const enabled = active && !!call;
  const labelLines = call ? call.label.split(" or ") : [isHi ? "Higher" : "Lower"];

  return (
    <button onClick={onClick} disabled={!enabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setPressed(false); }}
      onPointerDown={() => enabled && setPressed(true)}
      onPointerUp={() => setPressed(false)} onPointerCancel={() => setPressed(false)}
      style={{
        position: "relative", width: W, height: H, borderRadius: 8, cursor: enabled ? "pointer" : "default",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10,
        padding: "14px 10px", boxSizing: "border-box", flex: "0 0 auto",
        border: enabled ? `2.5px solid ${hover ? accent : `rgba(${ringRGB},0.4)`}` : "2.5px solid var(--border)",
        background: enabled ? fillBg : "transparent",
        color: enabled ? "#EAF5EF" : "var(--text-muted)",
        opacity: enabled ? 1 : 0.7,
        boxShadow: enabled ? (hover ? `0 0 0 4px rgba(${ringRGB},0.18), 0 14px 30px rgba(0,0,0,0.45)` : "0 8px 22px rgba(0,0,0,0.38)") : "none",
        transform: pressed ? "translateY(1px) scale(0.985)" : enabled && hover ? "translateY(-3px)" : "none",
        transition: "transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast), border-color var(--dur-fast), background var(--dur-base)",
      }}>
      <span style={{ position: "absolute", inset: 6, borderRadius: 4, border: `1px solid ${enabled ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)"}`, pointerEvents: "none" }} />

      <span style={{ width: 52, height: 52, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
        background: enabled ? `radial-gradient(circle at 50% 38%, rgba(${ringRGB},0.28), rgba(${ringRGB},0.10) 70%)` : "rgba(255,255,255,0.04)",
        border: `1.5px solid ${enabled ? `rgba(${ringRGB},0.45)` : "var(--border)"}` }}>
        <CallArrow choice={call ? call.choice : (isHi ? "higher" : "lower")} size={26} sw={3.2} color={enabled ? accent : "currentColor"} />
      </span>

      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 12.5, letterSpacing: "0.09em", textTransform: "uppercase", lineHeight: 1.35 }}>
        {labelLines.map((l, i) => <span key={i} style={{ opacity: i === 0 ? 1 : 0.75 }}>{l}</span>)}
      </span>

      <span key={call ? `${call.choice}-${call.multiplier}` : "none"}
        style={{ width: "88%", padding: "7px 0", borderRadius: 5, background: "rgba(8,14,12,0.5)",
        border: "1px solid rgba(255,255,255,0.09)", boxShadow: "inset 0 2px 6px rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 2,
        animation: "mb-pop-scale 260ms var(--ease-bounce)",
        fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 17,
        color: enabled ? "#fff" : "var(--text-muted)" }}>
        <span style={{ fontSize: 12, opacity: 0.65 }}>×</span>{call ? call.multiplier.toFixed(2) : "0.00"}
      </span>

      <span key={call ? `p-${call.choice}-${call.probability}` : "p-none"}
        style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 13.5, animation: "mb-fade-in 300ms var(--ease-out)", color: enabled ? accent : "var(--text-muted)" }}>
        {call ? (call.probability * 100).toFixed(2) + "%" : "\u2014"}
      </span>
    </button>
  );
}

// ── the design's full-width Skip button (bet panel / mobile controls) ──
export function SkipButton({ onClick, disabled = false, compact = false }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: compact ? "auto" : "100%", height: 40, padding: compact ? "0 14px" : 0,
        borderRadius: "var(--r-md)",
        border: `1px solid ${!disabled && hover ? "var(--mint-32)" : "var(--border)"}`,
        background: "var(--surface-raised)", color: disabled ? "var(--text-muted)" : "var(--text)",
        fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
        transition: "border-color var(--dur-fast) var(--ease-out), opacity var(--dur-fast)",
      }}>
      Skip card
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5l7 7-7 7M13 5l7 7-7 7" /></svg>
    </button>
  );
}

// ── history tray ─────────────────────────────────────────────
// Compact (phone) entries are text pills, not mini cards: just rank+suit in the
// suit's colour, with the outcome carried by the pill's tint (green won call,
// red bust, neutral start/skip) so it costs zero extra height. Whole strip must
// stay ≤ 44px so the table keeps the vertical space.
const PILL_SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" };
const PILL_RED = new Set(["H", "D"]);

function HiloPill({ e, last }) {
  const bust = e.tag === "bust";
  const won = e.win === true;
  return (
    <span style={{
      flex: "0 0 auto", height: 26, padding: "0 9px", borderRadius: 13, boxSizing: "border-box",
      display: "inline-flex", alignItems: "center",
      border: `1px solid ${bust ? "rgba(225,91,76,0.55)" : won ? "rgba(84,214,166,0.45)" : "var(--border)"}`,
      background: bust ? "rgba(225,91,76,0.16)" : won ? "rgba(84,214,166,0.12)" : "var(--surface-raised)",
      fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 12.5,
      lineHeight: 1, whiteSpace: "nowrap",
      color: PILL_RED.has(e.card.s) ? "#FF7B6B" : "#EAF5EF",
      animation: last ? "mb-pop-scale 260ms var(--ease-bounce)" : "none",
    }}>
      {rankLabel(e.card.r)}{PILL_SUIT[e.card.s]}
    </span>
  );
}

export function HiloHistory({ hist, compact = false }) {
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    // glide to the newest entry instead of snapping — the strip reads as one
    // continuous motion with the pill's pop-in
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [hist.length]);

  if (compact) {
    // 7px pad + 26px pill + 7px pad + 2px border = 42px total.
    return (
      <div style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", boxSizing: "border-box" }}>
        <div ref={scrollRef} style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto", scrollbarWidth: "none", padding: "7px 10px" }}>
          {hist.map((e, i) => <HiloPill key={e.card.id + i} e={e} last={i === hist.length - 1} />)}
        </div>
      </div>
    );
  }

  const CW = 88, CH = Math.round(CW * 1.4);
  const CHIP = 30;
  return (
    <div style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", padding: "16px 8px", boxSizing: "border-box" }}>
      <div ref={scrollRef} style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", scrollbarWidth: "thin", paddingBottom: 6, paddingTop: 4, paddingLeft: 14, paddingRight: 12 }}>
        {hist.map((e, i) => (
          <div key={e.card.id + i} style={{ position: "relative", width: CW, display: "flex", flexDirection: "column", alignItems: "center", gap: 9, flex: "0 0 auto", marginLeft: i === 0 ? 0 : 18 }}>
            {i > 0 && (
              <div style={{ position: "absolute", left: -(CHIP / 2 + 10), top: CH / 2 - CHIP / 2, width: CHIP, height: CHIP, borderRadius: 7, zIndex: 2,
                background: "#F6F9F7", boxShadow: "0 2px 7px rgba(0,0,0,0.4)", border: "1px solid rgba(0,0,0,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                {e.dir == null ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5A6B78" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5l7 7-7 7M13 5l7 7-7 7" /></svg>
                ) : e.dir === "same" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={e.win ? "#1E9E6A" : "var(--loss)"} strokeWidth="3.4" strokeLinecap="round"><path d="M5 9h14M5 15h14" /></svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={e.win ? "#1E9E6A" : "var(--loss)"} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                    {e.dir === "hi" ? <path d="M4 15l8-8 8 8" /> : <path d="M4 9l8 8 8-8" />}
                  </svg>
                )}
              </div>
            )}
            <PlayingCard card={e.card} w={CW} dealt={i === hist.length - 1} />
            <HiloBadge e={e} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function HiloBadge({ e }) {
  const base = { padding: "4px 11px", borderRadius: 5, fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", lineHeight: 1.25, color: "#fff", border: "1px solid rgba(255,255,255,0.16)", boxShadow: "0 2px 6px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.18)", textShadow: "0 1px 1px rgba(0,0,0,0.25)" };
  const green = "linear-gradient(180deg, #26BD81 0%, #178F62 100%)";
  const red = "linear-gradient(180deg, #E4604F 0%, #C24334 100%)";
  if (e.tag === "start") return <span style={{ ...base, fontFamily: "var(--font-display)", fontWeight: 600, background: green }}>Start</span>;
  if (e.tag === "skip") return <span style={{ ...base, fontFamily: "var(--font-display)", fontWeight: 600, background: "var(--surface-raised)", border: "1px solid var(--border)", boxShadow: "none", textShadow: "none", color: "var(--text)" }}>Skip</span>;
  if (e.tag === "bust") return <span style={{ ...base, background: red }}>0.00×</span>;
  return <span style={{ ...base, background: green }}>{Number(e.tag).toFixed(2)}×</span>;
}

// ── cashout popup ────────────────────────────────────────────
export function HiloWinPopup({ mult, amount, currency = "$" }) {
  const accent = "#37dd84";
  return (
    <div style={{ position: "absolute", left: "50%", top: "44%", transform: "translate(-50%,-50%)", zIndex: 45, pointerEvents: "none", animation: "rl-pop 360ms cubic-bezier(0.34,1.45,0.5,1)" }}>
      <div style={{ background: accent, borderRadius: 18, padding: 6, boxShadow: "0 20px 55px rgba(0,0,0,0.55)", minWidth: 236 }}>
        <div style={{ padding: "16px 30px 13px", textAlign: "center", fontFamily: "'Unbounded', var(--font-numeric)", fontWeight: 800, fontSize: 34, color: "#062018", letterSpacing: "-0.02em" }}>x{(mult || 0).toFixed(2)}</div>
        <div style={{ background: "#0e1014", border: `2px solid ${accent}`, borderRadius: 13, padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 17, color: "#fff" }}>{currency}{(amount || 0).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
