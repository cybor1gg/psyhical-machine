// Shared bits for the /admin pages: nav definition + the role guard.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../../api";

const icon = (d) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

export const ADMIN_NAV = [
  { path: "/admin", label: "Dashboard", icon: icon("M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10") },
  { path: "/admin/bets", label: "Bets", icon: icon("M3 3v18h18M18 9l-5 5-4-4-3 3") },
  { path: "/admin/settings", label: "Platform settings", icon: icon("M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z") },
];

// Client-side gate for admin pages (the server enforces role on every call;
// this just routes non-admins away instead of showing them errors).
// Uses /api/admin/me, NOT /api/me: on a kiosk the machine's own session
// answers /api/me, which used to bounce admins to the lobby before they
// could ever log in.
export function useAdminGuard() {
  const [state, setState] = useState({ ready: false, email: null });
  const navigate = useNavigate();
  useEffect(() => {
    apiGet("/api/admin/me").then(({ ok, data }) => {
      if (!ok) return navigate("/login");
      setState({ ready: true, email: data.email });
    });
  }, []);
  return state;
}
