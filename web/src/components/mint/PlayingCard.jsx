// MintBets playing card — ES-module port of the design system's MintCards.PlayingCard.
// Card object here: { r: 2..14, s: "S"|"H"|"D"|"C", id }  (11=J 12=Q 13=K 14=A)

import { getBrandMark } from "../../lib/brand";

const SUIT_CHAR = { S: "\u2660", H: "\u2665", D: "\u2666", C: "\u2663" };
const RED = new Set(["H", "D"]);

// Backend card → design card. Backend: index 0..51, rank = index % 13 (0=Two..12=Ace),
// suit = floor(index / 13) with 0=♣ 1=♦ 2=♥ 3=♠.
const SUIT_BY_BACKEND = ["C", "D", "H", "S"];
export function cardFromApi(apiCard) {
  if (!apiCard) return null;
  return {
    r: (apiCard.index % 13) + 2,
    s: SUIT_BY_BACKEND[Math.floor(apiCard.index / 13)],
    // index kept so callers can tell "same card still on the table" apart from
    // "new deal of the same rank" — the random id remounts (re-animates) the
    // card, so it must only change when a deal actually happened.
    index: apiCard.index,
    id: "c-" + apiCard.index + "-" + Math.random().toString(36).slice(2, 7),
  };
}

export function rankLabel(r) {
  return r === 14 ? "A" : r === 13 ? "K" : r === 12 ? "Q" : r === 11 ? "J" : String(r);
}

export function PlayingCard({ card, faceDown = false, w = 76, dealt = true, dim = false, glow = null, style = {} }) {
  const h = Math.round(w * 1.4);
  const red = card && RED.has(card.s);
  const ink = red ? "var(--loss)" : "#16241D";
  const fs = w * 0.42;
  const corner = w * 0.2;

  const ring = glow === "win" ? "0 0 0 2px var(--mint-bright), 0 10px 26px rgba(84,214,166,0.35)"
    : glow === "loss" ? "0 0 0 5px var(--loss), 0 10px 26px rgba(225,91,76,0.4)"
    : "0 6px 16px rgba(0,0,0,0.42)";

  const wrap = {
    width: w, height: h, borderRadius: Math.max(7, w * 0.12), position: "relative", flex: "0 0 auto",
    boxShadow: ring, opacity: dim ? 0.45 : 1,
    transition: "opacity var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)",
    animation: dealt ? "mb-card-deal 360ms var(--ease-out) both" : "none",
    ...style,
  };

  if (faceDown || !card) {
    // The back carries the OPERATOR's mark inside their embeds (set at the
    // token exchange), MTech on direct play. Font scales with name length so
    // any brand fits the vertical strip.
    const mark = getBrandMark();
    const markFs = Math.max(5, Math.min(w * 0.12, (w * 1.1) / (1.15 * mark.length)));
    return (
      <div style={wrap}>
        <div style={{
          position: "absolute", inset: 0, borderRadius: "inherit",
          background: "linear-gradient(150deg, #2E8C68 0%, #1E6E50 48%, #154A37 100%)",
          border: "2px solid rgba(123,240,196,0.30)", boxSizing: "border-box",
          display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", inset: w * 0.12, borderRadius: w * 0.08, border: "1.5px solid rgba(166,230,206,0.30)" }} />
          <div style={{
            fontFamily: "'Unbounded', var(--font-display)", fontWeight: 800,
            fontSize: markFs, letterSpacing: "0.16em",
            textTransform: "uppercase", whiteSpace: "nowrap",
            writingMode: "vertical-rl", transform: "rotate(180deg)",
            color: "rgba(11,46,33,0.6)",
            textShadow: "0 1px 0 rgba(180,240,210,0.22)",
          }}>{mark}</div>
        </div>
      </div>
    );
  }

  const index = (align) => (
    <div style={{
      position: "absolute", ...align, display: "flex", flexDirection: "column", alignItems: "center",
      lineHeight: 0.95, color: ink, fontFamily: "var(--font-numeric)", fontWeight: 800,
      transform: align.bottom != null ? "rotate(180deg)" : "none",
    }}>
      <span style={{ fontSize: corner, letterSpacing: "-0.02em" }}>{rankLabel(card.r)}</span>
      <span style={{ fontSize: corner * 0.82 }}>{SUIT_CHAR[card.s]}</span>
    </div>
  );

  return (
    <div style={wrap}>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "inherit",
        background: "linear-gradient(160deg, #FAFCFA 0%, #EDF3EF 100%)",
        border: "1px solid rgba(0,0,0,0.10)", boxSizing: "border-box", overflow: "hidden",
      }}>
        {index({ top: w * 0.08, left: w * 0.1 })}
        {index({ bottom: w * 0.08, right: w * 0.1 })}
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          color: ink, fontSize: fs, fontFamily: "var(--font-numeric)", fontWeight: 800,
        }}>{SUIT_CHAR[card.s]}</div>
      </div>
    </div>
  );
}
