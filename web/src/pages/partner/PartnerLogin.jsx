// Partner portal login — the page operators land on from their invite.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../../api";
import { Btn, TextInput, Card } from "../../components/office/kit";

export default function PartnerLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    const { ok, data } = await apiPost("/api/partner/login", { email, password });
    setBusy(false);
    if (!ok) return setError(data.error || "Login failed");
    navigate("/partner");
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)", padding: 16 }}>
      <Card style={{ width: 400, maxWidth: "100%", padding: 28 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginBottom: 4 }}>
          <span style={{ color: "var(--mint-bright)" }}>M</span>Tech Partner Portal
        </div>
        <p style={{ margin: "0 0 20px", color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>
          Operator backoffice: reports, revenue and game settings.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <TextInput value={email} onChange={setEmail} placeholder="Email" autoFocus />
          <TextInput value={password} onChange={setPassword} placeholder="Password" type="password"
            onKeyDown={(e) => e.key === "Enter" && submit()} />
          {error && <div style={{ color: "var(--loss)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>{error}</div>}
          <Btn onClick={submit} disabled={busy || !email || !password}>{busy ? "Signing in…" : "Sign in"}</Btn>
        </div>
      </Card>
    </div>
  );
}
