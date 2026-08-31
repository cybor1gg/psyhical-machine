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
//
// The scene itself is WebGL (skySceneGL.js): the whole CSS sky collapsed into
// one Pixi canvas at 0.75x internal resolution. The CSS <SpaceBackground/>
// stays fully intact as the LIVE fallback — rendered until GL init resolves,
// kept if init fails, and brought back by onLost() after a dead context.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import SpaceBackground from "./SpaceBackground";
import { createSkyScene } from "./skySceneGL";
import { setRenderer } from "./pixiApp";
import { T } from "./Shell";

// One drift speed everywhere. The handoff gave each game its own (7s or 12s)
// and the menu a different sky altogether, which meant the background visibly
// changed as you moved around. It is now the same scene at the same speed on
// every screen.
const FAST_DUR = 12;

function Sky() {
  const wrapRef = useRef(null);
  // false → the CSS scene is mounted (pre-init, no-WebGL, or post-context-loss)
  const [gl, setGl] = useState(false);

  useEffect(() => {
    // Init is async: `cancelled` guards the StrictMode double-mount and
    // unmount races — a scene resolving after cleanup is destroyed on the
    // spot and never referenced.
    let cancelled = false;
    let scene = null;
    createSkyScene({
      wrap: wrapRef.current,
      fastDur: FAST_DUR,
      onLost() {
        // permanent runtime context loss (driver reset that never restores):
        // drop the dead scene and remount the CSS sky, unchanged
        scene?.destroy();
        scene = null;
        if (!cancelled) {
          setGl(false);
          setRenderer("sky", "css");
        }
      },
    }).then((s) => {
      if (cancelled) { s.destroy(); return; }
      scene = s;
      s.fit(); // a resize during the async init fired while scene was null
      setGl(true); // unmounts the CSS scene; canvas takes over seamlessly
      setRenderer("sky", "webgl");
    }).catch(() => {
      setRenderer("sky", "css"); // no WebGL — the CSS scene was never touched
    });
    const ro = new ResizeObserver(() => scene?.fit());
    ro.observe(wrapRef.current);
    return () => {
      cancelled = true;
      ro.disconnect();
      scene?.destroy();
      scene = null;
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      {!gl && <SpaceBackground fastDur={FAST_DUR} />}
    </div>
  );
}

export default function SpaceBackdrop() {
  const { pathname } = useLocation();
  // staff screens are plain — no scene, and nothing left running behind them
  if (/^\/(admin|operator|login|verify)/.test(pathname)) return null;

  // The sky renders 1:1. Laying it out oversized and scaling it down saves
  // nothing: WebRender folds a static ancestor scale into the raster scale
  // (that is why static transform:scale keeps text sharp), so the same pixels
  // are filled either way — while every descendant's CSS box grows by 1/s.
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden", background: T.page }}>
      <Sky />
    </div>
  );
}
