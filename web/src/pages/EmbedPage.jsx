import { seedBalance } from "../lib/operatorBridge";
import { useState, useEffect } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import { apiGet, apiPost, setSessionToken } from "../api";
import { setBrandName, setDemoMode } from "../lib/brand";
import HiloGame from "../components/HiloGame";
import BlackjackGame from "../components/BlackjackGame";
import WarGame from "../components/WarGame";
import TowerGame from "../components/TowerGame";
import DiceGame from "../components/DiceGame";
import LimboGame from "../components/LimboGame";
import MinesGame from "../components/MinesGame";
import PlinkoGame from "../components/PlinkoGame";
import KenoGame from "../components/KenoGame";
import RouletteGame from "../components/RouletteGame";
import BaccaratGame from "../components/BaccaratGame";
import ChickenGame from "../components/ChickenGame";
import { LoadingScreen } from "../components/mint/LoadingScreen";

// The exchange response's gameType is authoritative (the token was minted for
// a specific game); the URL param is only the fallback for the refresh path.
const GAMES = {
  hilo: HiloGame, blackjack: BlackjackGame, war: WarGame, tower: TowerGame,
  dice: DiceGame, limbo: LimboGame, mines: MinesGame, plinko: PlinkoGame, keno: KenoGame, roulette: RouletteGame, baccarat: BaccaratGame, chicken: ChickenGame,
};

// The launch token is ONE-TIME, but this effect can run twice (React StrictMode
// in dev) and players refresh embed pages. Memoize the exchange per token so
// concurrent effect runs share a single request instead of the second one
// burning a 401 and randomly winning the setState race.
const exchanges = new Map(); // token -> Promise<{ok, data}>
function exchangeOnce(token) {
  if (!exchanges.has(token)) {
    exchanges.set(token, apiPost("/api/embed/exchange", { token }));
  }
  return exchanges.get(token);
}

export default function EmbedPage() {
  const [status, setStatus] = useState("loading");
  const [balance, setBalance] = useState(null);
  const [gameType, setGameType] = useState(null);
  const [searchParams] = useSearchParams();
  const params = useParams();

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) return setStatus("error");

    exchangeOnce(token).then(async ({ ok, data }) => {
      if (ok) {
        // Bearer session for mobile: cookies don't survive cross-site
        // iframes there, so the token from the body carries the session.
        if (data.sessionToken) setSessionToken(data.sessionToken);
        setBrandName(data.operatorName);
        setBalance(data.balance);
        // in-house operators expose a launch balance; seamless-wallet ones
        // return null, and the bridge falls back to sending stake deltas
        seedBalance(data.balance);
        setGameType(data.gameType);
        setDemoMode(!!data.demo); // the shared bottom bar renders the DEMO chip
        setStatus("ready");
        return;
      }
      // Token already used — e.g. the player refreshed the iframe. Their
      // session (bearer token restored from sessionStorage, or the cookie
      // where the browser kept it) may still be valid, so try it before
      // showing the error. Balance stays null ("—"): /api/me's balance field
      // is the local wallet, which is meaningless for remote-wallet
      // operators; the next bet response corrects the display.
      const me = await apiGet("/api/me");
      if (me.ok) {
        setStatus("ready");
        return;
      }
      setStatus("error");
    });
  }, []);

  if (status === "loading") return <LoadingScreen label="Loading game" />;
  const Game = GAMES[gameType || params.gameType];
  if (status === "error" || !Game)
    return (
      <p className="text-center mt-24 text-red-600">
        Invalid or expired game session. Please relaunch from the casino.
      </p>
    );

  // The try-mode DEMO chip lives in the shared bottom bar (GameBottombar reads
  // isDemoMode()), so it can never overlap a game's play area on any viewport.
  return <Game initialBalance={balance} />;
}
