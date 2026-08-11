// Cabinet lobby — a slot-machine style game-select screen: nothing but game
// art tiles, with the wallet bar (live credits + Cash Out) pinned to the
// bottom of the screen. No navbar, no copy, no machine identity on screen.
import { useState, useEffect } from "react";
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
        position: "relative", aspectRatio: "3 / 4", borderRadius: 16, overflow: "hidden",
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

export default function LobbyPage() {
  const [ready, setReady] = useState(false);
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

  if (!ready) return <LoadingScreen />;

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", color: "var(--text)", fontFamily: "var(--font-body)", overflow: "hidden", position: "relative" }}>
      <KioskBackground />
      {/* games grid — the whole screen except the wallet bar */}
      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "26px 22px", position: "relative", zIndex: 1 }}>
        <div style={{
          maxWidth: 1180, margin: "0 auto",
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16,
        }}>
          {GAMES.map((g) => <GameTile key={g.key} game={g} onOpen={(game) => navigate(game.path)} />)}
        </div>
      </div>

      {/* wallet bar — always visible, credits + cash out only */}
      <div style={{ flex: "0 0 auto", height: 84, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 26px", borderTop: "1px solid var(--border)", background: "rgba(26,40,54,0.88)", backdropFilter: "blur(8px)", position: "relative", zIndex: 1 }}>
        <BalanceReadout large />
        <CashOutButton large />
      </div>
    </div>
  );
}
