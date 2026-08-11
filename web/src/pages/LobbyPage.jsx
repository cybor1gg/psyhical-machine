// MintBets lobby — the landing screen for direct players. Games are listed
// from a local registry for now; when game #2 (Crash) lands this becomes the
// natural place to surface it. Operators never see this page: embed launches
// go straight to /embed/<game>.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { GameArt } from "../components/mint/GameArt";
import { LoadingScreen } from "../components/mint/LoadingScreen";

const GAMES = [
  {
    key: "hilo",
    title: "Hi-Lo",
    tag: "Cards",
    path: "/games/hilo",
    live: true,
    blurb: "Higher or lower. Ride the streak, cash out any time.",
  },
  {
    key: "blackjack",
    title: "Blackjack",
    tag: "Cards",
    path: "/games/blackjack",
    live: true,
    blurb: "Beat the dealer to 21. Blackjack pays 3:2, dealer stands on 17.",
  },
  {
    key: "war",
    title: "War",
    tag: "Cards",
    path: "/games/war",
    live: true,
    blurb: "Highest card wins. A tie means war: surrender or double down.",
  },
  {
    key: "tower",
    title: "Dragon Tower",
    tag: "Climb",
    path: "/games/tower",
    live: true,
    blurb: "Climb nine rows of eggs and dragons. Cash out before you burn.",
  },
  {
    key: "mines",
    title: "Mines",
    tag: "Grid",
    path: "/games/mines",
    live: true,
    blurb: "Clear the field, dodge the bombs. Cash out any time.",
  },
  {
    key: "chicken",
    title: "Chicken Cross",
    tag: "Climb",
    path: "/games/chicken",
    live: true,
    blurb: "Cross the traffic one lane at a time. Cash out before the cars do.",
  },
  {
    key: "dice",
    title: "Dice",
    tag: "Instant",
    path: "/games/dice",
    live: true,
    blurb: "Set your target, roll over or under. Instant results.",
  },
  {
    key: "limbo",
    title: "Limbo",
    tag: "Instant",
    path: "/games/limbo",
    live: true,
    blurb: "Name your multiplier. The roll has to reach it.",
  },
  {
    key: "plinko",
    title: "Plinko",
    tag: "Instant",
    path: "/games/plinko",
    live: true,
    blurb: "Drop the ball, ride the bounces. Edges pay big.",
  },
  {
    key: "keno",
    title: "Keno",
    tag: "Numbers",
    path: "/games/keno",
    live: true,
    blurb: "Pick up to ten numbers. Ten are drawn. Hits pay.",
  },
  {
    key: "roulette",
    title: "Roulette",
    tag: "Table",
    path: "/games/roulette",
    live: true,
    blurb: "Single-zero European wheel. Straight up pays 35:1.",
  },
  {
    key: "baccarat",
    title: "Baccarat",
    tag: "Table",
    path: "/games/baccarat",
    live: true,
    blurb: "Player, Banker or Tie. Closest to nine takes it.",
  },
  {
    key: "crash",
    title: "Crash",
    tag: "Coming soon",
    live: false,
    blurb: "Watch the multiplier climb. Bail before it busts.",
  },
];

// Portrait art tile — the tile IS the button, name + provider overlaid on a
// bottom scrim, art fills the card.
function GameTile({ game, onOpen }) {
  const [hover, setHover] = useState(false);
  const enabled = game.live;
  return (
    <button
      onClick={() => enabled && onOpen(game)}
      disabled={!enabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={game.blurb}
      style={{
        position: "relative", aspectRatio: "3 / 4", borderRadius: 14, overflow: "hidden",
        padding: 0, background: "var(--surface)", boxSizing: "border-box",
        border: `1px solid ${enabled && hover ? "var(--mint-32)" : "var(--border)"}`,
        boxShadow: enabled && hover ? "0 14px 32px rgba(0,0,0,0.45), var(--glow-mint)" : "var(--shadow-sm)",
        transform: enabled && hover ? "translateY(-5px)" : "none",
        cursor: enabled ? "pointer" : "default",
        transition: "transform 180ms cubic-bezier(0.22,1,0.36,1), box-shadow var(--dur-fast), border-color var(--dur-fast)",
        animation: "mb-rise var(--dur-base) var(--ease-out)",
      }}>
      {enabled ? (
        <span style={{ position: "absolute", inset: 0, transform: hover ? "scale(1.05)" : "scale(1)", transition: "transform 300ms cubic-bezier(0.22,1,0.36,1)" }}>
          <GameArt game={game.key} />
        </span>
      ) : (
        <span style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          background: game.key === "crash"
            ? "linear-gradient(160deg, #35548f 0%, #1b2d55 70%)"
            : "linear-gradient(160deg, #7a5a2c 0%, #3d2c14 70%)",
          filter: "saturate(0.45) brightness(0.75)",
        }} />
      )}
      {/* bottom scrim + labels */}
      <span style={{
        position: "absolute", left: 0, right: 0, bottom: 0, padding: "44px 10px 22px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        background: "linear-gradient(180deg, transparent, rgba(5,9,15,0.85) 62%)",
      }}>
        <span style={{ fontFamily: "'Unbounded', var(--font-display)", fontWeight: 800, fontSize: 14.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,0.5)", textAlign: "center", lineHeight: 1.25 }}>
          {game.title}
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)" }}>
          MTech
        </span>
      </span>
      {!enabled && (
        <span style={{ position: "absolute", top: 10, right: 10, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", padding: "3px 9px", borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.2)" }}>
          SOON
        </span>
      )}
    </button>
  );
}

export default function LobbyPage() {
  const [me, setMe] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiGet("/api/me").then(({ ok, data }) => {
      // The lobby is for IN-HOUSE accounts only. Operator players (embed
      // token sessions) get bounced to login instead of seeing a foreign
      // balance here — their home is the casino that launched them.
      if (!ok || !data.direct) return navigate("/login");
      setMe(data);
    });
  }, []);

  if (!me) return <LoadingScreen />;
  const balance = me.balance;

  return (
    <div style={{ minHeight: "100dvh", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      {/* topbar */}
      <div style={{ height: 54, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16, letterSpacing: "0.02em" }}>
          <span style={{ color: "var(--mint-bright)" }}>Mint</span>Bets
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="/verify" target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: "var(--fs-sm)", fontWeight: 600, textDecoration: "none" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" /><path d="M9 12l2 2 4-4" /></svg>
            Fair Play
          </a>
          {/* who is signed in — always visible so a session mix-up is obvious */}
          <span title="Signed in as" style={{ display: "inline-flex", alignItems: "center", gap: 7, maxWidth: 220, padding: "6px 11px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", color: "var(--text-muted)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>{me.email}</span>
          </span>
          <span style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 14, padding: "6px 11px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
            ${Number(balance).toFixed(2)}
          </span>
          <button
            onClick={() => apiPost("/api/auth/logout").then(() => navigate("/login"))}
            style={{ height: 40, padding: "0 12px", background: "transparent", border: "1px solid var(--border)", borderRadius: "var(--r-md)", color: "var(--text-muted)", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--fs-sm)" }}>
            Log out
          </button>
        </span>
      </div>

      {/* hero */}
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "34px 18px 10px" }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "var(--fs-2xl)", letterSpacing: "var(--ls-tight)", animation: "mb-rise var(--dur-base) var(--ease-out)" }}>
          Originals
        </h1>
        <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: "var(--fs-base)", maxWidth: 520, lineHeight: 1.55, animation: "mb-fade-in var(--dur-slow) var(--ease-out)" }}>
          Provably fair, built in-house. Every card is verifiable. Check any round on the Fair Play page.
        </p>
      </div>

      {/* games grid */}
      <div style={{
        maxWidth: 980, margin: "0 auto", padding: "18px 18px 40px",
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(158px, 1fr))", gap: 13,
      }}>
        {GAMES.map((g) => <GameTile key={g.key} game={g} onOpen={(game) => navigate(game.path)} />)}
      </div>
    </div>
  );
}
