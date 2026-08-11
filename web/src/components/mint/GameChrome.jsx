// Shared in-game chrome: the bottom bar every game renders.
//   left  — Lobby button · (i) info popover · sound toggle
//   center — the machine identity mark
//   right — fullscreen toggle
import React from "react";
import { useNavigate } from "react-router-dom";
import { sound } from "../../lib/sound";
import { getBrandMark } from "../../lib/brand";
import { GAME_INFO } from "./gameInfo";

const InfoIcon = (s = 16) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 16v-5M12 8h.01" /></svg>
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
              Default RTP; every payout on screen reflects the live value.
            </div>
          )}
        </div>
      )}
    </span>
  );
}

// ── the bottom chrome bar ────────────────────────────────────
// Lobby + info + sound on the left, the machine mark centred, fullscreen on
// the right. The Lobby button matters on a cabinet: the kiosk browser has no
// back button, so this is the only way out of a game.
export function GameBottombar({ game }) {
  const [mutedUi, setMutedUi] = React.useState(sound.isMuted());
  const fs = useFullscreen();
  const navigate = useNavigate();
  return (
    <div style={{ position: "relative", height: 50, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={() => navigate("/")} aria-label="Back to lobby"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 13px", background: "var(--surface-raised)", border: "none", borderRadius: 8, color: "var(--text)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-display)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Lobby
        </button>
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
        {fs.supported && (
          <button onClick={fs.toggle} aria-label={fs.on ? "Exit full screen" : "Full screen"} title={fs.on ? "Exit full screen" : "Full screen"}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, background: "var(--surface-raised)", border: "none", borderRadius: 8, color: "var(--text-muted)", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}>
            {fs.on ? CollapseIcon(15) : ExpandIcon(15)}
          </button>
        )}
      </span>
    </div>
  );
}
