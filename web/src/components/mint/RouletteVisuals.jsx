// MintBets Roulette visuals — faithful port of the design system's Roulette:
// circular spinning wheel with ball physics, image-faithful betting table with
// hover coverage + split/corner inside bets, the vertical mobile table, and the
// win popup. The brain (RouletteGame) owns state; money always comes from the
// server — everything here is presentation.
import React from "react";
import { sound } from "../../lib/sound";
import { PlacedChip, fmtUSD } from "./ChipKit";

export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const RED_SET = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const numColor = (n) => (n === 0 ? "green" : RED_SET.has(n) ? "red" : "black");
export const pocketColor = numColor;
export const STEP = 360 / 37;
export const SPIN_S = 2.48; // wheel spin duration, matches the real recording

// Image-faithful palette (matches the reference exactly).
export const C = {
  bg: "#0d0e12",
  red: "#e0414b",
  dark: "#2b323e",
  green: "#1f9d40",
  outline: "#2a303b",
  outlineBg: "#15171d",
  text: "#ffffff",
  muted: "#c7ccd6",
  gold: "#f0c84a",
  goldRim: "#c79b3f",
  // wheel pocket shades
  wRedHi: "#cf4a4a", wRedLo: "#7e2f2f",
  wBlkHi: "#2c303a", wBlkLo: "#1d2027",
  wGrnHi: "#2ea24c", wGrnLo: "#1d7a38",
};

// Does bet return anything on pocket r? Mirror of the server's betMultiplier —
// used only for hover coverage and win highlights; money comes from the server.
export function rouletteWins(bet, r) {
  switch (bet.type) {
    case "straight": return bet.n === r ? 36 : 0;
    case "inside": return bet.ns && bet.ns.includes(r) ? 36 / bet.ns.length : 0;
    case "red": return r !== 0 && RED_SET.has(r) ? 2 : 0;
    case "black": return r !== 0 && !RED_SET.has(r) ? 2 : 0;
    case "odd": return r !== 0 && r % 2 === 1 ? 2 : 0;
    case "even": return r !== 0 && r % 2 === 0 ? 2 : 0;
    case "low": return r >= 1 && r <= 18 ? 2 : 0;
    case "high": return r >= 19 && r <= 36 ? 2 : 0;
    case "dozen": return r >= bet.n * 12 - 11 && r <= bet.n * 12 ? 3 : 0;
    case "column": return r !== 0 && r % 3 === (bet.n === 3 ? 0 : bet.n) ? 3 : 0;
    default: return 0;
  }
}

// Felt navy contour backdrop — identical to the War game table.
export function RouletteFelt() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: -18, zIndex: 0, pointerEvents: "none", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 42%, #1B2B3A 0%, #182634 58%, #142130 100%)" }} />
      <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.5 }}>
        <g fill="none" stroke="rgba(123,200,240,0.09)" strokeWidth="1.4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <path key={i} d={`M-40 ${120 + i * 70} C 250 ${60 + i * 70}, 420 ${200 + i * 64}, 600 ${150 + i * 66} S 980 ${70 + i * 70}, 1240 ${140 + i * 68}`} />
          ))}
        </g>
        <g fill="none" stroke="rgba(123,200,240,0.07)" strokeWidth="1.2">
          <ellipse cx="600" cy="350" rx="500" ry="300" />
          <ellipse cx="600" cy="350" rx="380" ry="215" />
        </g>
      </svg>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 42%, transparent 50%, rgba(8,14,20,0.5) 100%)" }} />
    </div>
  );
}

export function ctrlBtn(disabled) {
  return { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: 0, cursor: disabled ? "default" : "pointer", color: C.muted, opacity: disabled ? 0.4 : 1, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13.5, letterSpacing: "0.01em" };
}
export function UndoIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></svg>;
}
export function ClearIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></svg>;
}

// ── Circular wheel ───────────────────────────────────────────
function sector(cx, cy, rIn, rOut, a0, a1) {
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0o, y0o] = p(rOut, a0), [x1o, y1o] = p(rOut, a1);
  const [x1i, y1i] = p(rIn, a1), [x0i, y0i] = p(rIn, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0o} ${y0o} A${rOut} ${rOut} 0 ${large} 1 ${x1o} ${y1o} L${x1i} ${y1i} A${rIn} ${rIn} 0 ${large} 0 ${x0i} ${y0i} Z`;
}

const CX = 190, CY = 190;
const R_OUT = 166, R_MID = 143, R_IN = 119, R_NUM = 154;

export function RouletteWheel({ spinning, pocket = null, ball, onLanded, mobile }) {
  // The wheel spins at a CONSTANT speed forever — no per-round wheel
  // animation at all (the reference behavior). Only the BALL animates: it
  // orbits while the server answers, then decelerates into the winning
  // pocket and SEATS there, riding the wheel. One rAF loop drives both
  // transforms imperatively — zero React re-renders during the spin.
  const rotor = React.useRef(null);
  const ballRef = React.useRef(null);
  const st = React.useRef({ wheelA: -45, ballA: 90, mode: "hidden", drop: null, seatIdx: null });
  const cbRef = React.useRef(onLanded);
  cbRef.current = onLanded;

  // The ball is an HTML dot moved by a percent translate on its full-size
  // wrapper — pure compositor work. (SVG cx/cy writes re-render the SVG every
  // frame on iOS Safari, which is what made the spin feel laggy on phones.)
  const moveBall = (x, y) => {
    const b = ballRef.current;
    if (!b) return;
    b.style.transform = `translate(${(((x - CX) / 380) * 100).toFixed(3)}%, ${(((y - CY) / 380) * 100).toFixed(3)}%)`;
    b.style.visibility = "visible";
  };
  const hideBall = () => { if (ballRef.current) ballRef.current.style.visibility = "hidden"; };

  // pocket known → begin the drop (timed so the ball glides continuously
  // from its orbit into the pocket's LIVE position)
  React.useEffect(() => {
    if (pocket == null) return;
    const s = st.current;
    const idx = Math.max(0, WHEEL_ORDER.indexOf(pocket));
    const pocketAbs = s.wheelA + (-90 + idx * STEP);
    const offset0 = (((s.ballA - pocketAbs) % 360) + 360) % 360 + 720;
    s.drop = { t0: performance.now(), D: SPIN_S * 1000, total: offset0, idx, dropAt: 0.5 + Math.random() * 0.06, hop: 0 };
    s.mode = "drop";
  }, [pocket]);

  React.useEffect(() => {
    const s = st.current;
    if (spinning && (s.mode === "hidden" || s.mode === "seated")) { s.mode = "orbit"; s.seatIdx = null; }
    // Hide the ball whenever it is neither spinning nor a landed result AND no
    // drop is in flight. This also covers a CANCELLED spin: if the bet is
    // rejected, `spinning` goes false while the ball is still orbiting with no
    // pocket (s.drop == null) — previously "orbit" was excluded here, so the
    // ball orbited forever ("unending spin").
    if (!spinning && !ball && s.drop == null && s.mode !== "hidden") { s.mode = "hidden"; s.seatIdx = null; hideBall(); }
  }, [spinning, ball]);

  React.useEffect(() => {
    let raf, last = null;
    const WHEEL_SPEED = 100;                 // deg/s — brisk, constant
    const epoch = performance.now();
    const A0 = st.current.wheelA;
    const f = (x) => 1 - Math.pow(1 - x, 1.8);
    const tick = (ts) => {
      const s = st.current;
      const dt = last == null ? 0 : Math.min(0.1, (ts - last) / 1000);
      last = ts;
      // time-based, not per-frame accumulation: the speed stays true even
      // when frames are sparse (throttled tabs, weak devices)
      s.wheelA = A0 + WHEEL_SPEED * ((ts - epoch) / 1000);
      if (rotor.current) rotor.current.style.transform = `rotate(${s.wheelA}deg)`;
      if (s.mode === "orbit") {
        s.ballA -= 250 * dt;                 // counter-rotating orbit
        const a = s.ballA * Math.PI / 180;
        moveBall(CX + 167 * Math.cos(a), CY + 167 * Math.sin(a));
      } else if (s.mode === "drop" && s.drop) {
        const d = s.drop;
        const p = Math.min(1, (ts - d.t0) / d.D);
        const pocketAbs = s.wheelA + (-90 + d.idx * STEP);
        s.ballA = pocketAbs + d.total * (1 - f(p));
        const q = p < d.dropAt ? 0 : (p - d.dropAt) / (1 - d.dropAt);
        // descent, then three decaying hops before the ball settles — each
        // segment starts and ends on the seat radius so the path is continuous
        let r;
        if (q < 0.38) { const k = q / 0.38; r = 167 + (128 - 167) * (k * k * (3 - 2 * k)); }
        else if (q < 0.62) r = 128 + 15 * Math.sin(Math.PI * (q - 0.38) / 0.24);
        else if (q < 0.82) r = 128 + 8 * Math.sin(Math.PI * (q - 0.62) / 0.20);
        else r = 128 + 3.5 * Math.sin(Math.PI * (q - 0.82) / 0.18);
        // one muted thud per touchdown, at the moment the hop begins; if
        // frames were starved past a boundary, skip that hop's sound rather
        // than stacking late thuds
        const HOPS = [0.38, 0.62, 0.82];
        while (d.hop < 3 && q >= HOPS[d.hop]) {
          if (q - HOPS[d.hop] < 0.12) sound.ballHop(d.hop);
          d.hop++;
        }
        const a = s.ballA * Math.PI / 180;
        moveBall(CX + r * Math.cos(a), CY + r * Math.sin(a));
        if (p >= 1) {
          s.mode = "seated";
          s.seatIdx = d.idx;
          s.drop = null;
          sound.ballLand(); // fires exactly as the ball seats
          if (cbRef.current) cbRef.current();
        }
      } else if (s.mode === "seated" && s.seatIdx != null) {
        const a = (s.wheelA + (-90 + s.seatIdx * STEP)) * Math.PI / 180;
        moveBall(CX + 128 * Math.cos(a), CY + 128 * Math.sin(a));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const half = (STEP / 2) * Math.PI / 180;
  const pockets = WHEEL_ORDER.map((n, i) => {
    const midDeg = -90 + i * STEP;
    const mid = midDeg * Math.PI / 180;
    return { n, i, mid, midDeg, a0: mid - half, a1: mid + half, col: numColor(n) };
  });
  const hi = { red: C.wRedHi, black: C.wBlkHi, green: C.wGrnHi };
  const lo = { red: C.wRedLo, black: C.wBlkLo, green: C.wGrnLo };

  return (
    <div style={{ position: "relative", width: mobile ? "min(92vw, 54vh, 430px)" : "min(37vh, 300px)", height: mobile ? "min(92vw, 54vh, 430px)" : "min(37vh, 300px)", maxWidth: mobile ? "94%" : "82%", flex: "0 0 auto" }}>
      <svg viewBox="0 0 380 380" width="100%" height="100%" style={{ position: "absolute", inset: 0, display: "block" }}>
        <circle cx={CX} cy={CY} r={184} fill="none" stroke="#1c1f27" strokeWidth="2" />
        <circle cx={CX} cy={CY} r={178} fill="#15171d" />
      </svg>
      {/* rotor: HTML div, transform written imperatively by the loop */}
      <div ref={rotor} style={{ position: "absolute", inset: 0, willChange: "transform", backfaceVisibility: "hidden" }}>
        <svg viewBox="0 0 380 380" width="100%" height="100%" style={{ display: "block" }}>
          <g>
            <circle cx={CX} cy={CY} r={R_OUT + 4} fill="none" stroke={C.goldRim} strokeWidth="5" />
            {pockets.map((p) => (
              <path key={"lo" + p.i} d={sector(CX, CY, R_IN, R_MID, p.a0, p.a1)} fill={lo[p.col]} />
            ))}
            {pockets.map((p) => (
              <path key={"hi" + p.i} d={sector(CX, CY, R_MID, R_OUT, p.a0, p.a1)} fill={hi[p.col]} stroke="rgba(0,0,0,0.45)" strokeWidth="0.6" />
            ))}
            {pockets.map((p) => {
              const x1 = CX + R_IN * Math.cos(p.a0), y1 = CY + R_IN * Math.sin(p.a0);
              const x2 = CX + R_OUT * Math.cos(p.a0), y2 = CY + R_OUT * Math.sin(p.a0);
              return <line key={"sep" + p.i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(0,0,0,0.5)" strokeWidth="1" />;
            })}
            <circle cx={CX} cy={CY} r={R_IN} fill="none" stroke={C.goldRim} strokeWidth="4" />
            <circle cx={CX} cy={CY} r={R_IN - 10} fill="#101218" />
            {pockets.map((p) => {
              const x = CX + R_NUM * Math.cos(p.mid), y = CY + R_NUM * Math.sin(p.mid);
              return (
                <text key={"t" + p.i} x={x} y={y} fill="#fff" fontFamily="'Unbounded', sans-serif" fontWeight="700" fontSize="13"
                  textAnchor="middle" dominantBaseline="central" transform={`rotate(${p.midDeg + 90} ${x} ${y})`}>{p.n}</text>
              );
            })}
            <Spider cx={CX} cy={CY} />
          </g>
        </svg>
      </div>
      {/* ball layer — HTML dot on a compositor-only percent translate */}
      <div ref={ballRef} data-ball="1" style={{ position: "absolute", inset: 0, pointerEvents: "none", willChange: "transform", backfaceVisibility: "hidden", visibility: "hidden" }}>
        <div style={{ position: "absolute", left: "50%", top: "50%", width: "3.4%", aspectRatio: "1 / 1", transform: "translate(-50%, -50%)", borderRadius: "50%", background: "radial-gradient(circle at 38% 32%, #FFFFFF 0%, #E9EDF2 60%, #C9D2DB 100%)", boxShadow: "0 1px 3px rgba(0,0,0,0.55)" }} />
      </div>
    </div>
  );
}

function Spider({ cx, cy }) {
  const arms = [45, 135, 225, 315];
  const L = 66;
  return (
    <g>
      <defs>
        <radialGradient id="rlGold" cx="40%" cy="36%" r="68%">
          <stop offset="0%" stopColor="#FCEAA6" />
          <stop offset="46%" stopColor="#E8BF57" />
          <stop offset="100%" stopColor="#9A772C" />
        </radialGradient>
      </defs>
      {/* slim tapered spokes */}
      {arms.map((a) => {
        const rad = a * Math.PI / 180;
        const x = cx + L * Math.cos(rad), y = cy + L * Math.sin(rad);
        return (
          <g key={a}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="url(#rlGold)" strokeWidth="3" strokeLinecap="round" />
            <circle cx={x} cy={y} r="4" fill="url(#rlGold)" />
          </g>
        );
      })}
      {/* metallic center turret */}
      <circle cx={cx} cy={cy} r={21} fill="#13151b" />
      <circle cx={cx} cy={cy} r={18} fill="url(#rlGold)" />
      <circle cx={cx} cy={cy} r={10.5} fill="#13151b" />
      <circle cx={cx} cy={cy} r={5.5} fill="url(#rlGold)" />
      <circle cx={cx - 2} cy={cy - 2.6} r={1.7} fill="#FFF6D6" opacity="0.85" />
    </g>
  );
}

// ── Vertical table (mobile alt layout) ───────────────────────
// One unified 5-col × 14-row grid sized so the whole board always fits the
// screen with no scrolling. `place(key, bet)` matches the server payload.
export function RouletteVerticalTable({ bets, place, result, settled, recent, undo, clearBets, spinning, canUndo, totalStaked }) {
  const vtext = { transform: "rotate(90deg)", display: "inline-block", whiteSpace: "nowrap" };
  const wrapRef = React.useRef(null);
  const [box, setBox] = React.useState({ w: 360, h: 560 });
  React.useLayoutEffect(() => {
    const measure = () => {
      const el = wrapRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const h = Math.max(240, Math.min(window.innerHeight - r.top - 8, el.clientHeight));
      setBox({ w: el.clientWidth, h });
    };
    measure();
    const id = setTimeout(measure, 140);
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("resize", measure); clearTimeout(id); };
  }, []);
  const gap = 3;
  const innerW = box.w - 44, innerH = box.h - 6;
  const cellW = (innerW - 44 - gap - 4 * gap) / 5;
  const cellH = (innerH - 13 * gap) / 14.5;
  const cellPx = Math.max(22, Math.min(80, Math.floor(Math.min(cellW, cellH))));
  const rowPx = Math.max(cellPx, Math.min(150, Math.floor(cellH)));
  const rowH = rowPx + "px";
  const bottomH = Math.round(rowPx * 1.3) + "px";
  const zeroH = Math.round(rowPx * 1.2) + "px";
  const chip = Math.max(26, Math.round(cellPx * 0.6));
  const sideWpx = Math.max(28, Math.round(cellPx * 1.47));
  const sideW = sideWpx + "px";
  const colPx = Math.max(cellPx, Math.min(96, Math.floor(cellW)));
  const colW = colPx + "px";
  const numFont = Math.max(9, Math.round(cellPx * 0.34));
  const labFont = Math.max(9, Math.round(cellPx * 0.32));
  const numCell = (n, gs) => {
    const col = numColor(n); const key = "n" + n;
    const isRes = settled && result === n;
    return (
      <button key={n} onClick={() => place(key, { type: "straight", n })}
        style={{ position: "relative", minWidth: 0, borderRadius: 4, border: "none", cursor: "pointer",
          background: col === "red" ? C.red : C.dark, color: "#fff", fontFamily: "var(--font-numeric)", fontWeight: 600, fontSize: numFont,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: isRes ? "0 0 0 2px #f0c84a, 0 0 12px rgba(240,200,74,0.55)" : "none", zIndex: isRes ? 3 : 1, ...(gs || {}) }}>
        {n}
      </button>
    );
  };
  const outBtn = (label, type, nn, bg, gs) => {
    const key = type + (nn || ""); const st = bets[key];
    const win = settled && result != null && rouletteWins({ type, n: nn }, result) > 0;
    return (
      <button onClick={() => place(key, { type, n: nn })} key={key}
        style={{ position: "relative", minWidth: 0, borderRadius: 4, cursor: "pointer",
          border: `1px solid ${win ? "#f0c84a" : C.outline}`, background: bg || C.outlineBg, color: "#fff",
          fontFamily: "var(--font-display)", fontWeight: 800, fontSize: labFont, display: "flex", alignItems: "center", justifyContent: "center", ...(gs || {}) }}>
        <span style={label ? vtext : undefined}>{label}</span>{st && <PlacedChip stake={st.stake} count={st.count} size={22} />}
      </button>
    );
  };
  const col2to1 = (cn, gs) => {
    const key = "column" + cn; const st = bets[key];
    const win = settled && result != null && rouletteWins({ type: "column", n: cn }, result) > 0;
    return (
      <button key={cn} onClick={() => place(key, { type: "column", n: cn })}
        style={{ position: "relative", minWidth: 0, borderRadius: 4, cursor: "pointer", border: `1px solid ${win ? "#f0c84a" : C.outline}`, background: C.outlineBg, color: "#fff", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: labFont, display: "flex", alignItems: "center", justifyContent: "center", ...(gs || {}) }}>
        2:1{st && <PlacedChip stake={st.stake} count={st.count} size={22} />}
      </button>
    );
  };
  const evenBets = [
    { label: "1 to 18", type: "low" }, { label: "Even", type: "even" },
    { label: "", type: "red", bg: C.red }, { label: "", type: "black", bg: C.dark },
    { label: "Odd", type: "odd" }, { label: "19 to 36", type: "high" },
  ];
  const dozLabels = ["1 to 12", "13 to 24", "25 to 36"];
  return (
    <div style={{ position: "relative", zIndex: 1, flex: "1 1 auto", width: "100%", minHeight: 0, display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
    <div ref={wrapRef} style={{ position: "relative", flex: "1 1 auto", width: "100%", minHeight: 0, display: "flex", gap: gap, padding: "2px 22px 4px", boxSizing: "border-box", overflowY: "auto", overflowX: "hidden", alignItems: "flex-start", justifyContent: "space-between" }}>
      {/* left column: big current-result square on TOP, recent history under it */}
      <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: Math.round(chip * 0.45), flex: "0 0 auto", paddingTop: 4 }}>
        <div style={{ width: Math.round(chip * 1.95), height: Math.round(chip * 1.95), border: (settled && result != null) ? "2px solid transparent" : `2px solid var(--mint)`, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Unbounded', var(--font-numeric)", fontWeight: 700, fontSize: Math.max(18, Math.round(chip * 0.66)), color: "#fff", background: (settled && result != null) ? (numColor(result) === "green" ? C.green : numColor(result) === "red" ? C.red : C.dark) : "#1a1d24", flex: "0 0 auto" }}>{settled && result != null ? result : ""}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: gap + 2 }}>
          {recent.slice(0, 4).map((x, i) => {
            const big = Math.round(chip * 1.3);
            return <span key={i} style={{ width: big, height: big, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-numeric)", fontWeight: 700, fontSize: Math.max(12, Math.round(big * 0.42)), color: "#fff", opacity: 1 - i * 0.18, background: numColor(x) === "green" ? C.green : numColor(x) === "red" ? C.red : C.dark }}>{x}</span>;
          })}
        </div>
      </div>
      {/* one unified betting grid: 5 equal columns × 14 equal rows */}
      <div style={{ flex: "0 0 auto", position: "relative", display: "grid", gridTemplateColumns: `${sideW} ${sideW} repeat(3, ${colW})`, gridTemplateRows: `${zeroH} repeat(12, ${rowH}) ${bottomH}`, gap: gap }}>
        {/* zero — full-width bar across the top */}
        <button onClick={() => place("n0", { type: "straight", n: 0 })} style={{ gridColumn: "3 / 6", gridRow: "1", position: "relative", borderRadius: 4, border: "none", cursor: "pointer", background: C.green, color: "#fff", fontFamily: "'Unbounded', var(--font-numeric)", fontWeight: 700, fontSize: numFont, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: settled && result === 0 ? "0 0 0 2px #f0c84a, 0 0 12px rgba(240,200,74,0.55)" : "none" }}>0{bets["n0"] && <PlacedChip stake={bets["n0"].stake} count={bets["n0"].count} size={22} />}</button>
        {/* even-money — column 1, each spans 2 number rows */}
        {evenBets.map((e, i) => outBtn(e.label, e.type, null, e.bg, { gridColumn: 1, gridRow: `${2 + i * 2} / span 2` }))}
        {/* dozens — column 2, each spans 4 number rows */}
        {dozLabels.map((lb, j) => outBtn(lb, "dozen", j + 1, null, { gridColumn: 2, gridRow: `${2 + j * 4} / span 4` }))}
        {/* numbers — columns 3-5, 12 rows */}
        {Array.from({ length: 36 }, (_, k) => numCell(k + 1, { gridColumn: 3 + (k % 3), gridRow: 2 + Math.floor(k / 3) }))}
        {/* 2:1 column bets — bottom row under the numbers */}
        {[1, 2, 3].map((cn, idx) => col2to1(cn, { gridColumn: 3 + idx, gridRow: 14 }))}

        {/* inside-bet hit zones (splits between 2 numbers + corners of 4) — same keys as desktop */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 6 }}>
          {(() => {
            const blkLeft = 2 * sideWpx + 2 * gap;
            const blkTop = Math.round(rowPx * 1.2) + gap;
            const zx = (i) => blkLeft + i * (colPx + gap) + colPx / 2;
            const zy = (j) => blkTop + j * (rowPx + gap) + rowPx / 2;
            const edgeX = (i) => blkLeft + (i + 1) * (colPx + gap) - gap / 2;
            const edgeY = (j) => blkTop + (j + 1) * (rowPx + gap) - gap / 2;
            const zones = [];
            const splitCross = Math.max(11, Math.round(Math.min(colPx, rowPx) * 0.46));
            const hSplitH = Math.max(14, Math.round(rowPx * 0.7));
            const vSplitW = Math.max(16, Math.round(colPx * 0.62));
            const cornerS = Math.max(11, Math.round(Math.min(colPx, rowPx) * 0.44));
            for (let j = 0; j < 12; j++) for (let i = 0; i < 3; i++) {
              const n = 3 * j + i + 1;
              if (i < 2) zones.push({ ns: [n, n + 1], x: edgeX(i), y: zy(j), w: splitCross, h: hSplitH });
              if (j < 11) zones.push({ ns: [n, n + 3], x: zx(i), y: edgeY(j), w: vSplitW, h: splitCross });
              if (i < 2 && j < 11) zones.push({ ns: [n, n + 1, n + 3, n + 4], x: edgeX(i), y: edgeY(j), w: cornerS, h: cornerS });
            }
            return zones.map((z) => {
              const inKey = "in-" + z.ns.slice().sort((a, b) => a - b).join("_");
              return (
                <button key={inKey} onClick={() => place(inKey, { type: "inside", ns: z.ns })}
                  style={{ position: "absolute", left: z.x, top: z.y, transform: "translate(-50%,-50%)", width: z.w, height: z.h, padding: 0, border: "none", background: "transparent", cursor: "pointer", pointerEvents: "auto", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 6 }}>
                </button>
              );
            });
          })()}
        </div>
        {/* chip layer — all number & split/corner chips, painted with perspective (lower on table = on top) */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10 }}>
          {(() => {
            const blkLeft = 2 * sideWpx + 2 * gap;
            const blkTop = Math.round(rowPx * 1.2) + gap;
            const zx = (i) => blkLeft + i * (colPx + gap) + colPx / 2;
            const zy = (j) => blkTop + j * (rowPx + gap) + rowPx / 2;
            const edgeX = (i) => blkLeft + (i + 1) * (colPx + gap) - gap / 2;
            const edgeY = (j) => blkTop + (j + 1) * (rowPx + gap) - gap / 2;
            const out = [];
            for (let j = 0; j < 12; j++) for (let i = 0; i < 3; i++) {
              const n = 3 * j + i + 1;
              const straight = bets["n" + n];
              if (straight) out.push({ k: "cn" + n, st: straight, x: zx(i), y: zy(j) });
              const add = (ns, x, y) => { const kk = "in-" + ns.slice().sort((a, b) => a - b).join("_"); if (bets[kk]) out.push({ k: kk, st: bets[kk], x, y }); };
              if (i < 2) add([n, n + 1], edgeX(i), zy(j));
              if (j < 11) add([n, n + 3], zx(i), edgeY(j));
              if (i < 2 && j < 11) add([n, n + 1, n + 3, n + 4], edgeX(i), edgeY(j));
            }
            return out.map((c) => (
              <div key={c.k} style={{ position: "absolute", left: c.x, top: c.y, zIndex: Math.round(c.y) }}>
                <PlacedChip stake={c.st.stake} count={c.st.count} size={22} />
              </div>
            ));
          })()}
        </div>
      </div>
      </div>
      {/* Undo / Clear — white text links at the screen's bottom corners */}
      <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px 4px", boxSizing: "border-box", flex: "0 0 auto" }}>
        <button onClick={undo} disabled={spinning || !canUndo}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: "4px 2px", cursor: (spinning || !canUndo) ? "default" : "pointer", color: "#FFFFFF", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13.5, opacity: (spinning || !canUndo) ? 0.5 : 1 }}>
          <UndoIcon />Undo
        </button>
        <button onClick={clearBets} disabled={spinning || totalStaked === 0}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: "4px 2px", cursor: (spinning || totalStaked === 0) ? "default" : "pointer", color: "#FFFFFF", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13.5, opacity: (spinning || totalStaked === 0) ? 0.5 : 1 }}>
          Clear<ClearIcon />
        </button>
      </div>
    </div>
  );
}

// ── Betting table (desktop + classic mobile) ─────────────────
export function RouletteTable({ bets, place, result, settled, mobile }) {
  const rows = [0, 1, 2]; // top / mid / bottom
  const ZERO_W = mobile ? 30 : 46, COL_W = mobile ? 34 : 50, GAP = mobile ? 4 : 3;
  const [hov, setHov] = React.useState(null);
  const [hovBet, setHovBet] = React.useState(null);
  const covered = React.useMemo(() => {
    if (!hovBet) return null;
    const s = new Set();
    for (let r = 0; r <= 36; r++) if (rouletteWins(hovBet, r) > 0) s.add(r);
    return s;
  }, [hovBet]);
  const enter = (key, bet) => { setHov(key); setHovBet(bet); };
  const leave = (key) => { setHov((h) => (h === key ? null : h)); setHovBet(null); };
  const hovProps = (key) => ({ onMouseEnter: () => setHov(key), onMouseLeave: () => setHov((h) => (h === key ? null : h)) });
  const betHov = (key, type, n) => ({ onMouseEnter: () => enter(key, { type, n }), onMouseLeave: () => leave(key) });
  const zoneHov = (key, ns) => ({ onMouseEnter: () => enter(key, { type: "inside", ns }), onMouseLeave: () => leave(key) });
  const ring = (win, hovered) => (win ? "0 0 0 1px #f0c84a" : hovered ? "0 0 0 1px #fff" : "none");

  // ── inside-bet hit zones (splits between 2 numbers, corners of 4) ──
  const num = (r, c) => 3 * (c + 1) - r; // r:0 top,1 mid,2 bottom · c:0..11
  const zones = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 11; c++) zones.push({ ns: [num(r, c), num(r, c + 1)], x: (c + 1) / 12 * 100, y: (r + 0.5) / 3 * 100 });        // horizontal split
  for (let r = 0; r < 2; r++) for (let c = 0; c < 12; c++) zones.push({ ns: [num(r, c), num(r + 1, c)], x: (c + 0.5) / 12 * 100, y: (r + 1) / 3 * 100 });        // vertical split
  for (let r = 0; r < 2; r++) for (let c = 0; c < 11; c++) zones.push({ ns: [num(r, c), num(r, c + 1), num(r + 1, c), num(r + 1, c + 1)], x: (c + 1) / 12 * 100, y: (r + 1) / 3 * 100 }); // corner

  const insideZone = (z) => {
    const key = "in-" + z.ns.slice().sort((a, b) => a - b).join("_");
    const staked = bets[key];
    return (
      <button key={key} onClick={() => place(key, { type: "inside", ns: z.ns })} {...zoneHov(key, z.ns)}
        style={{ position: "absolute", left: z.x + "%", top: z.y + "%", transform: "translate(-50%,-50%)", width: mobile ? 15 : 26, height: mobile ? 15 : 26, padding: 0, borderRadius: "50%", border: "none", background: "transparent", cursor: "pointer", pointerEvents: "auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {(!staked && hov === key) ? (
          <span style={{ width: mobile ? 14 : 24, height: mobile ? 14 : 24, borderRadius: "50%", border: `2px dotted #fff`, background: "rgba(255,255,255,0.82)", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", color: "#0E1512" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </span>
        ) : null}
      </button>
    );
  };

  const numCell = (n) => {
    const col = numColor(n);
    const key = "n" + n;
    const isRes = settled && result === n;
    const hi = hov === key || (covered && covered.has(n));
    return (
      <button key={n} onClick={() => place(key, { type: "straight", n })} {...hovProps(key)}
        style={{ position: "relative", aspectRatio: "1 / 1", minWidth: 0, borderRadius: 3, border: "none", cursor: "pointer",
          background: col === "red" ? C.red : C.dark, color: "#fff",
          fontFamily: "var(--font-numeric)", fontWeight: 500, fontSize: "clamp(10px, 1.5vw, 15px)", fontVariantNumeric: "tabular-nums",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: hi ? 2 : 1,
          boxShadow: (isRes ? "inset 0 0 0 100px rgba(0,0,0,0.34)" : (hi ? "0 0 0 1px #fff, inset 0 0 0 100px rgba(255,255,255,0.16)" : "none")) }}>
        {n}
      </button>
    );
  };

  const col2to1 = (cn) => {
    const key = "column" + cn;
    const staked = bets[key];
    return (
      <button key={cn} onClick={() => place(key, { type: "column", n: cn })} {...betHov(key, "column", cn)}
        style={{ position: "relative", flex: 1, minWidth: 0, borderRadius: 3, cursor: "pointer",
          border: `1px solid ${C.outline}`, background: C.outlineBg, color: "#fff",
          fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(11px, 1.35vw, 14px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: hov === key ? 2 : 1,
          boxShadow: ring(false, hov === key) + (hov === key ? ", inset 0 0 0 100px rgba(255,255,255,0.12)" : "") }}>
        2:1{staked && <PlacedChip stake={staked.stake} count={staked.count} />}
      </button>
    );
  };

  const outside = (label, type, n, opts = {}) => {
    const key = type + (n || "");
    const staked = bets[key];
    return (
      <button key={key} onClick={() => place(key, { type, n })} {...betHov(key, type, n)}
        style={{ position: "relative", flex: opts.flex || 1, minWidth: 0, height: opts.h || (mobile ? 32 : 38), borderRadius: 3, cursor: "pointer",
          border: `1px solid ${C.outline}`, background: opts.bg || C.outlineBg, color: "#fff",
          fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(11px, 1.45vw, 15px)", letterSpacing: "0.01em",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: hov === key ? 2 : 1,
          boxShadow: ring(false, hov === key) + (hov === key ? ", inset 0 0 0 100px rgba(255,255,255,0.12)" : "") }}>
        {label}{staked && <PlacedChip stake={staked.stake} count={staked.count} />}
      </button>
    );
  };

  const midPad = { paddingLeft: ZERO_W + GAP, paddingRight: COL_W + GAP };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: GAP }}>
      {/* numbers section */}
      <div style={{ display: "flex", gap: GAP, alignItems: "stretch" }}>
        {/* zero */}
        <button onClick={() => place("n0", { type: "straight", n: 0 })} {...hovProps("n0")}
          style={{ position: "relative", width: ZERO_W, flex: "0 0 auto", borderRadius: 3, border: "none", cursor: "pointer",
            background: C.green, color: "#fff", fontFamily: "var(--font-numeric)", fontWeight: 500, fontSize: 17, fontVariantNumeric: "tabular-nums",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: (hov === "n0" || (covered && covered.has(0))) ? 2 : 1,
            boxShadow: (settled && result === 0 ? "0 0 0 3px #f0c84a, 0 0 14px rgba(240,200,74,0.55), inset 0 0 0 100px rgba(0,0,0,0.28)" : ((hov === "n0" || (covered && covered.has(0))) ? "0 0 0 1px #fff, inset 0 0 0 100px rgba(255,255,255,0.16)" : "none")) }}>
          0{bets["n0"] && <PlacedChip stake={bets["n0"].stake} count={bets["n0"].count} />}
        </button>
        {/* 12-col × 3-row grid */}
        <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: GAP }}>
          {rows.map((rw) => (
            <div key={rw} style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: GAP }}>
              {Array.from({ length: 12 }, (_, ci) => numCell(3 * (ci + 1) - rw))}
            </div>
          ))}
          {/* all placed chips in one layer — lower on the table paints OVER higher (perspective) */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}>
            {zones.map((z) => {
              const key = "in-" + z.ns.slice().sort((a, b) => a - b).join("_");
              const st = bets[key];
              return st ? (
                <div key={key} style={{ position: "absolute", left: z.x + "%", top: z.y + "%", width: 0, height: 0, zIndex: Math.round(z.y) }}>
                  <PlacedChip stake={st.stake} count={st.count} size={mobile ? 18 : 26} />
                </div>
              ) : null;
            })}
            {rows.map((rw) => Array.from({ length: 12 }, (_, ci) => {
              const nn = 3 * (ci + 1) - rw;
              const st = bets["n" + nn];
              const cy = (rw + 0.5) / 3 * 100;
              return st ? (
                <div key={nn} style={{ position: "absolute", left: (ci + 0.5) / 12 * 100 + "%", top: cy + "%", width: 0, height: 0, zIndex: Math.round(cy) + 1 }}>
                  <PlacedChip stake={st.stake} count={st.count} size={mobile ? 20 : 30} />
                </div>
              ) : null;
            }))}
          </div>
          {/* inside-bet hit zones (top, clickable) */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}>
            {zones.map((z) => insideZone(z))}
          </div>
          {/* winning-number gold ring — mirrors the grid so it sits ON TOP of every neighbouring cell/chip */}
          {settled && result != null && result >= 1 && result <= 36 && (
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 8, display: "flex", flexDirection: "column", gap: GAP }}>
              {rows.map((rw) => (
                <div key={rw} style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: GAP }}>
                  {Array.from({ length: 12 }, (_, ci) => {
                    const nn = 3 * (ci + 1) - rw;
                    return <div key={ci} style={nn === result ? { borderRadius: 3, boxShadow: "0 0 0 3px #f0c84a, 0 0 14px rgba(240,200,74,0.6)" } : undefined} />;
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* 2:1 column */}
        <div style={{ width: COL_W, flex: "0 0 auto", display: "flex", flexDirection: "column", gap: GAP }}>
          {[3, 2, 1].map((cn) => col2to1(cn))}
        </div>
      </div>

      {/* dozens */}
      <div style={{ display: "flex", gap: GAP, ...midPad }}>
        {outside("1 to 12", "dozen", 1)}
        {outside("13 to 24", "dozen", 2)}
        {outside("25 to 36", "dozen", 3)}
      </div>

      {/* even-money */}
      <div style={{ display: "flex", gap: GAP, ...midPad }}>
        {outside("1 to 18", "low")}
        {outside("Even", "even")}
        {outside("", "red", null, { bg: C.red })}
        {outside("", "black", null, { bg: C.dark })}
        {outside("Odd", "odd")}
        {outside("19 to 36", "high")}
      </div>
    </div>
  );
}

// ── Win popup — multiplier card with payout + winning number ──
export function WinPopup({ mult, amount, number, won = true }) {
  const accent = won ? "#37dd84" : "#7a828f";
  const multColor = won ? "#062018" : "#11151b";
  const chipStroke = won ? "#062018" : "#11151b";
  return (
    <div style={{ position: "absolute", left: "50%", top: "44%", transform: "translate(-50%,-50%)", zIndex: 45, pointerEvents: "none", animation: "rl-pop 360ms cubic-bezier(0.34,1.45,0.5,1)" }}>
      <div style={{ background: accent, borderRadius: 18, padding: 6, boxShadow: "0 20px 55px rgba(0,0,0,0.55)", minWidth: 236 }}>
        <div style={{ padding: "16px 30px 13px", textAlign: "center", fontFamily: "'Unbounded', var(--font-numeric)", fontWeight: 800, fontSize: 34, color: multColor, letterSpacing: "-0.02em" }}>x{(mult || 0).toFixed(2)}</div>
        <div style={{ background: "#0e1014", border: `2px solid ${accent}`, borderRadius: 13, padding: "11px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 20 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#2A6FDB" /><path d="M12 6.2v11.6M9.4 9.1c0-1.3 1.2-2 2.6-2s2.6.6 2.6 1.9c0 2.8-5.2 1.3-5.2 4.1 0 1.3 1.2 2 2.6 2s2.6-.7 2.6-2" fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 16, color: "#fff" }}>{fmtUSD(amount || 0)}</span>
          </span>
          {number != null && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill={accent} /><circle cx="12" cy="12" r="3.4" fill="none" stroke={chipStroke} strokeWidth="1.6" /><path d="M12 2.6v4M12 17.4v4M2.6 12h4M17.4 12h4M5.4 5.4l2.8 2.8M15.8 15.8l2.8 2.8M18.6 5.4l-2.8 2.8M8.2 15.8l-2.8 2.8" stroke={chipStroke} strokeWidth="1.5" strokeLinecap="round" /></svg>
              <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 16, color: "#fff" }}>{number}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
