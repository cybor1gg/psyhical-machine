import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api";
import MinesGame from "../components/MinesGame";
import { LoadingScreen } from "../components/mint/LoadingScreen";

export default function MinesPage() {
  const [balance, setBalance] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiGet("/api/me").then(({ ok, data }) => {
      if (!ok) return window.location.reload(); // gate re-handshakes the machine session
      setBalance(data.balance);
    });
  }, []);

  if (balance === null) return <LoadingScreen label="Burying the mines" />;

  return <MinesGame initialBalance={balance} onHome={() => navigate("/")} />;
}
