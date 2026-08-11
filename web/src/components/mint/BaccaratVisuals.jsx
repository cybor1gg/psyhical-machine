// MintBets Baccarat visuals — faithful port of the design system's Baccarat:
// navy felt + oval poker table, card shoe with fly-in/flip dealt cards, the
// three chip bet spots, the TIE ribbon and the win popup. The brain
// (BaccaratGame) owns state; everything here is presentation.
import React from "react";
import { sound } from "../../lib/sound";
import { PlayingCard } from "./PlayingCard";
import { ChipStack, fmtUSD } from "./ChipKit";

// Bet spots + their felt colours. mult = total returned on a win (incl. stake).
export const BACC_SPOTS = [
  { key: "player", label: "Player", odds: "1 : 1", mult: 2.0, color: "var(--azure)", bright: "#7DC0EE", glow: "rgba(90,166,232,0.22)" },
  { key: "tie", label: "Tie", odds: "8 : 1", mult: 9.0, color: "var(--gold)", bright: "#F2D789", glow: "rgba(232,197,106,0.22)" },
  { key: "banker", label: "Banker", odds: "0.95 : 1", mult: 1.95, color: "var(--mint)", bright: "var(--mint-bright)", glow: "rgba(70,180,140,0.22)" },
];

export function fmtMoney(n) {
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

// ── Card shoe (top-right) ────────────────────────────────────
export function BaccShoe({ count = 6, w = 88, mob }) {
  const n = Math.max(2, count), off = 3.5;
  const pos = mob
    ? { top: -44, bottom: "auto", right: 8 }
    : { top: "clamp(-64px,-7vh,-46px)", right: "clamp(24px,5vw,72px)" };
  return (
    <div aria-hidden="true" style={{ position: "absolute", ...pos, width: w, height: Math.round(w * 1.4) + (n - 1) * off, zIndex: 6, pointerEvents: "none" }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} id={i === n - 1 ? "bacc-shoe-origin" : undefined} style={{ position: "absolute", top: (n - 1 - i) * off, left: 0 }}>
          <PlayingCard faceDown w={w} dealt={false} style={{ boxShadow: "0 2px 6px rgba(0,0,0,0.20)" }} />
        </div>
      ))}
    </div>
  );
}

// ── A dealt card that flies in from the shoe on mount ─────────
// WAAPI animate from the shoe origin to the card's home spot, face-down, then
// flip to its value mid-arrival (scaleX squash) with a card-flip sound. The
// deal sound fires at the exact frame the card starts flying so click + motion
// stay in lockstep on every device.
export function BaccDealtCard({ card, w, wrapStyle, cardStyle }) {
  const outer = React.useRef(null);
  const inner = React.useRef(null);
  const dealtSound = React.useRef(false);
  const [revealed, setRevealed] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = outer.current;
    const fl = inner.current;
    // sound once only — a StrictMode re-run would double it
    if (!dealtSound.current) { dealtSound.current = true; sound.cardDeal(); }
    if (!el || !el.animate) { setRevealed(true); return; }
    // StrictMode re-runs this effect after running its cleanup (which killed
    // the reveal callbacks), so the re-run must fully redo the flight — but
    // FIRST cancel the old animation: measuring while it holds the card at
    // the shoe would compute a zero-length flight.
    for (const a of el.getAnimations()) a.cancel();
    let dx = 140, dy = -170, launch = 0.78;
    const cr = el.getBoundingClientRect();
    // screen px → the element's local px: compensate the mobile FitBox scale
    // or the card launches from the wrong spot and jerks
    const scale = el.offsetWidth ? cr.width / el.offsetWidth : 1;
    const shoe = document.getElementById("bacc-shoe-origin");
    if (shoe) {
      const sr = shoe.getBoundingClientRect();
      dx = ((sr.left + sr.width / 2) - (cr.left + cr.width / 2)) / scale;
      dy = ((sr.top + sr.height / 2) - (cr.top + cr.height / 2)) / scale;
      // launch at the shoe card's size and grow in flight — no size pop
      if (cr.width > 0) launch = Math.max(0.5, Math.min(1, sr.width / cr.width));
    }
    // 50ms hold on the shoe: a frame for slow GPUs to rasterize the fresh
    // card before motion. Ease-in-out start: even with dropped early frames
    // the card still visibly departs FROM the deck, never mid-air.
    const fly = el.animate([
      { transform: `translate(${dx}px, ${dy}px) rotate(4deg) scale(${launch})`, opacity: 1 },
      { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
    ], { duration: 330, delay: 50, easing: "cubic-bezier(0.4,0,0.22,1)", fill: "both" });
    // The turn is ONE compositor-side rotateY over pre-rendered faces — no
    // state change, DOM swap or rasterization mid-animation, so it can't
    // hitch on weak GPUs. `revealed` is only the fill-forward fallback for
    // throttled tabs where animations are swallowed.
    const done = { current: false };
    const onArrive = () => {
      if (done.current) return;
      done.current = true;
      if (fl && fl.animate) {
        // ease-in-out + subtle mid-turn lift — still one compositor animation
        fl.animate(
          [
            { transform: "rotateY(0deg) scale(1)" },
            { transform: "rotateY(90deg) scale(1.06)", offset: 0.5 },
            { transform: "rotateY(180deg) scale(1)" },
          ],
          { duration: 280, easing: "cubic-bezier(0.45,0,0.25,1)", fill: "forwards" }
        );
        setTimeout(() => { if (inner.current) setRevealed(true); }, 360); // fallback; animation wins
      } else {
        setRevealed(true);
      }
    };
    fly.onfinish = onArrive;
    // safety: if the fly-in's onfinish never fires (throttled/hidden tab),
    // reveal anyway once the flight time has clearly passed
    const safety = setTimeout(onArrive, 900);
    return () => { clearTimeout(safety); try { fly.onfinish = null; } catch { /* animation already gone */ } };
  }, []);
  return (
    // will-change: both wrappers animate (flight + flip) — pre-promote them
    <div ref={outer} style={{ display: "inline-block", willChange: "transform", ...wrapStyle }}>
      <div ref={inner} style={{ position: "relative", display: "flex", willChange: "transform", transformStyle: "preserve-3d", transform: revealed ? "rotateY(180deg)" : "none" }}>
        <div style={{ backfaceVisibility: "hidden" }}>
          <PlayingCard faceDown w={w} dealt={false} style={cardStyle} />
        </div>
        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)", display: "flex" }}>
          <PlayingCard card={card} faceDown={!card} w={w} dealt={false} style={cardStyle} />
        </div>
      </div>
    </div>
  );
}

// ── Centre ribbon: "TIE PAYS 8 TO 1" ─────────────────────────
export function BaccRibbon() {
  const tail = (dir) => (
    <div aria-hidden="true" style={{ width: 24, height: 34, background: "var(--surface)", border: "1px solid var(--border)", clipPath: "polygon(0 0, 100% 0, 62% 50%, 100% 100%, 0 100%, 38% 50%)", transform: dir === "left" ? "none" : "scaleX(-1)", opacity: 0.9 }} />
  );
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {tail("left")}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 34, padding: "0 clamp(24px,4vw,48px)", background: "var(--surface-raised)", border: "1px solid var(--border)", borderLeft: "none", borderRight: "none" }}>
        <span style={{ fontFamily: "'Unbounded', var(--font-display)", fontWeight: 700, fontSize: 13, letterSpacing: "0.14em", color: "var(--text-muted)", whiteSpace: "nowrap" }}>TIE PAYS 8 TO 1</span>
      </div>
      {tail("right")}
    </div>
  );
}

// ── Navy felt table backdrop ─────────────────────────────────
export function BaccFelt() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: -18, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 40%, #1D2E3D 0%, #182634 58%, #142130 100%)" }} />
      <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.5 }}>
        <g fill="none" stroke="rgba(123,200,240,0.08)" strokeWidth="1.3">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <path key={i} d={`M-40 ${130 + i * 74} C 250 ${70 + i * 74}, 430 ${210 + i * 68}, 600 ${160 + i * 70} S 980 ${80 + i * 74}, 1240 ${150 + i * 72}`} />
          ))}
        </g>
        <g fill="none" stroke="rgba(123,200,240,0.06)" strokeWidth="1.1">
          <ellipse cx="600" cy="350" rx="500" ry="300" />
          <ellipse cx="600" cy="350" rx="380" ry="215" />
        </g>
      </svg>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 42%, transparent 52%, rgba(8,14,20,0.5) 100%)" }} />
    </div>
  );
}

// ── Oval poker-felt table framing the two hands (like the War table) ──
export function BaccTableFelt({ mob }) {
  const ins = mob
    ? { top: -16, bottom: -16, left: "clamp(-34px,-5vw,-14px)", right: "clamp(-34px,-5vw,-14px)" }
    : { top: -46, bottom: -46, left: "clamp(-110px,-9vw,-40px)", right: "clamp(-110px,-9vw,-40px)" };
  return (
    <div aria-hidden="true" style={{ position: "absolute", ...ins, zIndex: 0, pointerEvents: "none" }}>
      {/* outer rim */}
      <div style={{ position: "absolute", inset: 0, borderRadius: 9999, background: "linear-gradient(180deg, rgba(40,60,78,0.55), rgba(24,38,52,0.55))", boxShadow: "0 18px 50px rgba(0,0,0,0.35)" }} />
      {/* felt bed */}
      <div style={{ position: "absolute", inset: 9, borderRadius: 9999, background: "radial-gradient(ellipse at 50% 42%, #20323F 0%, #1A2B38 55%, #15222E 100%)", border: "1.5px solid rgba(123,200,240,0.14)", boxShadow: "inset 0 6px 40px rgba(0,0,0,0.5)" }} />
      {/* inlaid arc */}
      <div style={{ position: "absolute", inset: 24, borderRadius: 9999, border: "1.5px solid rgba(123,200,240,0.16)" }} />
    </div>
  );
}

// ── A dealt hand: label, cards, total pill ────────────────────
export function BaccHand({ label, cards, total, result, tie, mob }) {
  const rc = result === "win" ? "var(--mint-bright)" : result === "loss" ? "var(--loss)" : null;
  const cardRc = tie ? "var(--gold)" : rc;
  const cardStyle = cardRc ? { boxShadow: `0 0 0 3px ${cardRc}, 0 8px 20px rgba(0,0,0,0.45)`, borderRadius: 12 } : {};
  const cw = mob ? 46 : 90;
  const overlap = mob ? -14 : -26;
  const handW = mob ? 112 : 220;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: mob ? 6 : 10, width: handW }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: mob ? 12 : 18, letterSpacing: mob ? "0.1em" : "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>{label}</span>
      <div style={{ display: "flex", justifyContent: "center", gap: 7, minHeight: mob ? 70 : 126, width: "100%" }}>
        {cards.length === 0 ? null : cards.map((card, i) => <BaccDealtCard key={card.id} card={card} w={cw} wrapStyle={{ position: "relative", marginLeft: i === 0 ? 0 : overlap, zIndex: i + 1 }} cardStyle={cardStyle} />)}
      </div>
      {cards.length > 0 && (
        <div style={{ marginTop: mob ? 4 : 14, display: "flex", alignItems: "center", justifyContent: "center", minWidth: mob ? 28 : 34, height: mob ? 20 : 24, padding: mob ? "0 8px" : "0 11px", borderRadius: 999, background: rc || "#93A4C4", border: `1.5px solid ${rc || "#93A4C4"}`, boxShadow: "none", fontFamily: "'Unbounded', var(--font-numeric)", fontWeight: 700, fontSize: mob ? 12 : 14, lineHeight: 1, color: "#0E1512", transition: "background var(--dur-base), color var(--dur-base), box-shadow var(--dur-base)" }}>
          {total != null ? total : "–"}
        </div>
      )}
    </div>
  );
}

// ── A bottom bet spot (place chips here) ─────────────────────
export function BaccSpot({ spot, amount, count, hit, active, won, onPlace, flex = 1, mob }) {
  const has = amount > 0;
  return (
    <div style={{ flex: flex, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <button onClick={() => active && onPlace()} disabled={!active} aria-label={`Bet on ${spot.label}`}
        style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: mob ? 3 : 5, padding: mob ? "7px 6px" : "9px 14px 9px", cursor: active ? "pointer" : "default",
          background: won ? "var(--surface-raised)" : has ? "var(--surface-raised)" : "var(--surface)",
          borderLeft: `1.5px solid ${won ? spot.bright : has ? spot.color : "var(--border)"}`,
          borderRight: `1.5px solid ${won ? spot.bright : has ? spot.color : "var(--border)"}`,
          borderBottom: `1.5px solid ${won ? spot.bright : has ? spot.color : "var(--border)"}`,
          borderTop: `3px solid ${spot.color}`,
          borderRadius: "var(--r-lg)",
          boxShadow: "none",
          transition: "border-color var(--dur-base), box-shadow var(--dur-base), background var(--dur-base)", outline: "none" }}>
        <div style={{ minHeight: mob ? 40 : 52, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div style={{ position: "relative", width: mob ? 38 : 46, height: mob ? 38 : 46, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
            border: `2px dashed ${has ? "transparent" : "rgba(147,164,196,0.28)"}`,
            transition: "border-color var(--dur-base)" }}>
            {has ? (
              <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}>
                <ChipStack amount={amount} count={count} size={mob ? 32 : 40} />
              </div>
            ) : (
              <span style={{ fontSize: mob ? 18 : 22, lineHeight: 1, fontWeight: 300, color: "rgba(147,164,196,0.4)" }}>+</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: mob ? 13 : 15, letterSpacing: "0.03em", color: won ? spot.bright : "var(--text)" }}>{spot.label}</span>
          <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: mob ? 11 : 12, color: won ? spot.bright : "var(--text-muted)", whiteSpace: "nowrap" }}>
            {won ? `+${fmtUSD(hit)}` : spot.odds}
          </span>
        </div>
      </button>
    </div>
  );
}

// ── Win popup (same treatment as the Roulette win popup) ──────
export function BaccWinPopup({ mult, amount, label }) {
  const accent = "#37dd84";
  const multColor = "#062018";
  return (
    <div style={{ position: "absolute", left: "50%", top: "46%", transform: "translate(-50%,-50%)", zIndex: 45, pointerEvents: "none", animation: "rl-pop 360ms cubic-bezier(0.34,1.45,0.5,1)" }}>
      <div style={{ background: accent, borderRadius: 18, padding: 6, boxShadow: "0 20px 55px rgba(0,0,0,0.55)", minWidth: 236 }}>
        <div style={{ padding: "16px 30px 13px", textAlign: "center", fontFamily: "'Unbounded', var(--font-numeric)", fontWeight: 800, fontSize: 34, color: multColor, letterSpacing: "-0.02em" }}>x{(mult || 0).toFixed(2)}</div>
        <div style={{ background: "#0e1014", border: `2px solid ${accent}`, borderRadius: 13, padding: "11px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 20 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#2A6FDB" /><path d="M12 6.2v11.6M9.4 9.1c0-1.3 1.2-2 2.6-2s2.6.6 2.6 1.9c0 2.8-5.2 1.3-5.2 4.1 0 1.3 1.2 2 2.6 2s2.6-.7 2.6-2" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 16, color: "#fff" }}>{fmtUSD(amount || 0)}</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 16, color: "#fff" }}>{label}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Total Bet field (editable; scales placed chips proportionally) ──
export function TotalBetField({ total, onSetTotal, disabled }) {
  const [focus, setFocus] = React.useState(false);
  const [str, setStr] = React.useState("");
  const display = focus ? str : (total > 0 ? fmtUSD(total) : "$0.00");
  return (
    <input type="text" inputMode="decimal" disabled={disabled}
      value={display}
      onChange={(e) => { let v = e.target.value.replace(/[^0-9.]/g, ""); const i = v.indexOf("."); if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, ""); setStr(v); onSetTotal(parseFloat(v) || 0); }}
      onFocus={() => { setFocus(true); setStr(total > 0 ? String(total) : ""); }}
      onBlur={() => setFocus(false)}
      style={{ width: 150, background: "transparent", border: "1px solid transparent", borderRadius: "var(--r-sm)", outline: "none", textAlign: "right", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 15, color: "var(--mint-bright)", padding: "2px 6px", cursor: disabled ? "default" : "text" }} />
  );
}

export function NeutralBtn({ children, onClick, disabled }) {
  const [h, setH] = React.useState(false);
  return (
    <button onClick={() => !disabled && onClick && onClick()} disabled={disabled} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ height: 40, borderRadius: "var(--r-md)", cursor: disabled ? "default" : "pointer", outline: "none", border: "1px solid var(--border)", background: disabled ? "var(--surface-raised)" : (h ? "var(--ink)" : "var(--surface-raised)"), color: disabled ? "var(--text-muted)" : "var(--text)", opacity: disabled ? 0.5 : 1, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--fs-sm)", transition: "background var(--dur-fast)" }}>
      {children}
    </button>
  );
}

export function feltActionStyle(disabled) {
  return { display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none", padding: "4px 6px", cursor: disabled ? "default" : "pointer", color: disabled ? "var(--border)" : "var(--text-muted)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, opacity: disabled ? 0.6 : 1, transition: "color var(--dur-fast)" };
}
