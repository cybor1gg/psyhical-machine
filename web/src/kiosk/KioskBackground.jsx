// Ambient animated backdrop for the kiosk — deep navy with slowly drifting
// mint/gold/azure glow orbs, rising spark motes and a faint diagonal sheen.
// Fixed full-screen behind the UI, pointer-events: none, and animated with
// transform/opacity only so it stays cheap on cabinet hardware.
import React from "react";

// Deterministic pseudo-random per spark index (no Math.random: the layout
// must not change between renders or StrictMode double-mounts).
function sparkStyle(i, count) {
  const t = (i * 733) % 97;
  const left = ((i * 61.8) % 100);
  const size = 2 + (t % 3) * 1.3;
  const dur = 16 + ((i * 7.3) % 22);
  const delay = -((i * 5.1) % dur);
  const gold = i % 5 === 0;
  return {
    position: "absolute",
    bottom: "-4vh",
    left: `${left}%`,
    width: size,
    height: size,
    borderRadius: 999,
    background: gold ? "rgba(232,197,106,0.9)" : "rgba(84,214,166,0.85)",
    boxShadow: gold
      ? "0 0 8px 2px rgba(232,197,106,0.35)"
      : "0 0 8px 2px rgba(84,214,166,0.3)",
    "--spark-o": `${0.25 + (t % 40) / 100}`,
    animation: `kb-spark-rise ${dur}s linear ${delay}s infinite`,
    willChange: "transform, opacity",
  };
}

const orbBase = {
  position: "absolute",
  borderRadius: "50%",
  pointerEvents: "none",
  willChange: "transform",
};

export default function KioskBackground() {
  return (
    <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none", background: "radial-gradient(120% 90% at 50% 0%, #182b3d 0%, #101c29 48%, #0a131d 100%)" }}>
      {/* glow orbs — pre-blurred via radial-gradient falloff */}
      <div className="kb-orb" style={{ ...orbBase, width: "72vmax", height: "72vmax", left: "-22vmax", top: "-26vmax", background: "radial-gradient(circle, rgba(70,180,140,0.20) 0%, rgba(70,180,140,0.07) 42%, transparent 68%)", animation: "kb-drift-a 46s ease-in-out infinite" }} />
      <div className="kb-orb" style={{ ...orbBase, width: "64vmax", height: "64vmax", right: "-26vmax", top: "-14vmax", background: "radial-gradient(circle, rgba(90,166,232,0.16) 0%, rgba(90,166,232,0.05) 45%, transparent 70%)", animation: "kb-drift-b 58s ease-in-out infinite" }} />
      <div className="kb-orb" style={{ ...orbBase, width: "58vmax", height: "58vmax", left: "18vmax", bottom: "-32vmax", background: "radial-gradient(circle, rgba(232,197,106,0.13) 0%, rgba(232,197,106,0.045) 45%, transparent 70%)", animation: "kb-drift-c 52s ease-in-out infinite" }} />

      {/* rising sparks */}
      {Array.from({ length: 26 }, (_, i) => (
        <span key={i} className="kb-spark" style={sparkStyle(i, 26)} />
      ))}

      {/* slow diagonal sheen */}
      <div className="kb-sheen" style={{ position: "absolute", top: 0, bottom: 0, width: "34%", background: "linear-gradient(90deg, transparent, rgba(234,245,239,0.025), transparent)", animation: "kb-sheen 23s ease-in-out infinite", willChange: "transform" }} />

      {/* vignette for depth */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 100% at 50% 45%, transparent 55%, rgba(4,8,13,0.55) 100%)" }} />
    </div>
  );
}
