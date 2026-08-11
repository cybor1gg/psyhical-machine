import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api";
import KenoGame from "../components/KenoGame";
import { LoadingScreen } from "../components/mint/LoadingScreen";

export default function KenoPage() {
  const [balance, setBalance] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiGet("/api/me").then(({ ok, data }) => {
      if (!ok) return window.location.reload(); // gate re-handshakes the machine session
      setBalance(data.balance);
    });
  }, []);

  if (balance === null) return <LoadingScreen label="Polishing the numbers" />;

  return <KenoGame initialBalance={balance} onHome={() => navigate("/")} />;
}
