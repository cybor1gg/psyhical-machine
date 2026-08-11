// Staff login — admins only. Players never see this page: the machine
// authenticates itself, and there is no player registration on a cabinet.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function submit() {
    setError("");
    const { ok, data } = await apiPost("/api/auth/login", { email, password });
    if (!ok) {
      setError(data.error || "Something went wrong");
      return;
    }
    navigate("/admin");
  }

  return (
    <main className="max-w-sm mx-auto mt-24 px-4">
      <h1 className="text-2xl font-bold mb-6">Staff log in</h1>

      <div className="space-y-3">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="w-full border rounded px-3 py-2"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Password"
          className="w-full border rounded px-3 py-2"
        />
        <button
          onClick={submit}
          className="w-full bg-blue-600 text-white py-2 rounded font-semibold"
        >
          Log in
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </main>
  );
}
