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
import EmbedPage from "./pages/EmbedPage";
import VerifyPage from "./pages/VerifyPage";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminOperatorDetail from "./pages/admin/AdminOperatorDetail";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminBets from "./pages/admin/AdminBets";
import PartnerLogin from "./pages/partner/PartnerLogin";
import PartnerDashboard from "./pages/partner/PartnerDashboard";
import PartnerSettings from "./pages/partner/PartnerSettings";

function DocsRedirect() {
  window.location.replace("/docs/index.html");
  return null;
}

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
        {/* one embed route per game — the page itself picks the component
            from the exchange response's gameType */}
        <Route path="/embed/:gameType" element={<EmbedPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        {/* Operator guide is a static page in /public/docs; hosts with SPA
            fallback route bare /docs here, so bounce to the real file. */}
        <Route path="/docs" element={<DocsRedirect />} />
        {/* provider backoffice (admin role) */}
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/operators/:id" element={<AdminOperatorDetail />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
        <Route path="/admin/bets" element={<AdminBets />} />
        {/* partner portal (operator realm, own cookie) */}
        <Route path="/partner/login" element={<PartnerLogin />} />
        <Route path="/partner" element={<PartnerDashboard />} />
        <Route path="/partner/settings" element={<PartnerSettings />} />
        {/* Unknown URLs land in the lobby, which enforces login itself. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}