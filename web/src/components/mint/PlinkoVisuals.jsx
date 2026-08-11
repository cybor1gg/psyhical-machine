// MintBets Plinko — visual components, ported from the design system.
// The ball animates the SERVER's left/right chain: presentation replays the
// fairness chain, it never invents randomness.
import React from "react";

// Heat scale: deep mint at the low centre buckets, warming to gold edges.
export function bucketColor(m) {
  const t = Math.max(0, Math.min(1, (Math.log(Math.max(0.05, m)) - Math.log(0.3)) / (Math.log(110) - Math.log(0.3))));
  const e = Math.pow(t, 1.35);
  const h = 148 - 113 * e;
  const s = 62 + (94 - 62) * e;
  const l = 46 + (58 - 46) * e;
  return {
    bg: `linear-gradient(180deg, hsl(${h} ${s}% ${Math.min(76, l + 10)}%), hsl(${h} ${s}% ${l}%) 55%, hsl(${h} ${s}% ${Math.max(30, l - 10)}%))`,
    fg: "#0B1A0E",
    edge: `hsl(${h} ${s}% ${Math.min(78, l + 12)}%)`,
  };
}
export function bucketLabel(m) {
  if (m >= 1000) { const k = Math.round(m / 100) / 10; return (Number.isInteger(k) ? String(k) : k.toFixed(1)) + "k"; }
  return m >= 10 ? String(Math.round(m)) : m.toFixed(1);
}

// Rows control: number box + draggable mint-fill track (8–16).
export function PlinkoRowsSlider({ value, onChange, min = 8, max = 16, disabled = false }) {
  const trackRef = React.useRef(null);
  const [drag, setDrag] = React.useState(false);
  const pct = (value - min) / (max - min);
  const setFromX = (clientX) => {
    const el = trackRef.current; if (!el || disabled) return;
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const v = Math.round(min + f * (max - min));
    if (v !== value) onChange(v);
  };
  const onDown = (e) => { if (disabled) return; setDrag(true); e.currentTarget.setPointerCapture?.(e.pointerId); setFromX(e.clientX); };
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 10, height: 46, opacity: disabled ? 0.55 : 1 }}>
      <div style={{ flex: "0 0 52px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 17, color: "var(--text)" }}>{value}</div>
      <div ref={trackRef} onPointerDown={onDown} onPointerMove={(e) => drag && setFromX(e.clientX)} onPointerUp={() => setDrag(false)} onPointerCancel={() => setDrag(false)}
        tabIndex={0} role="slider" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
        onKeyDown={(e) => { if (disabled) return; if (e.key === "ArrowLeft" && value > min) onChange(value - 1); if (e.key === "ArrowRight" && value < max) onChange(value + 1); }}
        style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", padding: "0 14px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", cursor: disabled ? "default" : "pointer", touchAction: "none", outline: "none" }}>
        <div style={{ position: "relative", width: "100%", height: 8, borderRadius: 999, background: "var(--ink)" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct * 100}%`, borderRadius: 999, background: "linear-gradient(90deg, var(--mint), var(--mint-bright))" }} />
          <div style={{ position: "absolute", left: `${pct * 100}%`, top: "50%", transform: "translate(-50%,-50%)", width: 20, height: 28, borderRadius: 7, background: "#EAF5EF", boxShadow: "0 2px 6px rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
            {[0, 1, 2].map((k) => <span key={k} style={{ width: 2, height: 11, borderRadius: 2, background: "var(--mint-deep)" }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

// Build the projectile keyframes for a ball following `directions` (the
// server's left/right chain). Straight port of the DS physics: each hop is a
// true parabola with a small upward kick off every pin.
export function buildBallPath(rows, directions) {
  const gap = 0.84 / (rows + 1);
  const ballXAt = (k, rights) => 0.5 + (rights - k / 2) * gap;
  const X = [0.5];
  let cum = 0;
  for (let k = 1; k <= rows; k++) { cum += directions[k - 1]; X.push(ballXAt(k, cum)); }

  const rowDy = 1 / (rows + 1);
  const Yr = (r) => r / (rows + 1);
  const g = 9.0;
  const dt = 1 / 240;
  const bounce = 0.55;
  // release point: ONE row-height above the first pin row (y=0 maps to the
  // top of the pin field) — not high above the board; the ball reads as
  // dropping straight onto the first row of dots
  const W = [{ x: 0.5, y: 0 }];
  for (let r = 1; r <= rows; r++) W.push({ x: X[r], y: Yr(r) });
  // final drop ends INSIDE the bucket mouth, so the ball visibly sinks in
  // instead of freezing at the board's bottom edge before it is removed
  W.push({ x: X[rows], y: (rows + 0.55) / (rows + 1) });
  const kf = [{ x: W[0].x, y: W[0].y }];
  const pinTimes = [];
  let t = 0;
  for (let s = 0; s < W.length - 1; s++) {
    const a = W[s], b = W[s + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const isEntry = s === 0;
    const isBucket = s === W.length - 2;
    const crit = Math.sqrt(2 * Math.max(dy, 1e-4) / g);
    let T;
    if (isBucket) T = 0.85 * crit;
    else if (isEntry) T = 1.0 * Math.sqrt(2 * Math.max(dy, rowDy) / g);
    else T = (1.0 + 1.5 * bounce) * crit;
    T *= (1 - 0.10 * (s / W.length));
    const vy0 = dy / T - 0.5 * g * T;
    const vx = dx / T;
    const steps = Math.max(1, Math.round(T / dt));
    for (let i = 1; i <= steps; i++) {
      const tau = (i / steps) * T;
      kf.push({ x: a.x + vx * tau, y: a.y + vy0 * tau + 0.5 * g * tau * tau });
    }
    t += T;
    if (!isBucket) pinTimes.push({ k: s + 1, x: b.x, t });
  }
  const totalT = t || 1;
  const dur = Math.round(Math.min(3000, Math.max(1500, totalT * 1000)));
  return { kf, pinTimes, totalT, dur, gap };
}

// The pin field never changes for a given board — memoized on primitives so
// peg hits and flying balls never reconcile its ~135 nodes (a real cost on
// low-end phones during a multi-ball pour).
const PinField = React.memo(function PinField({ rows, pinR }) {
  const gap = 0.84 / (rows + 1);
  const topPct = (yy) => 0.03 + (yy * (rows + 1) / rows) * 0.94;
  const out = [];
  for (let k = 1; k <= rows; k++) {
    const count = k + 2;
    for (let i = 0; i < count; i++) {
      const x = 0.5 + (i - (count - 1) / 2) * gap;
      out.push(
        <span key={`${k}-${i}`} style={{ position: "absolute", left: `${x * 100}%`, top: `${topPct(k / (rows + 1)) * 100}%`, width: pinR * 2, height: pinR * 2, marginLeft: -pinR, marginTop: -pinR, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(0,0,0,0.35)", zIndex: 1 }} />
      );
    }
  }
  return out;
});

// One ball on the compositor (Web Animations API — no React re-render jank).
function PlinkoBall({ ball, ballR, toTop, onLand, onPeg }) {
  const ref = React.useRef(null);
  const done = React.useRef(false);
  React.useEffect(() => {
    const el = ref.current;
    const settle = () => { if (done.current) return; done.current = true; onLand(ball); };
    const box = el.parentElement;
    // LAYOUT pixels, never getBoundingClientRect: inside FitBox's scale()
    // the rect is already visually scaled, so translate offsets computed from
    // it get scaled twice and the ball stops mid-board instead of landing.
    const W = box.offsetWidth || 1, H = box.offsetHeight || 1;
    const wp = ball.kf;
    const x0 = wp[0].x, y0 = toTop(wp[0].y);
    const toXY = (px, py) => `translate3d(${((px - x0) * W).toFixed(2)}px, ${((toTop(py) - y0) * H).toFixed(2)}px, 0)`;
    const last = wp.length - 1;
    const frames = wp.map((p, i) => ({ transform: toXY(p.x, p.y), offset: i / last, easing: "linear" }));
    let anim = null;
    try {
      anim = el.animate(frames, { duration: ball.dur, fill: "both" });
      anim.onfinish = settle;
      // vanish: a plain fade timed to the final sink into the bucket mouth —
      // the ball disappears as it reaches the box, nothing flashier than that
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, delay: Math.max(0, ball.dur - 190), easing: "ease-out", fill: "forwards" });
    } catch { settle(); }
    const tickTimers = [];
    (ball.pinTimes || []).forEach((pt) => tickTimers.push(setTimeout(() => onPeg(pt.k, pt.x), ball.dur * (pt.t / ball.totalT))));
    // settle a beat BEFORE the animation ends: the bucket dip and the ball's
    // removal then land on the same frame the ball reaches the bucket, instead
    // of the ball freezing for a frame while React catches up. onfinish and the
    // late safety stay as backups (the done ref dedupes).
    const early = setTimeout(settle, Math.max(0, ball.dur - 40));
    const safety = setTimeout(settle, ball.dur + 120);
    return () => { tickTimers.forEach(clearTimeout); clearTimeout(early); clearTimeout(safety); try { anim && anim.cancel(); } catch { /* already gone */ } };
  }, []);
  return (
    <span ref={ref} style={{ position: "absolute", left: `${ball.kf[0].x * 100}%`, top: `${toTop(ball.kf[0].y) * 100}%`, width: ballR * 2, height: ballR * 2, marginLeft: -ballR, marginTop: -ballR, borderRadius: "50%", background: `radial-gradient(circle at 50% 50%, #0B1A0E 0%, #0B1A0E ${Math.max(2, ballR * 0.22)}px, #3DF07A ${Math.max(2, ballR * 0.22) + 1}px)`, zIndex: 4, willChange: "transform" }} />
  );
}

export function PlinkoBoard({ rows, table, balls, primers = [], flash, onLand, compact = false }) {
  const gap = 0.84 / (rows + 1);
  const pinR = (rows >= 16 ? 4.2 : rows >= 12 ? 5.2 : 6.4) * (compact ? 0.8 : 1);
  // phones: FitBox already shrinks the whole board, so the ball keeps its
  // full size and the payout labels run bigger — both were unreadable with
  // the extra compact shrink on top of the fit scale
  const ballR = (rows >= 16 ? 8.5 : rows >= 12 ? 10.5 : 12.5) * (compact ? 0.65 : 1);
  // Pin field spans the full board height: first row near the top, LAST row
  // flush with the bottom edge so the buckets tuck directly beneath it with
  // no dead band between.
  const topPct = (yy) => 0.03 + (yy * (rows + 1) / rows) * 0.94;
  const bFs = compact ? (rows >= 16 ? 11 : rows >= 12 ? 14 : 17) : (rows >= 16 ? 13 : rows >= 12 ? 18 : 23);
  const gloss = "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.12) 30%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.14) 100%)";

  const [pulse, setPulse] = React.useState({});
  const pulseId = React.useRef(0);
  const pegHit = (k, bx) => {
    const count = k + 2;
    let best = 0, bd = Infinity;
    for (let i = 0; i < count; i++) { const px = 0.5 + (i - (count - 1) / 2) * gap; const d = Math.abs(px - bx); if (d < bd) { bd = d; best = i; } }
    const key = `${k}-${best}`;
    const pid = ++pulseId.current;
    setPulse((p) => ({ ...p, [key]: pid }));
    setTimeout(() => setPulse((p) => { if (p[key] !== pid) return p; const n = { ...p }; delete n[key]; return n; }), 250);
  };
  // position of a pin from its "row-index" key — used by the small hit overlay
  const pinPos = (key) => {
    const [k, i] = key.split("-").map(Number);
    const count = k + 2;
    return { x: 0.5 + (i - (count - 1) / 2) * gap, y: k / (rows + 1) };
  };

  return (
    <div style={{ width: "100%", maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: rows >= 16 ? 1 : 2 }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 0.82", overflow: "visible" }}>
        <PinField rows={rows} pinR={pinR} />
        {Object.entries(pulse).map(([key, id]) => {
          const p = pinPos(key);
          const r = pinR * 1.5;
          return (
            <React.Fragment key={key + "-" + id}>
              {/* the hit pin flashes and its ping ring expands — drawn in this
                  tiny overlay so a peg hit never reconciles the static field */}
              <span style={{ position: "absolute", left: `${p.x * 100}%`, top: `${topPct(p.y) * 100}%`, width: pinR * 2, height: pinR * 2, marginLeft: -pinR, marginTop: -pinR, borderRadius: "50%", background: "#FFFFFF", pointerEvents: "none", zIndex: 2, animation: "mb-pin-flash 0.4s var(--ease-out)" }} />
              <span style={{ position: "absolute", left: `${p.x * 100}%`, top: `${topPct(p.y) * 100}%`, width: r * 2, height: r * 2, marginLeft: -r, marginTop: -r, borderRadius: "50%", border: "2px solid #FFFFFF", boxShadow: "0 0 7px rgba(255,255,255,0.7)", pointerEvents: "none", zIndex: 3, animation: "mb-ping 0.4s var(--ease-out) forwards" }} />
            </React.Fragment>
          );
        })}
        {/* 0ms primer: drops in at the release point the instant of the tap;
            the real ball starts from the same spot when the server answers */}
        {primers.map((pid, i) => (
          <span key={pid} style={{ position: "absolute", left: "50%", top: `${topPct(0) * 100}%`, width: ballR * 2, height: ballR * 2, marginLeft: -ballR, marginTop: -ballR, borderRadius: "50%", background: `radial-gradient(circle at 50% 50%, #0B1A0E 0%, #0B1A0E ${Math.max(2, ballR * 0.22)}px, #3DF07A ${Math.max(2, ballR * 0.22) + 1}px)`, zIndex: 4, animation: `mb-ball-in 460ms cubic-bezier(0.42,0,0.9,0.5) both, mb-ball-idle 900ms ease-in-out ${460 + (i % 4) * 190}ms infinite`, willChange: "transform" }} />
        ))}
        {balls.map((b) => (
          <PlinkoBall key={b.id} ball={b} ballR={ballR} toTop={topPct} onLand={onLand} onPeg={pegHit} />
        ))}
      </div>
      {/* buckets — taller on phones so the payout numbers stay readable */}
      <div style={{ display: "flex", justifyContent: "center", gap: compact ? 2 : rows >= 16 ? 3 : 4, paddingInline: `calc(${(0.5 - (rows + 1) / 2 * gap) * 100}% + ${compact ? 2 : 6}px)` }}>
        {table.map((m, i) => {
          const col = bucketColor(m);
          const lit = flash[i];
          return (
            <span key={`${i}-${lit || 0}`} style={{ flex: 1, minWidth: 0, aspectRatio: compact ? "1 / 1.35" : "1", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: rows >= 16 ? 3 : 4, background: `${gloss}, ${col.bg}`, color: col.fg, fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 900, fontSize: bFs, letterSpacing: "-0.04em", textShadow: "0 1px 0 rgba(255,255,255,0.28)", boxShadow: `inset 0 2px 1px rgba(255,255,255,0.55), inset 0 -4px 6px rgba(0,0,0,0.16), 0 4px 0 ${col.edge}`, animation: lit ? "mb-bucket-dip 0.5s var(--ease-out)" : "none" }}>{bucketLabel(m)}</span>
          );
        })}
      </div>
    </div>
  );
}
