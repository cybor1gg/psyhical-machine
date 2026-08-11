// Cabinet lobby — a slot-machine style game-select screen: pages of game art
// tiles that fit the screen exactly (no vertical scroll anywhere) and swipe
// left/right on the touchscreen, with page dots and arrow buttons. The
// wallet bar (live credits + Cash Out) is pinned to the bottom.
//
// Layout contract: arrows live in the side gutters (page padding-x) and the
// dots in the bottom gutter (page padding-bottom) — chrome never overlaps
// the tiles.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api";
import { GameArt } from "../components/mint/GameArt";
import { LoadingScreen } from "../components/mint/LoadingScreen";
import { BalanceReadout, CashOutButton } from "../kiosk/KioskBar";
import KioskBackground from "../kiosk/KioskBackground";

const GAMES = [
  { key: "hilo", title: "Hi-Lo", path: "/games/hilo" },
  { key: "blackjack", title: "Blackjack", path: "/games/blackjack" },
  { key: "war", title: "War", path: "/games/war" },
  { key: "tower", title: "Dragon Tower", path: "/games/tower" },
  { key: "mines", title: "Mines", path: "/games/mines" },
  { key: "chicken", title: "Chicken Cross", path: "/games/chicken" },
  { key: "dice", title: "Dice", path: "/games/dice" },
  { key: "limbo", title: "Limbo", path: "/games/limbo" },
  { key: "plinko", title: "Plinko", path: "/games/plinko" },
  { key: "keno", title: "Keno", path: "/games/keno" },
  { key: "roulette", title: "Roulette", path: "/games/roulette" },
  { key: "baccarat", title: "Baccarat", path: "/games/baccarat" },
];

// Coming-soon placeholders — they fill out the pager so the swipe flow can
// be exercised before the next games land. Delete entries as real games
// take their slots.
const PLACEHOLDER_TITLES = [
  "Crash", "Wheel", "Slots", "Video Poker", "Coin Flip", "Scratch",
  "Craps", "Sic Bo", "Big Six", "Three Card", "Andar Bahar", "Lucky 7",
  "Crazy Cars", "Goal Rush", "Aviator X", "Gem Drop", "Hot Dice", "Neon Keno",
];
const PLACEHOLDER_HUES = [
  "linear-gradient(160deg, #35548f 0%, #1b2d55 70%)",
  "linear-gradient(160deg, #7a5a2c 0%, #3d2c14 70%)",
  "linear-gradient(160deg, #2c6e5a 0%, #143528 70%)",
  "linear-gradient(160deg, #6e3a63 0%, #341a30 70%)",
];
const PLACEHOLDERS = PLACEHOLDER_TITLES.map((title, i) => ({
  key: `soon-${i}`, title, soon: true, hue: PLACEHOLDER_HUES[i % PLACEHOLDER_HUES.length],
}));

const ALL_TILES = [...GAMES, ...PLACEHOLDERS];
const PER_PAGE = 12; // 6 columns × 2 rows per swipe page
const PAGES = [];
for (let i = 0; i < ALL_TILES.length; i += PER_PAGE) PAGES.push(ALL_TILES.slice(i, i + PER_PAGE));

// Portrait art tile — the tile IS the button; the game name is overlaid on a
// bottom scrim, like a game logo on a multi-game machine.
function GameTile({ game, onOpen }) {
  const enabled = !game.soon;
  return (
    <button
      onClick={() => enabled && onOpen(game)}
      disabled={!enabled}
      className="kiosk-tile"
      style={{
        // Width-driven with a hard 3:4 ratio — the art is 600×800 and must
        // never be cropped narrow by row height. Press feedback lives in
        // CSS :active (kiosk-tile) so a drag can never leave a tile stuck
        // in its pressed state.
        position: "relative", width: "100%", aspectRatio: "3 / 4",
        borderRadius: 14, overflow: "hidden",
        padding: 0, background: "var(--surface)", boxSizing: "border-box",
        border: "1px solid var(--border)",
        cursor: enabled ? "pointer" : "default",
      }}>
      {enabled ? (
        <span style={{ position: "absolute", inset: 0 }}>
          <GameArt game={game.key} />
        </span>
      ) : (
        <span style={{ position: "absolute", inset: 0, background: game.hue, filter: "saturate(0.5) brightness(0.8)" }} />
      )}
      <span style={{
        position: "absolute", left: 0, right: 0, bottom: 0, padding: "38px 8px 14px",
        display: "flex", flexDirection: "column", alignItems: "center",
        background: "linear-gradient(180deg, transparent, rgba(5,9,15,0.85) 62%)",
      }}>
        <span style={{ fontFamily: "'Unbounded', var(--font-display)", fontWeight: 800, fontSize: 12.5, letterSpacing: "0.04em", textTransform: "uppercase", color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,0.5)", textAlign: "center", lineHeight: 1.25 }}>
          {game.title}
        </span>
      </span>
      {!enabled && (
        <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", padding: "3px 8px", borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.2)" }}>
          SOON
        </span>
      )}
    </button>
  );
}

function PagerArrow({ dir, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={dir === "left" ? "Previous games" : "More games"}
      style={{
        position: "absolute", top: "50%", transform: "translateY(-50%)",
        [dir]: 12, zIndex: 2, width: 60, height: 96, borderRadius: 14,
        border: "1px solid var(--border)", background: "rgba(26,40,54,0.92)",
        color: "var(--text)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.25 : 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "opacity var(--dur-fast)",
      }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {dir === "left" ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </button>
  );
}

export default function LobbyPage() {
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState(0);
  const pagerRef = useRef(null);
  const trackRef = useRef(null);
  const pageRef = useRef(0);   // authoritative page for pointer math (state lags)
  const drag = useRef(null);   // { startX, lastX, lastT, vx, moved }
  const navigate = useNavigate();

  useEffect(() => () => document.body.classList.remove("kb-paused"), []);

  useEffect(() => {
    apiGet("/api/me").then(({ ok }) => {
      // The gate establishes the machine session before this page renders;
      // if it's gone (expired token, API restart), reload so the gate can
      // re-handshake — or surface its error screen if the API is down.
      if (!ok) return window.location.reload();
      setReady(true);
    });
  }, []);

  // ── phone-launcher pager ──────────────────────────────────────────────
  // The track follows the pointer 1:1 while dragging (no transition), then
  // glides to the chosen page on a GPU transform transition. A quick flick
  // commits to the next page immediately; a slow drag needs to pass 25% of
  // the screen; anything less springs back.
  const pageX = (p) => -p * (pagerRef.current?.clientWidth || 0);
  const setX = (px, animate) => {
    const t = trackRef.current;
    if (!t) return;
    t.style.transition = animate ? "transform 560ms cubic-bezier(0.25, 1, 0.4, 1)" : "none";
    t.style.transform = `translate3d(${px}px, 0, 0)`;
  };
  const goTo = (p, animate = true) => {
    const clamped = Math.max(0, Math.min(PAGES.length - 1, p));
    pageRef.current = clamped;
    setPage(clamped);
    setX(pageX(clamped), animate);
  };

  useEffect(() => {
    if (!ready) return;
    goTo(0, false);
    const onResize = () => goTo(pageRef.current, false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [ready]);

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    drag.current = { id: e.pointerId, startX: e.clientX, lastX: e.clientX, lastT: performance.now(), vx: 0, moved: false };
    document.body.classList.add("kb-paused");
    setX(pageX(pageRef.current), false); // kill any in-flight transition
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) d.vx = (e.clientX - d.lastX) / dt; // px per ms, signed
    d.lastX = e.clientX;
    d.lastT = now;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 8) {
      // It's a drag, not a tap — only NOW take the pointer, so plain taps
      // keep delivering their click to the tile under the finger.
      d.moved = true;
      pagerRef.current.setPointerCapture?.(d.id);
    }
    let x = pageX(pageRef.current) + dx;
    // rubber-band past the first/last page
    const min = pageX(PAGES.length - 1);
    if (x > 0) x *= 0.35;
    else if (x < min) x = min + (x - min) * 0.35;
    setX(x, false);
  };
  const endDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.classList.remove("kb-paused");
    const dx = e.clientX - d.startX;
    const width = pagerRef.current?.clientWidth || 1;
    let dir = 0;
    if (Math.abs(d.vx) > 0.45 && Math.abs(dx) > 30) dir = d.vx < 0 ? 1 : -1; // flick
    else if (Math.abs(dx) > width * 0.25) dir = dx < 0 ? 1 : -1;             // long drag
    goTo(pageRef.current + dir);
  };
  // A real drag must not fire the tile underneath the finger on release.
  const onClickCapture = (e) => {
    if (drag.current?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  if (!ready) return <LoadingScreen />;

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", color: "var(--text)", fontFamily: "var(--font-body)", overflow: "hidden", position: "relative" }}>
      <KioskBackground />

      {/* game pages — drag/swipe left/right, never any vertical scroll */}
      <div style={{ flex: "1 1 auto", minHeight: 0, position: "relative", zIndex: 1 }}>
        <div ref={pagerRef} className="kiosk-pager"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={endDrag} onPointerCancel={endDrag}
          onClickCapture={onClickCapture}>
          <div ref={trackRef} className="kiosk-track">
            {PAGES.map((games, i) => (
              <div key={i} className="kiosk-page" style={{ padding: "20px 92px 44px" }}>
                <div style={{
                  height: "100%", maxWidth: 1160, margin: "0 auto",
                  display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16,
                  alignContent: "center",
                }}>
                  {games.map((g) => <GameTile key={g.key} game={g} onOpen={(game) => navigate(game.path)} />)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {PAGES.length > 1 && (
          <>
            <PagerArrow dir="left" onClick={() => goTo(page - 1)} disabled={page === 0} />
            <PagerArrow dir="right" onClick={() => goTo(page + 1)} disabled={page >= PAGES.length - 1} />
            {/* page dots — in the reserved bottom gutter, never over tiles */}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 14, display: "flex", justifyContent: "center", gap: 10, zIndex: 2 }}>
              {PAGES.map((_, i) => (
                <button key={i} onClick={() => goTo(i)} aria-label={`Page ${i + 1}`}
                  style={{
                    width: i === page ? 26 : 10, height: 10, borderRadius: 999, border: "none", cursor: "pointer", padding: 0,
                    background: i === page ? "var(--mint-bright)" : "rgba(147,164,196,0.4)",
                    transition: "width 220ms cubic-bezier(0.22,1,0.36,1), background var(--dur-fast)",
                  }} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* wallet bar — always visible, credits + cash out only */}
      <div style={{ flex: "0 0 auto", height: 84, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 26px", borderTop: "1px solid var(--border)", background: "rgba(24,36,49,0.97)", position: "relative", zIndex: 1 }}>
        <BalanceReadout large />
        <CashOutButton large />
      </div>
    </div>
  );
}
