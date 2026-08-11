import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api";
import TowerGame from "../components/TowerGame";
import { LoadingScreen } from "../components/mint/LoadingScreen";

export default function TowerPage() {
  const [balance, setBalance] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiGet("/api/me").then(({ ok, data }) => {
      if (!ok || !data.direct) return navigate("/login"); // in-house accounts only
      setBalance(data.balance);
    });
  }, []);

  if (balance === null) return <LoadingScreen label="Waking the dragon" />;

  return <TowerGame initialBalance={balance} onHome={() => navigate("/")} />;
}
