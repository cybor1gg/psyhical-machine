// The ONE background. Mounted once, above the router but outside <Routes>, so
// it never unmounts as the player moves lobby -> game -> lobby.
//
// Every screen used to render its own <SpaceBackground/>, which meant each
// navigation tore down the whole scene and built a new one: the sun video was
// re-created and restarted from frame 0, and ~25 composited layers were
// re-rasterised. Now the scene simply keeps running underneath and the route
// only changes which parts of it are shown — the sun is exactly where you
// left it when you come back to the lobby.
//
// It also owns the page's base gradient, because the screens on top of it are
// transparent; they used to paint it themselves and would have hidden this.
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import SpaceBackground from "./SpaceBackground";
import { isLite, onPerfMode } from "./perfMode";
import { T } from "./Shell";

// One drift speed everywhere. The handoff gave each game its own (7s or 12s)
// and the menu a different sky altogether, which meant the background visibly
// changed as you moved around. It is now the same scene at the same speed on
// every screen.
const FAST_DUR = 12;

// perf-lite internal render width — the sky rasterises at ≤1280 wide and the
// GPU scales ONE texture up to the panel, so fill cost falls with the square
// of the scale (a 4K cabinet composites ~1/9 the pixels). Slightly softer
// stars are invisible under the game screens.
const LITE_W = 1280;

export default function SpaceBackdrop() {
  const { pathname } = useLocation();
  const [lite, setLite] = useState(isLite);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => onPerfMode(setLite), []);
  useEffect(() => {
    const onR = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  // staff screens are plain — no scene, and nothing left running behind them
  if (/^\/(admin|operator|login|verify)/.test(pathname)) return null;

  const s = lite ? Math.min(1, LITE_W / vp.w) : 1;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden", background: T.page }}>
      {/* Same element, same props, every route — React keeps the instance
          alive, the <video> is never re-created and nothing re-animates. */}
      <div style={s === 1
        ? { position: "absolute", inset: 0 }
        : { position: "absolute", left: 0, top: 0, width: vp.w / s, height: vp.h / s, transform: `scale(${s})`, transformOrigin: "0 0" }}>
        <SpaceBackground fastDur={FAST_DUR} />
      </div>
    </div>
  );
}
