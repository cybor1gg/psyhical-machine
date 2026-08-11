// Game tile artwork — pre-rendered PNGs (600×800) generated from layered SVG
// scenes (drop shadows, gloss, glow, vignette) so tiles read as real game art.
// Source of truth: the generator script (scratchpad/gen-tiles.mjs history);
// regenerate and drop new files into /public/tiles to restyle.
import React from "react";

const TILES = ["hilo", "blackjack", "war", "tower", "dice", "limbo", "mines", "plinko", "keno", "roulette", "baccarat"];

// Chicken Cross — layered SVG scene in the same illustrated voice as the
// pre-rendered tiles (night road, headlight glow, hero hen, vignette). Drawn
// inline until a PNG is generated into /public/tiles like the others.
function ChickenArt() {
  return (
    <svg
      viewBox="0 0 600 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    >
      <defs>
        <linearGradient id="ckart-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2C3E54" />
          <stop offset="1" stopColor="#131D2A" />
        </linearGradient>
        <linearGradient id="ckart-road" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22303F" />
          <stop offset="1" stopColor="#18222E" />
        </linearGradient>
        <radialGradient id="ckart-glow" cx="0.5" cy="0.42" r="0.62">
          <stop offset="0" stopColor="rgba(123,240,196,0.16)" />
          <stop offset="1" stopColor="rgba(123,240,196,0)" />
        </radialGradient>
        <radialGradient id="ckart-vig" cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.55" stopColor="rgba(5,9,15,0)" />
          <stop offset="1" stopColor="rgba(5,9,15,0.65)" />
        </radialGradient>
        <radialGradient id="ckart-beam" cx="0.5" cy="0" r="1">
          <stop offset="0" stopColor="rgba(255,233,168,0.5)" />
          <stop offset="1" stopColor="rgba(255,233,168,0)" />
        </radialGradient>
      </defs>

      <rect width="600" height="800" fill="url(#ckart-sky)" />

      {/* sidewalks + road */}
      <rect x="0" y="0" width="86" height="800" fill="#3E4F63" />
      <rect x="514" y="0" width="86" height="800" fill="#3E4F63" />
      <rect x="80" y="0" width="10" height="800" fill="#586B80" />
      <rect x="510" y="0" width="10" height="800" fill="#586B80" />
      <rect x="90" y="0" width="420" height="800" fill="url(#ckart-road)" />

      {/* dashed lane lines */}
      <line x1="230" y1="0" x2="230" y2="800" stroke="rgba(255,255,255,0.16)" strokeWidth="6" strokeDasharray="34 40" />
      <line x1="370" y1="0" x2="370" y2="800" stroke="rgba(255,255,255,0.16)" strokeWidth="6" strokeDasharray="34 40" strokeDashoffset="30" />

      {/* oncoming car up top with a headlight cone */}
      <g transform="translate(252 -30)">
        <rect x="1" y="42" width="14" height="34" rx="7" fill="#131B25" />
        <rect x="81" y="42" width="14" height="34" rx="7" fill="#131B25" />
        <rect x="1" y="138" width="14" height="34" rx="7" fill="#131B25" />
        <rect x="81" y="138" width="14" height="34" rx="7" fill="#131B25" />
        <rect x="8" y="24" width="80" height="160" rx="26" fill="#E0455E" />
        <rect x="14" y="30" width="10" height="146" rx="5" fill="rgba(255,255,255,0.22)" />
        <rect x="20" y="86" width="56" height="46" rx="12" fill="rgba(255,255,255,0.14)" />
        <rect x="21" y="128" width="54" height="22" rx="9" fill="#1D2A38" opacity="0.9" />
        <rect x="22" y="62" width="52" height="18" rx="8" fill="#1D2A38" opacity="0.75" />
        <rect x="15" y="176" width="18" height="9" rx="4.5" fill="#FFE9A8" />
        <rect x="63" y="176" width="18" height="9" rx="4.5" fill="#FFE9A8" />
      </g>
      <path d="M270 155 L216 360 L378 360 L324 155 Z" fill="url(#ckart-beam)" />

      {/* mint glow behind the hero */}
      <rect width="600" height="800" fill="url(#ckart-glow)" />

      {/* ground shadow under the hen */}
      <ellipse cx="300" cy="700" rx="130" ry="26" fill="rgba(0,0,0,0.35)" />

      {/* hero hen (the game sprite, scaled up) */}
      <g transform="translate(140 380) scale(5.2)">
        <path d="M14 32 L3 24 L14 26 L8 15 L18 22 L17 11 L24 21 Z" fill="#E9E2CF" />
        <path d="M14 32 L8 15 L18 22 Z" fill="#DDD3BA" />
        <path d="M13 37 C13 24 22 16 33 15 C40 14.4 46 17 49 22 C55 25 57 33 54 40 C50 50 37 55 26 51 C17 47.5 13 44 13 37 Z" fill="#F7F2E4" />
        <path d="M18 46 C27 52 41 52 50 42 C47 50 34 55 26 51 C22.5 49.6 19.6 48 18 46 Z" fill="#E2D9C2" />
        <path d="M22 33 C22 27 30 24 36 27 C40 29 40 35 35 39 C29 43 22 40 22 33 Z" fill="#EDE6D3" />
        <path d="M25 35 L34 31" stroke="#D8CEB4" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M20 22 C26 16 34 14.6 40 16 L38 20 C33 18.6 26 20 22 25 Z" fill="#FFFFFF" opacity="0.55" />
        <path d="M38 13 C38 8 42 7 43 10 C44 5 48 5 48 9 C52 7 53 11 50 13 L40 16 Z" fill="#E0455E" />
        <path d="M51 22 L60 25 L51 29 Z" fill="#F5A623" />
        <path d="M48 29 C51 30 51 35 48 35 C46 35 45.6 30.8 48 29 Z" fill="#E0455E" />
        <circle cx="45" cy="21.5" r="2" fill="#1B2430" />
        <circle cx="45.8" cy="20.8" r="0.7" fill="#FFFFFF" />
        <path d="M27 52 L27 58 M27 58 L23 61 M27 58 L31 61 M37 51 L37 58 M37 58 L33 61 M37 58 L41 61" stroke="#F5A623" strokeWidth="2.4" strokeLinecap="round" />
      </g>

      <rect width="600" height="800" fill="url(#ckart-vig)" />
    </svg>
  );
}

export function GameArt({ game }) {
  if (game === "chicken") return <ChickenArt />;
  if (!TILES.includes(game)) return null;
  return (
    <img
      src={`/tiles/${game}.png`}
      alt=""
      draggable={false}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
    />
  );
}
