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
import { useLocation } from "react-router-dom";
import SpaceBackground from "./SpaceBackground";
import { T } from "./Shell";

// per-game parallax speed of the fast starfield, from the design handoff
const FAST_DUR = {
  hilo: 12, blackjack: 12, war: 12, roulette: 12, baccarat: 12,
  tower: 7, dice: 7, limbo: 7, mines: 7, plinko: 7, keno: 7, chicken: 7,
};

const MENU_BG = "radial-gradient(130% 100% at 50% -25%, #1a1f33 0%, #0a0c14 55%, #06070b 100%)";

export default function SpaceBackdrop() {
  const { pathname } = useLocation();
  // staff screens are plain — no scene, and nothing left running behind them
  if (/^\/(admin|login|verify)/.test(pathname)) return null;

  const menu = pathname === "/";
  const id = pathname.startsWith("/games/") ? pathname.slice("/games/".length) : null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden", background: menu ? MENU_BG : T.page }}>
      {/* Same element in the same slot every time, so React keeps the instance
          alive: the <video> is never re-created and the sun keeps playing.
          Only `variant` and `fastDur` change across routes — swapping a
          duration re-times a running animation, it does not restart it. */}
      <SpaceBackground variant={menu ? "menu" : "game"} fastDur={FAST_DUR[id] || 12} />
    </div>
  );
}
