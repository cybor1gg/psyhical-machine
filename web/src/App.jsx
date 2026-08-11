import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import LobbyPage from "./pages/LobbyPage";
import HiloPage from "./pages/HiloPage";
import BlackjackPage from "./pages/BlackjackPage";
import WarPage from "./pages/WarPage";
import TowerPage from "./pages/TowerPage";
import DicePage from "./pages/DicePage";
import LimboPage from "./pages/LimboPage";
import MinesPage from "./pages/MinesPage";
import PlinkoPage from "./pages/PlinkoPage";
import KenoPage from "./pages/KenoPage";
import RoulettePage from "./pages/RoulettePage";
import BaccaratPage from "./pages/BaccaratPage";
import ChickenPage from "./pages/ChickenPage";
import VerifyPage from "./pages/VerifyPage";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminBets from "./pages/admin/AdminBets";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/games/hilo" element={<HiloPage />} />
        <Route path="/games/blackjack" element={<BlackjackPage />} />
        <Route path="/games/war" element={<WarPage />} />
        <Route path="/games/tower" element={<TowerPage />} />
        <Route path="/games/dice" element={<DicePage />} />
        <Route path="/games/limbo" element={<LimboPage />} />
        <Route path="/games/mines" element={<MinesPage />} />
        <Route path="/games/plinko" element={<PlinkoPage />} />
        <Route path="/games/keno" element={<KenoPage />} />
        <Route path="/games/roulette" element={<RoulettePage />} />
        <Route path="/games/baccarat" element={<BaccaratPage />} />
        <Route path="/games/chicken" element={<ChickenPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        {/* cabinet backoffice (admin role) */}
        <Route path="/admin" element={<Navigate to="/admin/bets" replace />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
        <Route path="/admin/bets" element={<AdminBets />} />
        {/* Unknown URLs land in the lobby. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
