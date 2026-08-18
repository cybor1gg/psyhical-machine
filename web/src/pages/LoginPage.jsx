// Staff login — admins only, on the cabinet's own touchscreen. Players never
// see this page: the machine authenticates itself, and there is no player
// registration on a cabinet.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api";
import "./admin/dash.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit() {
    setError(""); setBusy(true);
    const { ok, data } = await apiPost("/api/auth/login", { email, password });
    setBusy(false);
    if (!ok) { setError((data?.error || "Something went wrong").toUpperCase()); return; }
    navigate(data.role === "operator" ? "/operator" : "/admin");
  }

  return (
    <div className="ad-root ad-login">
      <div className="ad-login-card">
        <b className="ad-login-title">BACKOFFICE</b>
        <span className="ad-login-sub">STAFF ONLY</span>
        <input className="ad-input" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)} placeholder="EMAIL" />
        <input className="ad-input" type="password" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="PASSWORD" />
        {error && <span className="ad-login-error">{error}</span>}
        <button type="button" className="ad-save wide" disabled={busy} onClick={submit}>LOG IN</button>
        <button type="button" className="ad-ghost wide" onClick={() => navigate("/")}>BACK TO THE MACHINE</button>
      </div>
    </div>
  );
}
