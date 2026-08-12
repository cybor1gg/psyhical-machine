import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import MenuPage from "./space/MenuPage";
import MinesSpace from "./space/MinesSpace";
import PlinkoSpace from "./space/PlinkoSpace";
import KenoSpace from "./space/KenoSpace";
import DiceSpace from "./space/DiceSpace";
import LimboSpace from "./space/LimboSpace";
import BlackjackSpace from "./space/BlackjackSpace";
import HiloPage from "./pages/HiloPage";
import WarPage from "./pages/WarPage";
import TowerPage from "./pages/TowerPage";
import RoulettePage from "./pages/RoulettePage";
import BaccaratPage from "./pages/BaccaratPage";
import ChickenPage from "./pages/ChickenPage";
import VerifyPage from "./pages/VerifyPage";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminBets from "./pages/admin/AdminBets";
import CabinetGate from "./kiosk/CabinetGate";
import CashSimulator from "./kiosk/CashSimulator";

export default function App() {
  const staff = /^\/(admin|login|verify)/.test(window.location.pathname);
  return (
    <CabinetGate>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MenuPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/games/hilo" element={<HiloPage />} />
        <Route path="/games/blackjack" element={<BlackjackSpace />} />
        <Route path="/games/war" element={<WarPage />} />
        <Route path="/games/tower" element={<TowerPage />} />
        <Route path="/games/dice" element={<DiceSpace />} />
        <Route path="/games/limbo" element={<LimboSpace />} />
        <Route path="/games/mines" element={<MinesSpace />} />
        <Route path="/games/plinko" element={<PlinkoSpace />} />
        <Route path="/games/keno" element={<KenoSpace />} />
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
      {!staff && <CashSimulator />}
    </BrowserRouter>
    </CabinetGate>
  );
}
