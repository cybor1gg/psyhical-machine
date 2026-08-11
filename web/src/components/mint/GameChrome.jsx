// Shared in-game chrome: the top bar every game renders.
//   left  — [Lobby (when playing on the site)] · (i) info popover · game name
//   right — Fair Play (opens the fairness modal) · sound toggle
// No balance here: the operator's casino shows the wallet in its own chrome.
//
// The (i) popover follows the design system's InfoPopover (how to play, RTP,
// max win, provably-fair note). Fair Play opens a full-screen modal with the
// seed pair (hashed server seed, client seed, nonce), a rotate action, and a
// small "Verify outcome" link to the Fair Play page.
import React from "react";
import { apiGet, apiPost } from "../../api";
import { sound } from "../../lib/sound";
import { getBrandMark, isDemoMode } from "../../lib/brand";
import { GAME_INFO } from "./gameInfo";

const InfoIcon = (s = 16) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 16v-5M12 8h.01" /></svg>
);
const ShieldIcon = (s = 15) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" /><path d="M9 12l2 2 4-4" /></svg>
);
const ExpandIcon = (s = 15) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
);
const CollapseIcon = (s = 15) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
);

// Fullscreen toggle for the game frame. Targets the whole document, so it
// fills the screen on the direct site (top-level) and, inside an operator
// iframe, fills the screen too WHEN the embed allows it (add `fullscreen` to
// the iframe's `allow` list — see the docs). iPhone Safari has no Fullscreen
// API, so `supported` is false there and the button doesn't render.
function useFullscreen() {
  const fsEl = () => (typeof document === "undefined" ? null : document.fullscreenElement || document.webkitFullscreenElement || null);
  const [on, setOn] = React.useState(() => !!fsEl());
  React.useEffect(() => {
    const sync = () => setOn(!!fsEl());
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);
  const toggle = () => {
    try {
      if (fsEl()) {
        const p = (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
        if (p && p.catch) p.catch(() => {});
      } else {
        const el = document.documentElement;
        const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
        if (p && p.catch) p.catch(() => {});
      }
    } catch { /* unsupported — button is gated on `supported` anyway */ }
  };
  const supported = typeof document !== "undefined" && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  return { on, toggle, supported };
}

// ── (i) info popover — design-system InfoPopover ─────────────
function InfoButton({ game, up = false }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const info = GAME_INFO[game];

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!info) return null;
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button onClick={() => setOpen((o) => !o)} aria-label={`How to play ${info.title}`}
        style={{ padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "transparent", border: "none", color: open ? "var(--mint-bright)" : "var(--text-muted)", transition: "color var(--dur-fast) var(--ease-out)" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--mint-bright)"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.color = "var(--text-muted)"; }}>
        {InfoIcon(16)}
      </button>
      {open && (
        <div style={{ position: "absolute", ...(up ? { bottom: "calc(100% + 10px)" } : { top: "calc(100% + 10px)" }), left: -8, zIndex: 60, width: "min(280px, calc(100vw - 28px))", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)", padding: 14, animation: "mb-rise var(--dur-base) var(--ease-out)" }}>
          <div style={{ position: "absolute", ...(up ? { bottom: -6 } : { top: -6 }), left: 9, width: 12, height: 12, background: "var(--surface-raised)", borderLeft: up ? "none" : "1px solid var(--border)", borderTop: up ? "none" : "1px solid var(--border)", borderRight: up ? "1px solid var(--border)" : "none", borderBottom: up ? "1px solid var(--border)" : "none", transform: "rotate(45deg)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <span style={{ color: "var(--mint-bright)", display: "inline-flex" }}>{InfoIcon(14)}</span>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13.5 }}>How to play {info.title}</span>
          </div>
          <p style={{ margin: "0 0 8px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{info.how}</p>
          {info.settings && (
            <p style={{ margin: "0 0 11px", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>
              <b style={{ color: "var(--text)" }}>Settings:</b> {info.settings}
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            <div style={{ padding: "7px 10px", background: "var(--ink)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 2 }}>RTP</div>
              <div style={{ fontFamily: "var(--font-numeric)", fontWeight: 800, fontSize: 14.5, color: "var(--mint-bright)" }}>{info.rtp}</div>
            </div>
            <div style={{ padding: "7px 10px", background: "var(--ink)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 2 }}>Max Win</div>
              <div style={{ fontFamily: "var(--font-numeric)", fontWeight: 800, fontSize: 14.5, color: "var(--gold)" }}>{info.maxWin}</div>
            </div>
          </div>
          {info.rtpConfigurable && (
            <div style={{ marginTop: 7, fontSize: 10.5, color: "var(--text-muted)", lineHeight: 1.4 }}>
              Default RTP. Your casino sets the live value; every payout on screen reflects it.
            </div>
          )}
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, color: "var(--mint)" }}>
            {ShieldIcon(13)}
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-muted)" }}>Provably fair, every round is verifiable</span>
          </div>
        </div>
      )}
    </span>
  );
}

// ── fairness modal — seed pair + rotate + verify link ────────
function SeedField({ label, value, mono = true, flex }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: flex || "none", minWidth: 0 }}>
      <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}>{label}</span>
      <div style={{ padding: "7px 10px", background: "var(--ink)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontFamily: mono ? "ui-monospace, Menlo, monospace" : "var(--font-numeric)", fontSize: 11.5, color: "var(--text)", wordBreak: "break-all", lineHeight: 1.4 }}>
        {value ?? "…"}
      </div>
    </div>
  );
}

function FairnessModal({ onClose }) {
  const [seed, setSeed] = React.useState(null);       // { serverSeedHash, clientSeed, nonce }
  const [revealed, setRevealed] = React.useState(null); // previous pair after rotate
  const [newClient, setNewClient] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    apiGet("/api/fair/seed").then(({ ok, data }) => { if (ok) setSeed(data); else setError(data.error || "Could not load your seed"); });
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function rotate() {
    if (busy) return;
    setBusy(true);
    setError("");
    const { ok, data } = await apiPost("/api/fair/rotate", newClient.trim() ? { clientSeed: newClient.trim() } : {});
    setBusy(false);
    if (!ok) { setError(data.error || "Rotate failed"); return; }
    setRevealed(data.revealed);
    setSeed(data.next);
    setNewClient("");
  }

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(8,12,18,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, animation: "mb-fade-in var(--dur-base) var(--ease-out)" }}>
      <div style={{ width: "min(480px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", boxShadow: "var(--shadow-lg)", animation: "mb-pop var(--dur-base) var(--ease-bounce)", overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px 11px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ color: "var(--mint-bright)", display: "inline-flex" }}>{ShieldIcon(17)}</span>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18, letterSpacing: "-0.01em" }}>Provably Fair</h2>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 999, background: "var(--surface-raised)", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div style={{ height: 1, background: "var(--border)", margin: "0 18px" }} />

        {/* body — sized to fit a laptop viewport without scrolling */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--fs-caption)", lineHeight: 1.5 }}>
            Every outcome comes from HMAC-SHA256(server seed, client seed:nonce). The server seed
            is committed below as a hash. Rotate the pair any time to reveal it and verify your past rounds.
          </p>
          {error && <div style={{ padding: "8px 11px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-caption)", fontWeight: 600 }}>{error}</div>}
          <SeedField label="Hashed server seed" value={seed?.serverSeedHash} />
          <div style={{ display: "flex", gap: 8 }}>
            <SeedField label="Client seed" value={seed?.clientSeed} flex="1 1 60%" />
            <SeedField label="Nonce" value={seed == null ? null : String(seed.nonce)} flex="1 1 40%" />
          </div>

          {/* rotate */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "10px 11px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" }}>
            <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", lineHeight: 1.45 }}>
              <b style={{ color: "var(--text)" }}>Rotate seed pair</b>: reveals the current server seed and starts a fresh committed pair.
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder="New client seed (optional)" maxLength={64}
                style={{ flex: 1, minWidth: 0, height: 34, padding: "0 10px", background: "var(--ink)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", outline: "none", color: "var(--text)", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5 }} />
              <button onClick={rotate} disabled={busy}
                style={{ flex: "0 0 auto", height: 34, padding: "0 14px", borderRadius: "var(--r-md)", border: "none", background: "linear-gradient(180deg, var(--mint-bright) 0%, var(--mint) 55%, var(--mint-deep) 100%)", color: "var(--text-on-accent)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12.5, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Rotating…" : "Rotate"}
              </button>
            </div>
          </div>

          {revealed && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 11px", background: "rgba(70,180,140,0.07)", border: "1px solid rgba(70,180,140,0.35)", borderRadius: "var(--r-lg)", animation: "mb-rise var(--dur-base) var(--ease-out)" }}>
              <span style={{ fontSize: "var(--fs-caption)", fontWeight: 700, color: "var(--mint-bright)" }}>Previous pair revealed</span>
              <SeedField label="Server seed (unhashed)" value={revealed.serverSeed} />
              <div style={{ display: "flex", gap: 8 }}>
                <SeedField label="Its hash (matches what you saw)" value={revealed.serverSeedHash} flex="1 1 60%" />
                <SeedField label="Client seed · last nonce" value={`${revealed.clientSeed} · ${revealed.lastNonce}`} flex="1 1 40%" />
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── the top bar ──────────────────────────────────────────────
// Bottom chrome bar (the reference's game-frame footer): info + sound on the
// left, the operator brand centred, Fairness on the right.
export function GameBottombar({ game }) {
  const [mutedUi, setMutedUi] = React.useState(sound.isMuted());
  const [fairOpen, setFairOpen] = React.useState(false);
  const fs = useFullscreen();
  return (
    <div style={{ position: "relative", height: 50, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <InfoButton game={game} up />
        <button onClick={() => { sound.prime(); setMutedUi(sound.toggleMuted()); }}
          aria-label={mutedUi ? "Unmute" : "Mute"} title={mutedUi ? "Unmute" : "Mute"}
          style={{ padding: 0, display: "inline-flex", alignItems: "center", background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
          {mutedUi ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M23 9l-6 6M17 9l6 6" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M19 5a9 9 0 010 14" /></svg>
          )}
        </button>
      </span>
      <span aria-hidden="true" style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", fontFamily: "'Unbounded', var(--font-display)", fontWeight: 800, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", pointerEvents: "none" }}>
        {getBrandMark()}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* try-mode marker — in the chrome bar, so it can never sit on top of
            a game's controls the way the old floating overlay could */}
        {isDemoMode() && (
          <span aria-label="Demo mode — play money" title="Demo mode — play money" style={{
            display: "inline-flex", alignItems: "center", height: 34, padding: "0 12px", borderRadius: 8,
            background: "rgba(240,185,60,0.14)", border: "1px solid rgba(240,185,60,0.45)",
            color: "#F0B93C", fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 800,
            letterSpacing: "0.12em", pointerEvents: "none", userSelect: "none",
          }}>DEMO</span>
        )}
        {fs.supported && (
          <button onClick={fs.toggle} aria-label={fs.on ? "Exit full screen" : "Full screen"} title={fs.on ? "Exit full screen" : "Full screen"}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, background: "var(--surface-raised)", border: "none", borderRadius: 8, color: "var(--text-muted)", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}>
            {fs.on ? CollapseIcon(15) : ExpandIcon(15)}
          </button>
        )}
        <button onClick={() => setFairOpen(true)}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 14px", background: "var(--surface-raised)", border: "none", borderRadius: 8, color: "var(--text)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-display)" }}>
          {ShieldIcon(14)}
          Fairness
        </button>
      </span>
      {fairOpen && <FairnessModal onClose={() => setFairOpen(false)} />}
    </div>
  );
}

export function GameTopbar({ game, onHome }) {
  const [mutedUi, setMutedUi] = React.useState(sound.isMuted());
  const [fairOpen, setFairOpen] = React.useState(false);
  const info = GAME_INFO[game];

  return (
    <div style={{ height: 54, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
        {onHome && (
          <button onClick={onHome} aria-label="Back to lobby" title="Back to lobby"
            style={{ display: "flex", alignItems: "center", gap: 7, height: 40, padding: "0 12px", background: "transparent", border: "1px solid var(--border)", borderRadius: "var(--r-md)", color: "var(--text-muted)", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--fs-sm)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Lobby
          </button>
        )}
        <InfoButton game={game} />
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13.5, letterSpacing: "0.02em", textTransform: "lowercase", color: "var(--text)" }}>
          {info?.title ?? game}
        </span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => setFairOpen(true)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: 0, color: "var(--text-muted)", fontSize: "var(--fs-sm)", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-body)" }}>
          {ShieldIcon(15)}
          Fair Play
        </button>
        <button onClick={() => { sound.prime(); setMutedUi(sound.toggleMuted()); }}
          aria-label={mutedUi ? "Unmute" : "Mute"} title={mutedUi ? "Unmute" : "Mute"}
          style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid var(--border)", borderRadius: "var(--r-md)", color: "var(--text-muted)", cursor: "pointer", flex: "0 0 auto" }}>
          {mutedUi ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M23 9l-6 6M17 9l6 6" /></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M19 5a9 9 0 010 14" /></svg>
          )}
        </button>
      </span>
      {fairOpen && <FairnessModal onClose={() => setFairOpen(false)} />}
    </div>
  );
}
