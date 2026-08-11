import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api";
import BlackjackGame from "../components/BlackjackGame";
import { LoadingScreen } from "../components/mint/LoadingScreen";

export default function BlackjackPage() {
  const [balance, setBalance] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiGet("/api/me").then(({ ok, data }) => {
      if (!ok || !data.direct) return navigate("/login"); // in-house accounts only
      setBalance(data.balance);
    });
  }, []);

  if (balance === null) return <LoadingScreen label="Shuffling up" />;

  return <BlackjackGame initialBalance={balance} onHome={() => navigate("/")} />;
}
