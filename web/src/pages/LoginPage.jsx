import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api";

export default function LoginPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function submit() {
    setError("");
    const { ok, data } = await apiPost(`/api/auth/${mode}`, { email, password });

    if (!ok) {
      setError(data.error || "Something went wrong");
      return;
    }

    if (mode === "register") {
      setMode("login");
      setError("Account created. Now log in");
      return;
    }

    navigate("/");
  }

  return (
    <main className="max-w-sm mx-auto mt-24 px-4">
      <h1 className="text-2xl font-bold mb-6">
        {mode === "login" ? "Log in" : "Create account"}
      </h1>

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
          placeholder="Password (min 8 chars)"
          className="w-full border rounded px-3 py-2"
        />
        <button
          onClick={submit}
          className="w-full bg-blue-600 text-white py-2 rounded font-semibold"
        >
          {mode === "login" ? "Log in" : "Register"}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
        className="mt-6 text-sm text-blue-600 underline"
      >
        {mode === "login" ? "Need an account? Register" : "Have an account? Log in"}
      </button>
    </main>
  );
}