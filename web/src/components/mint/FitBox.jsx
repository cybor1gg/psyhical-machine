// Mobile fit engine: games inside operator iframes must NEVER scroll or move.
//   useStableViewportHeight — the height the game locks itself to: the iframe
//     viewport, clamped to the device screen so an oversized iframe can't push
//     the controls below the phone's fold.
//   FitBox — measures its slot and its content and scales the content DOWN
//     (never up) to fit, keeping every board fully visible above the pinned
//     control sheet on any screen. Content lays out at natural size, so game
//     internals need no changes; the transform scales taps along with pixels.
import React from "react";

export function useStableViewportHeight() {
  const get = () =>
    Math.min(
      window.innerHeight,
      (window.screen && window.screen.height) || Infinity
    );
  const [vh, setVh] = React.useState(get);
  React.useEffect(() => {
    const f = () => setVh(get());
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return vh;
}

export function FitBox({ children }) {
  const outer = React.useRef(null);
  const inner = React.useRef(null);
  const [scale, setScale] = React.useState(1);

  React.useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const ow = o.clientWidth, oh = o.clientHeight;
      const iw = i.offsetWidth, ih = i.offsetHeight; // unscaled layout size
      if (!ow || !oh || !iw || !ih) return;
      // tiny hysteresis so sub-pixel ResizeObserver echoes don't loop
      const next = Math.min(1, ow / iw, oh / ih);
      setScale((s) => (Math.abs(s - next) > 0.005 ? next : s));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outer} style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <div ref={inner} style={{ flex: "0 0 auto", width: "100%", transform: `scale(${scale})`, transformOrigin: "center" }}>
        {children}
      </div>
    </div>
  );
}
