// MintBets Dice — visual components, ported from the design system's
// DiceBoard/DiceField. Server-driven: the board renders the roll the API
// returned; the only client math is display (multiplier/chance readouts).
import React from "react";

// One stat field. `editable` makes the value a typeable input that commits
// (parsed) on change/Enter/blur; otherwise it is a static readout.
export function DiceField({ label, value, suffix, onSwap, editable, onCommit, compact = false }) {
  const [buf, setBuf] = React.useState(null);
  const [focus, setFocus] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const inputRef = React.useRef(null);
  const commit = () => {
    if (buf !== null) { const n = parseFloat(buf); if (!isNaN(n) && onCommit) onCommit(n); setBuf(null); }
  };
  return (
    <div style={{ flex: 1, minWidth: compact ? 96 : 120, display: "flex", flexDirection: "column", gap: compact ? 5 : 8 }}>
      <span style={{ fontSize: "var(--fs-caption)", color: "var(--text)", fontWeight: 600 }}>{label}</span>
      <div
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onClick={() => { if (editable && inputRef.current) inputRef.current.focus(); }}
        style={{
          display: "flex", alignItems: "center", height: compact ? 40 : 46, padding: compact ? "0 10px" : "0 14px",
          background: "#2C3F53", cursor: editable ? "text" : "default",
          border: "1px solid " + (focus || (hover && editable) ? "var(--mint)" : "#3E5064"),
          boxShadow: focus ? "var(--ring)" : "none", borderRadius: "var(--r-md)",
          transition: "border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
        }}>
        {editable ? (
          <input ref={inputRef} type="text" inputMode="decimal" value={buf !== null ? buf : value}
            onFocus={(e) => { setFocus(true); setBuf(String(value)); requestAnimationFrame(() => { try { e.target.select(); } catch {} }); }}
            onChange={(e) => {
              let v = e.target.value.replace(/[^0-9.]/g, "");
              const i = v.indexOf(".");
              if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, "");
              setBuf(v);
              const n = parseFloat(v);
              if (!isNaN(n) && onCommit) onCommit(n);
            }}
            onBlur={() => { setFocus(false); commit(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { commit(); e.currentTarget.blur(); } }}
            style={{ flex: 1, minWidth: 0, width: "100%", background: "transparent", border: "none", outline: "none", color: "var(--text)", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 16, padding: 0 }} />
        ) : (
          <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: compact ? 14 : 16, color: "var(--text)" }}>{value}</span>
        )}
        {suffix && <span style={{ flex: "0 0 auto", marginLeft: 6, color: "var(--mint-bright)", fontFamily: "var(--font-numeric)", fontWeight: 700, fontSize: compact ? 15 : 17, lineHeight: 1 }}>{suffix}</span>}
        {onSwap && (
          <button onClick={onSwap} aria-label="Swap over/under"
            style={{ flex: "0 0 auto", marginLeft: 6, width: compact ? 26 : 30, height: compact ? 26 : 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-sm)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--mint-bright)", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--mint)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h15" /><path d="M16 6l3 3-3 3" /><path d="M20 15H5" /><path d="M8 12l-3 3 3 3" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

// Recent results pill row (shared by dice and limbo).
export function RecentPills({ rolls, fmt }) {
  return (
    <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "flex-end", gap: 8, minHeight: 34, overflow: "hidden" }}>
      {rolls.slice(0, 6).map((rr, i) => (
        <span key={rr.id} style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 54, height: 32, padding: "0 11px",
          borderRadius: 999, fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 13,
          opacity: i >= 4 ? 1 - (i - 3) * 0.28 : 1,
          background: rr.won ? "var(--mint)" : "var(--surface-raised)",
          border: rr.won ? "none" : "1px solid var(--border)",
          color: rr.won ? "#0E1512" : "var(--text-muted)",
          animation: i === 0 ? "mb-pop var(--dur-base) var(--ease-bounce)" : "none",
        }}>{fmt(rr)}</span>
      ))}
    </div>
  );
}

// The dice track: drag-to-set target, win/lose split colouring, and the die
// cube that tumbles across to its rolled value.
export function DiceBoard({ target, onTarget, over, roll, rollId, won, compact = false, charging = false }) {
  const trackRef = React.useRef(null);
  const dragging = React.useRef(false);
  const TRAVEL = 460;
  const [pos, setPos] = React.useState(null);
  const [animOn, setAnimOn] = React.useState(false);
  const [rolling, setRolling] = React.useState(false);
  const [display, setDisplay] = React.useState(roll);
  const lastPosRef = React.useRef(null);

  React.useEffect(() => {
    if (roll == null) return;
    const start = lastPosRef.current == null ? target : lastPosRef.current;
    setAnimOn(false);
    setPos(start);
    setRolling(true);
    // decelerating face flicker while the die tumbles across
    const timers = [];
    let t = 0;
    [34, 36, 40, 46, 56, 70, 90].forEach((g) => {
      t += g;
      timers.push(setTimeout(() => setDisplay(+(Math.random() * 100).toFixed(2)), t));
    });
    timers.push(setTimeout(() => { setDisplay(roll); setRolling(false); lastPosRef.current = roll; }, TRAVEL));
    let r2;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => { setAnimOn(true); setPos(roll); });
    });
    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(r1); if (r2) cancelAnimationFrame(r2); };
  }, [rollId]);

  // 0ms feedback: while the server answers, the cube tumbles in place with a
  // number scramble — the real travel takes over when the roll arrives
  React.useEffect(() => {
    if (!charging) return;
    setRolling(true);
    const iv = setInterval(() => setDisplay(+(Math.random() * 100).toFixed(2)), 64);
    return () => {
      clearInterval(iv);
      setRolling(false);
      setDisplay((d) => (roll != null ? d : null));
    };
  }, [charging]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFromX = (clientX) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left - 11) / (r.width - 22)));
    onTarget(Math.min(98, Math.max(2, +(2 + f * 96).toFixed(2))));
  };
  const onDown = (e) => { dragging.current = true; setFromX(e.clientX); try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} };
  const onMove = (e) => { if (dragging.current) setFromX(e.clientX); };
  const onUp = () => { dragging.current = false; };

  const cube = compact ? 50 : 62;
  return (
    <div style={{ position: "relative", padding: "0 11px" }}>
      {/* scale labels */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: compact ? 20 : 26, color: "var(--text)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: compact ? 13 : 16 }}>
        {[0, 25, 50, 75, 100].map((n) => (
          <span key={n} style={{ position: "relative", textAlign: "center" }}>
            {n}
            <span style={{ position: "absolute", left: "50%", top: "calc(100% + 8px)", transform: "translateX(-50%)", width: 2, height: 8, borderRadius: 2, background: "var(--border)" }} />
          </span>
        ))}
      </div>

      {/* track */}
      <div ref={trackRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        style={{ position: "relative", height: 26, padding: 6, borderRadius: 999, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "inset 0 2px 6px rgba(0,0,0,0.45)", cursor: "pointer", touchAction: "none" }}>
        <div style={{ position: "absolute", inset: 6, height: 14, borderRadius: 999, overflow: "hidden", display: "flex" }}>
          {over ? (
            <>
              <div style={{ width: `${target}%`, background: "linear-gradient(180deg, #E96B5C, var(--loss))" }} />
              <div style={{ flex: 1, background: "linear-gradient(180deg, var(--mint-bright), var(--mint))" }} />
            </>
          ) : (
            <>
              <div style={{ width: `${target}%`, background: "linear-gradient(180deg, var(--mint-bright), var(--mint))" }} />
              <div style={{ flex: 1, background: "linear-gradient(180deg, #E96B5C, var(--loss))" }} />
            </>
          )}
        </div>
        {/* thumb */}
        <div style={{ position: "absolute", top: "50%", left: `calc(${target}%)`, transform: "translate(-50%, -50%)", width: 32, height: 32, borderRadius: 10, background: "linear-gradient(180deg, #FFFFFF, #D7E6DD)", border: "1.5px solid rgba(70,180,140,0.55)", boxShadow: "0 4px 12px rgba(0,0,0,0.5), 0 0 0 3px rgba(70,180,140,0.16), inset 0 1px 2px rgba(255,255,255,0.9)", display: "flex", alignItems: "center", justifyContent: "center", gap: 2.5, pointerEvents: "none" }}>
          {[0, 1, 2].map((i) => <span key={i} style={{ width: 2.5, height: 13, borderRadius: 2, background: "linear-gradient(180deg, #7FA593, #5E8472)" }} />)}
        </div>
      </div>

      {/* dice cube result marker — tumbles & glides across the track.
          Motion is TRANSFORM-only (compositor; animating `left` re-laid the
          page out every frame = the jank), and the translate is clamped so
          the cube's edges stay fully visible at extreme rolls instead of
          being clipped by the board/FitBox bounds. */}
      {(roll != null || charging) && (
        <div style={{ position: "absolute", top: compact ? -28 : -36, left: 11, right: 11, height: 0, pointerEvents: "none" }}>
          <div style={{
            width: "100%",
            transform: `translateX(clamp(${cube / 2 - 11}px, ${(pos == null ? (roll != null ? roll : 50) : pos)}%, calc(100% - ${cube / 2 - 11}px)))`,
            transition: animOn ? "transform 460ms cubic-bezier(0.16,0.72,0.28,1)" : "none",
            willChange: "transform",
          }}>
          <div style={{ transform: "translateX(-50%)", width: cube }}>
          <div key={rollId} style={{
            position: "relative", width: cube, height: cube, borderRadius: 15,
            background: "linear-gradient(150deg, #FFFFFF 0%, #EEF5F1 52%, #D8E7E0 100%)",
            border: `2px solid ${rolling ? "rgba(176,198,189,0.7)" : (won ? "var(--mint)" : "var(--loss)")}`,
            boxShadow: `0 14px 28px rgba(0,0,0,0.55), 0 0 0 4px ${rolling ? "rgba(120,150,138,0.16)" : (won ? "rgba(70,180,140,0.24)" : "rgba(220,80,70,0.24)")}, inset 0 2px 3px rgba(255,255,255,0.95), inset 0 -3px 7px rgba(150,170,162,0.4)`,
            animation: rolling ? "mb-tumble 460ms cubic-bezier(0.2,0.7,0.26,1)" : "mb-pop 300ms var(--ease-bounce)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontFamily: "'Unbounded', var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: compact ? 13 : 16, letterSpacing: "-0.02em", color: rolling ? "#5C7066" : (won ? "var(--mint-deep)" : "var(--loss)") }}>
              {(display == null ? (roll != null ? roll : 0) : display).toFixed(2)}
            </span>
            <span style={{ position: "absolute", top: 4, left: 5, right: 5, height: Math.round(cube * 0.3), borderRadius: "10px 10px 16px 16px", background: "linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,255,255,0))", pointerEvents: "none" }} />
            {!rolling && <span style={{ position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%) rotate(45deg)", width: 14, height: 14, borderRadius: 3, background: "#D8E7E0", borderRight: `2px solid ${won ? "var(--mint)" : "var(--loss)"}`, borderBottom: `2px solid ${won ? "var(--mint)" : "var(--loss)"}` }} />}
          </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
