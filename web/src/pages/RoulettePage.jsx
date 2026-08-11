import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api";
import RouletteGame from "../components/RouletteGame";
import { LoadingScreen } from "../components/mint/LoadingScreen";

export default function RoulettePage() {
  const [balance, setBalance] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiGet("/api/me").then(({ ok, data }) => {
      if (!ok || !data.direct) return navigate("/login"); // in-house accounts only
      setBalance(data.balance);
    });
  }, []);

  if (balance === null) return <LoadingScreen label="Spinning up the wheel" />;

  return <RouletteGame initialBalance={balance} onHome={() => navigate("/")} />;
}
