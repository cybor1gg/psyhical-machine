// Full-viewport loading state shared by the page shells (lobby, game, embed).
// Matches the game's dark canvas so route changes don't flash an unstyled
// paragraph before the real UI mounts.
export function LoadingScreen({ label = "Loading" }) {
  return (
    <div style={{
      minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 14, background: "var(--ink)", color: "var(--text-muted)",
      fontFamily: "var(--font-body)",
    }}>
      <div style={{
        width: 42, height: 58, borderRadius: 7,
        background: "linear-gradient(150deg, #2E8C68 0%, #1E6E50 48%, #154A37 100%)",
        border: "1.5px solid rgba(123,240,196,0.30)",
        boxShadow: "0 6px 16px rgba(0,0,0,0.42)",
        animation: "mb-glow-pulse 1.4s var(--ease-out) infinite",
      }} />
      <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, letterSpacing: "0.04em" }}>{label}…</span>
    </div>
  );
}
