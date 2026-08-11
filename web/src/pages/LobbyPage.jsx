// Cabinet lobby — a slot-machine style game-select screen: pages of game art
// tiles that fit the screen exactly (no vertical scroll anywhere) and swipe
// left/right on the touchscreen, with page dots and arrow buttons. The
// wallet bar (live credits + Cash Out) is pinned to the bottom.
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

const PER_PAGE = 8; // 4 columns × 2 rows per swipe page
const PAGES = [];
for (let i = 0; i < GAMES.length; i += PER_PAGE) PAGES.push(GAMES.slice(i, i + PER_PAGE));

// Portrait art tile — the tile IS the button; the game name is overlaid on a
// bottom scrim, like a game logo on a multi-game machine.
function GameTile({ game, onOpen }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={() => onOpen(game)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        position: "relative", height: "100%", maxWidth: "100%", aspectRatio: "3 / 4",
        justifySelf: "center", borderRadius: 16, overflow: "hidden",
        padding: 0, background: "var(--surface)", boxSizing: "border-box",
        border: `1px solid ${pressed ? "var(--mint-32)" : "var(--border)"}`,
        boxShadow: pressed ? "0 6px 18px rgba(0,0,0,0.5), var(--glow-mint)" : "var(--shadow-sm)",
        transform: pressed ? "scale(0.97)" : "none",
        cursor: "pointer",
        transition: "transform 120ms cubic-bezier(0.22,1,0.36,1), box-shadow var(--dur-fast), border-color var(--dur-fast)",
        animation: "mb-rise var(--dur-base) var(--ease-out)",
      }}>
      <span style={{ position: "absolute", inset: 0 }}>
        <GameArt game={game.key} />
      </span>
      <span style={{
        position: "absolute", left: 0, right: 0, bottom: 0, padding: "44px 10px 18px",
        display: "flex", flexDirection: "column", alignItems: "center",
        background: "linear-gradient(180deg, transparent, rgba(5,9,15,0.85) 62%)",
      }}>
        <span style={{ fontFamily: "'Unbounded', var(--font-display)", fontWeight: 800, fontSize: 15.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,0.5)", textAlign: "center", lineHeight: 1.25 }}>
          {game.title}
        </span>
      </span>
    </button>
  );
}

function PagerArrow({ dir, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={dir === "left" ? "Previous games" : "More games"}
      style={{
        position: "absolute", top: "50%", transform: "translateY(-50%)",
        [dir]: 10, zIndex: 2, width: 56, height: 84, borderRadius: 14,
        border: "1px solid var(--border)", background: "rgba(26,40,54,0.72)", backdropFilter: "blur(6px)",
        color: "var(--text)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.25 : 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "opacity var(--dur-fast)",
      }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {dir === "left" ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </button>
  );
}

export default function LobbyPage() {
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState(0);
  const pagerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiGet("/api/me").then(({ ok }) => {
      // The gate establishes the machine session before this page renders;
      // if it's gone (expired token, API restart), reload so the gate can
      // re-handshake — or surface its error screen if the API is down.
      if (!ok) return window.location.reload();
      setReady(true);
    });
  }, []);

  // Manual ease-out animation for arrows/dots. Chrome rejects any
  // programmatic scroll position that isn't a snap point on a mandatory-snap
  // container (and reverts smooth scrolls entirely), so the snap is lifted
  // for the ~300ms of animation and restored on the final frame. Finger
  // swipes never come through here — they pan natively under the snap.
  const goTo = (p) => {
    const el = pagerRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(PAGES.length - 1, p));
    setPage(clamped); // arrows/dots never wait on scroll events
    const target = clamped * el.clientWidth;
    const from = el.scrollLeft;
    const start = performance.now();
    const DUR = 300;
    el.style.scrollSnapType = "none";
    // Timer-driven (not requestAnimationFrame): time-based easing finishes
    // in bounded ticks even when the page isn't compositing frames.
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / DUR);
      const ease = 1 - (1 - t) ** 3;
      el.scrollLeft = from + (target - from) * ease;
      if (t < 1) {
        setTimeout(step, 16);
      } else {
        el.scrollLeft = target;
        el.style.scrollSnapType = "";
      }
    };
    step();
  };
  const onScroll = () => {
    const el = pagerRef.current;
    if (!el) return;
    setPage(Math.round(el.scrollLeft / el.clientWidth));
  };

  if (!ready) return <LoadingScreen />;

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", color: "var(--text)", fontFamily: "var(--font-body)", overflow: "hidden", position: "relative" }}>
      <KioskBackground />

      {/* game pages — swipe left/right, never any vertical scroll */}
      <div style={{ flex: "1 1 auto", minHeight: 0, position: "relative", zIndex: 1 }}>
        <div ref={pagerRef} onScroll={onScroll} className="kiosk-pager" style={{ height: "100%" }}>
          {PAGES.map((games, i) => (
            <div key={i} className="kiosk-page" style={{ padding: "26px 84px 12px" }}>
              <div style={{
                height: "100%", maxWidth: 1080, margin: "0 auto",
                display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gridTemplateRows: "1fr 1fr", gap: 16,
              }}>
                {games.map((g) => <GameTile key={g.key} game={g} onOpen={(game) => navigate(game.path)} />)}
              </div>
            </div>
          ))}
        </div>

        {PAGES.length > 1 && (
          <>
            <PagerArrow dir="left" onClick={() => goTo(page - 1)} disabled={page === 0} />
            <PagerArrow dir="right" onClick={() => goTo(page + 1)} disabled={page >= PAGES.length - 1} />
            {/* page dots */}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 6, display: "flex", justifyContent: "center", gap: 10, zIndex: 2 }}>
              {PAGES.map((_, i) => (
                <button key={i} onClick={() => goTo(i)} aria-label={`Page ${i + 1}`}
                  style={{
                    width: i === page ? 26 : 10, height: 10, borderRadius: 999, border: "none", cursor: "pointer",
                    background: i === page ? "var(--mint-bright)" : "rgba(147,164,196,0.4)",
                    transition: "width 220ms cubic-bezier(0.22,1,0.36,1), background var(--dur-fast)",
                  }} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* wallet bar — always visible, credits + cash out only */}
      <div style={{ flex: "0 0 auto", height: 84, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 26px", borderTop: "1px solid var(--border)", background: "rgba(26,40,54,0.88)", backdropFilter: "blur(8px)", position: "relative", zIndex: 1 }}>
        <BalanceReadout large />
        <CashOutButton large />
      </div>
    </div>
  );
}
