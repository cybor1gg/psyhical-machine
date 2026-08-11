// MintBets Limbo — visual components. The hero is one huge multiplier that
// counts up to the rolled result; mint on a win, red on a loss.
import React from "react";

// Count-up multiplier display (lite port of the DS MultiplierDisplay).
// `runId` retriggers the count when consecutive rolls land the same value.
// The effect is idempotent (no guard ref) — StrictMode's double-run in dev
// just restarts the same animation instead of skipping it.
export function MultiplierDisplay({ value, state, runId = null, size = "clamp(64px, 13vw, 124px)", duration = 420 }) {
  const [shown, setShown] = React.useState(value);
  const raf = React.useRef(null);

  React.useEffect(() => {
    const to = value;
    cancelAnimationFrame(raf.current);
    if (to <= 1) { setShown(to); return; }
    const from = 1;
    const t0 = performance.now();
    const tick = (t) => {
      const f = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - f, 3);
      setShown(from + (to - from) * eased);
      if (f < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    // rAF is suspended in hidden tabs/iframes — guarantee the final value
    // lands even when the pretty count-up can't run.
    const settle = setTimeout(() => setShown(to), duration + 50);
    return () => { cancelAnimationFrame(raf.current); clearTimeout(settle); };
  }, [value, runId, duration]);

  const color = state === "loss" ? "var(--loss)" : state === "win" || state === "big" ? "var(--mint-bright)" : "var(--text)";
  return (
    <span style={{
      fontFamily: "'Unbounded', var(--font-numeric)", fontVariantNumeric: "tabular-nums",
      fontWeight: 700, fontSize: size, letterSpacing: "-0.03em", lineHeight: 1, color,
      transition: "color 160ms ease",
      animation: state === "big" ? "mb-pop 340ms var(--ease-bounce)" : "none",
    }}>
      {shown.toFixed(2)}
    </span>
  );
}
