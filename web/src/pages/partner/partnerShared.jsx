// Shared bits for the /partner pages: nav + session guard.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../../api";

const icon = (d) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

export const PARTNER_NAV = [
  { path: "/partner", end: true, label: "Dashboard", icon: icon("M3 3v18h18M7 15l4-4 3 3 5-6") },
  { path: "/partner/settings", label: "Game settings", icon: icon("M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z") },
];

export function usePartnerGuard() {
  const [state, setState] = useState({ ready: false, email: null, operator: null });
  const navigate = useNavigate();
  useEffect(() => {
    apiGet("/api/partner/me").then(({ ok, data }) => {
      if (!ok) return navigate("/partner/login");
      setState({ ready: true, email: data.email, operator: data.operator });
    });
  }, []);
  return state;
}
