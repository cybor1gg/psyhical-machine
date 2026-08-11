import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api";
import ChickenGame from "../components/ChickenGame";
import { LoadingScreen } from "../components/mint/LoadingScreen";

export default function ChickenPage() {
  const [balance, setBalance] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiGet("/api/me").then(({ ok, data }) => {
      if (!ok || !data.direct) return navigate("/login"); // in-house accounts only
      setBalance(data.balance);
    });
  }, []);

  if (balance === null) return <LoadingScreen label="Waking the hen" />;

  return <ChickenGame initialBalance={balance} onHome={() => navigate("/")} />;
}
