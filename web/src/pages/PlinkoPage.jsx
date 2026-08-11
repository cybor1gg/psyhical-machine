import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api";
import PlinkoGame from "../components/PlinkoGame";
import { LoadingScreen } from "../components/mint/LoadingScreen";

export default function PlinkoPage() {
  const [balance, setBalance] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiGet("/api/me").then(({ ok, data }) => {
      if (!ok || !data.direct) return navigate("/login"); // in-house accounts only
      setBalance(data.balance);
    });
  }, []);

  if (balance === null) return <LoadingScreen label="Racking the pins" />;

  return <PlinkoGame initialBalance={balance} onHome={() => navigate("/")} />;
}
