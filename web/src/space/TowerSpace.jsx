// TOWER — "ASCENT SILO", the space-theme cabinet screen for Dragon Tower.
// A vertical launch tower centre-screen: 9 rows of pods climbing bottom→top,
// the current row lit gold and tappable, climbed rows showing their outcome
// (green energy cell = safe, red flare = danger), a ×multiplier rail on the
// left lighting up as you pass each stage. Pick choreography (pending pulse,
// green bloom + ring + rising ping, red slam + tower quake, staggered
// end-of-round reveal) follows the Mines screen's idioms; the round itself is
// SERVER-authoritative: row layouts, multipliers, the ladder and payouts only
// ever come from api/routes/tower.js (start / guess / cashout / active).
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { useBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import SpaceBackground from "./SpaceBackground";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar, SectionLabel,
  GoldButton, SoundButton, BetStepper, pillStyle, T,
} from "./Shell";
import { beep, whoosh, sfx, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import "./space.css";
import "./tower.css";

const MAX_BET = 500; // platform max bet (МКД, integer steps of 50)
const ROWS_DEFAULT = 9;

// Mirror of the server's DIFFICULTIES (api/lib/games/tower.js) — used only to
// preview the pod count and pill labels before a round; every in-round value
// (tilesPerRow, ladder, multiplier) comes from the API.
const DIFFS = {
  easy:   { tiles: 4, safe: 3 },
  medium: { tiles: 3, safe: 2 },
  hard:   { tiles: 2, safe: 1 },
  expert: { tiles: 3, safe: 1 },
  master: { tiles: 4, safe: 1 },
};
const DIFF_ORDER = ["easy", "medium", "hard", "expert", "master"];

// Tower-specific sfx on the shared engine — the safe-pod ping's pitch climbs
// with the row (445 Hz × 1.08^(row−1)), the mines-gem idea keyed to altitude.
const twSfx = {
  safe(row) {
    const base = 445 * Math.pow(1.08, (row || 1) - 1);
    whoosh(700, 2600, 0.08, 0.18);
    beep("triangle", base, base * 1.5, 0.15, 0.13, 0.02);
    beep("sine", base * 2, base * 3, 0.07, 0.12, 0.05);
  },
  bet: sfx.bet,
  cash: sfx.cash,
  boom: sfx.boom,
  click: sfx.click,
};

// Green energy cell (the "safe pod" — the mines gem's cousin).
const CELL_SVG = (
  <svg viewBox="0 0 24 24" style={{ height: "62%", filter: "drop-shadow(0 2px 4px rgba(0,0,0,.4))" }}>
    <rect x="7" y="3.5" width="10" height="17" rx="5" fill="#0d5a3f" />
    <rect x="7" y="3.5" width="10" height="17" rx="5" fill="none" stroke="#7ef0c0" strokeWidth="1.6" />
    <ellipse cx="12" cy="9.6" rx="3.1" ry="4.1" fill="#a8ffe0" opacity=".85" />
    <path d="M12 6.5v11" stroke="#eafff7" strokeWidth="1.2" strokeLinecap="round" opacity=".8" />
  </svg>
);
// Red flare (the danger pod).
const FLARE_SVG = (
  <svg viewBox="0 0 24 24" style={{ height: "62%", filter: "drop-shadow(0 2px 5px rgba(0,0,0,.5))" }}>
    <path d="M12 2.6c1.1 4.4 3.2 6.2 7 7.4-3.8 1.2-5.9 3-7 7.4-1.1-4.4-3.2-6.2-7-7.4 3.8-1.2 5.9-3 7-7.4z" fill="#ff6a5a" />
    <circle cx="12" cy="10" r="2.5" fill="#ffd0c4" opacity=".9" />
    <path d="M9 18.5l-1.8 2.9M15 18.5l1.8 2.9" stroke="#ffcf8a" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const fmtMult = (v) => "×" + (v >= 100 ? v.toFixed(0) : v.toFixed(2));

function RulesModal({ onClose }) {
  const row = (mark, color, text) => (
    <div style={{ display: "flex", gap: 13 }}>
      <span style={{ color, fontWeight: 700 }}>{mark}</span><span>{text}</span>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,6,10,.72)", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, padding: "38px 42px", borderRadius: 24, border: `2px solid ${T.ctlBorder}`, background: "linear-gradient(180deg,#111826,#0a0d14)", boxShadow: "0 34px 90px rgba(0,0,0,.65)" }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>HOW TO PLAY</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 15, margin: "26px 0 30px", fontSize: 17, lineHeight: 1.5, color: "#b7c0d1" }}>
          {row("▲", T.win, "Pick a pod on each row to climb the tower. Every safe row raises your multiplier.")}
          {row("✳", T.lose, "Hit a flare and the ascent is over — you lose the bet.")}
          {row("↑", T.gold, "Cash out any time after the first row to bank your winnings.")}
          {row("✦", T.gold, "Harder towers climb faster. Every safe row pays fair odds × (1 − house edge), so the long-run RTP is the same at every difficulty.")}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}

export default function TowerSpace() {
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  // phase: idle → playing → over (win|lose) → idle again on next BET
  const [phase, setPhase] = useState("idle");
  const [difficulty, setDifficulty] = useState("medium");
  const [bet, setBet] = useState(100);
  const [tilesPerRow, setTilesPerRow] = useState(DIFFS.medium.tiles);
  const [rowsCount, setRowsCount] = useState(ROWS_DEFAULT);
  const [ladderVals, setLadderVals] = useState(null);   // server ladder (per row)
  const [rowsData, setRowsData] = useState([]);         // climbed rows: {dragons, pick}
  const [towerFull, setTowerFull] = useState(null);     // full reveal at settle
  const [settleOrigin, setSettleOrigin] = useState(0);  // stagger origin row
  const [currentRow, setCurrentRow] = useState(0);
  const [mult, setMult] = useState(1);                  // server multiplier
  const [potential, setPotential] = useState(0);        // server potentialPayout
  const [lastWin, setLastWin] = useState(0);            // server payout
  const [outcome, setOutcome] = useState(null);         // 'win' | 'lose'
  const [pendingTile, setPendingTile] = useState(null); // pod awaiting the server
  const [fx, setFx] = useState(null);                   // {id,row,tile,text} bloom ring + rise pop
  const [quake, setQuake] = useState(false);
  const [flash, setFlash] = useState({ on: false, kind: "win" });
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");

  const readRef = useRef(null);
  const timers = useRef([]);
  const fid = useRef(0);
  const busyRef = useRef(false);          // one request in flight at a time
  const ladderCache = useRef({});         // difficulty → last server ladder
  const currentRowRef = useRef(currentRow);
  currentRowRef.current = currentRow;

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // ── mount: ambience + resume a live server round ──────────────────────────
  useEffect(() => {
    armAmbientOnGesture();
    startAmbient();
    let dead = false;
    apiGet("/api/games/tower/active").then(({ ok, data }) => {
      if (dead || !ok || !data.active) return;
      setDifficulty(data.difficulty);
      setTilesPerRow(data.tilesPerRow);
      setRowsCount(data.rows ?? ROWS_DEFAULT);
      setLadderVals(data.ladder);
      ladderCache.current[data.difficulty] = data.ladder;
      setBet(Math.max(50, Math.round(Number(data.betAmount) || 50)));
      setRowsData(data.revealed.map((r) => ({ dragons: r.dragons, pick: r.pick })));
      setCurrentRow(data.currentRow);
      setMult(data.multiplier);
      setPotential(data.potentialPayout ?? 0);
      setTowerFull(null);
      setOutcome(null);
      setPhase("playing");
    });
    return () => { dead = true; };
  }, []);

  // ── choreography helpers (mines idioms) ───────────────────────────────────
  const popRead = () => {
    const el = readRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = "scale(1.22)";
    requestAnimationFrame(() => { el.style.transition = "transform .34s cubic-bezier(.2,1.5,.4,1)"; el.style.transform = "scale(1)"; });
  };

  const flashTimer = useRef(0);
  const doFlash = (kind) => {
    setFlash({ on: true, kind });
    clearTimeout(flashTimer.current);
    flashTimer.current = later(() => setFlash((f) => ({ ...f, on: false })), 420);
  };

  const podFx = (row, tile, text) => {
    const id = ++fid.current;
    setFx({ id, row, tile, text });
    later(() => setFx((f) => (f && f.id === id ? null : f)), 1000);
  };

  // ── server round flow ─────────────────────────────────────────────────────
  async function post(path, body) {
    busyRef.current = true;
    setError("");
    const { ok, data } = await apiPost(path, body);
    busyRef.current = false;
    if (!ok) { setError(data?.error || "Something went wrong"); return null; }
    return data;
  }

  async function startBet() {
    if (phase === "playing" || busyRef.current) return;
    if (balance < 50) return;
    const stake = Math.min(bet, MAX_BET, Math.floor(balance));
    const data = await post("/api/games/tower/start", { betAmount: stake, difficulty });
    if (!data) return;
    setBet(stake);
    setTilesPerRow(data.tilesPerRow);
    setRowsCount(data.rows ?? ROWS_DEFAULT);
    setLadderVals(data.ladder);
    ladderCache.current[difficulty] = data.ladder;
    setRowsData([]);
    setTowerFull(null);
    setSettleOrigin(0);
    setCurrentRow(0);
    setMult(data.multiplier ?? 1);
    setPotential(0);
    setLastWin(0);
    setOutcome(null);
    setFx(null);
    setQuake(false);
    setPhase("playing");
    twSfx.bet();
  }

  async function pick(tile) {
    if (phase !== "playing" || busyRef.current || pendingTile != null) return;
    const rowIdx = currentRowRef.current;
    setPendingTile(tile);
    const data = await post("/api/games/tower/guess", { tile });
    setPendingTile(null);
    if (!data) return;
    if (!data.won) {
      // bust — red slam on the pod, tower quake, then the full-tower sweep
      setRowsData((r) => r.concat({ dragons: data.row.dragons, pick: tile }));
      setPhase("over");
      setOutcome("lose");
      setLastWin(0);
      setSettleOrigin(rowIdx);
      setQuake(true);
      later(() => setQuake(false), 650);
      twSfx.boom();
      doFlash("lose");
      later(() => setTowerFull(data.tower), 550);
      return;
    }
    // safe pod — green bloom + ring + rising ping (pitch climbs per row)
    setRowsData((r) => r.concat({ dragons: data.row.dragons, pick: tile }));
    setMult(data.multiplier);
    if (data.potentialPayout != null) setPotential(data.potentialPayout);
    twSfx.safe(data.currentRow ?? rowIdx + 1);
    popRead();
    podFx(rowIdx, tile, fmtMult(data.multiplier));
    if (data.top) {
      // reached the apex — the server auto-settled as cashed_out
      later(() => {
        setPhase("over");
        setOutcome("win");
        setLastWin(data.payout);
        setMult(data.multiplier);
        setSettleOrigin(rowIdx);
        setTowerFull(data.tower);
        twSfx.cash();
        doFlash("win");
      }, 350);
      return;
    }
    setCurrentRow(data.currentRow);
  }

  async function cashOut() {
    if (phase !== "playing" || busyRef.current || currentRowRef.current < 1) return;
    const data = await post("/api/games/tower/cashout");
    if (!data) return;
    setPhase("over");
    setOutcome("win");
    setLastWin(data.payout);
    setMult(data.multiplier);
    setSettleOrigin(Math.max(0, currentRowRef.current - 1));
    setTowerFull(data.tower);
    twSfx.cash();
    doFlash("win");
  }

  function setDiff(d) {
    if (phase === "playing") return;
    setDifficulty(d);
    setTilesPerRow(DIFFS[d].tiles);
    setLadderVals(ladderCache.current[d] ?? null);
    setPhase("idle");
    setRowsData([]);
    setTowerFull(null);
    setCurrentRow(0);
    setMult(1);
    setOutcome(null);
    setFx(null);
    twSfx.click();
  }

  // ── derived render values ─────────────────────────────────────────────────
  const lock = phase === "playing";
  const over = phase === "over";
  const bustRow = outcome === "lose" ? rowsData.length - 1 : -1;
  const safeClimbs = rowsData.length - (bustRow >= 0 ? 1 : 0);
  const tiles = lock || over ? tilesPerRow : DIFFS[difficulty].tiles;

  // Per-row state, index 0 = bottom row (server row order).
  const rowsState = Array.from({ length: rowsCount }, (_, r) => {
    if (r < rowsData.length) {
      const d = rowsData[r];
      return { kind: "climbed", dragons: d.dragons, pick: d.pick, bust: d.dragons.includes(d.pick) };
    }
    if (towerFull && towerFull[r]) return { kind: "revealed", dragons: towerFull[r].dragons, pick: null, bust: false };
    if (lock && r === currentRow) return { kind: "active", dragons: null, pick: null, bust: false };
    return { kind: "locked", dragons: null, pick: null, bust: false };
  });

  // readout line — server errors take it over, in red
  let readText = "", readColor = T.muted, readGlow = "rgba(0,0,0,0)", readOpacity = 1, readSize = 26;
  if (error) { readText = error.toUpperCase(); readColor = "#ff6a5a"; readGlow = "rgba(255,90,74,.55)"; }
  else if (phase === "idle") { readText = "PRESS BET TO START"; readOpacity = 0.8; }
  else if (lock) { readText = "×" + mult.toFixed(2) + "  ·  ROW " + currentRow + "/" + rowsCount; readColor = T.gold; readGlow = "rgba(240,217,154,.5)"; readSize = 30; }
  else if (over) {
    readSize = 34;
    if (outcome === "win") { readText = "WIN +" + fmtMKD(lastWin); readColor = T.win; readGlow = "rgba(46,230,166,.5)"; }
    else { readText = "FLARE OUT"; readColor = "#ff6a5a"; readGlow = "rgba(255,90,74,.55)"; }
  }

  // header status chip: current ×mult / last win
  const chip = lock
    ? { label: "× " + mult.toFixed(2), color: T.gold }
    : over
      ? (outcome === "win" ? { label: "+" + fmtMKD(lastWin), color: T.win } : { label: "BUST", color: "#ff6a5a" })
      : { label: "READY", color: T.text2 };

  // primary button
  const canBet = balance >= 50;
  const primaryStyle = { flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 };
  let primary;
  if (lock) {
    primary = currentRow >= 1
      ? <GoldButton label="CASH OUT" sub={fmtMKD(potential)} onClick={cashOut} labelSize="clamp(21px, 2.2vw, 32px)" style={primaryStyle} />
      : <GoldButton label="PICK A POD" disabled labelSize="clamp(21px, 2.2vw, 32px)" style={primaryStyle} />;
  } else {
    primary = <GoldButton label="BET" sub={fmtMKD(Math.min(bet, Math.max(50, Math.floor(balance) || 50)))} onClick={startBet} disabled={!canBet} labelSize="clamp(21px, 2.2vw, 32px)" style={primaryStyle} />;
  }

  const podH = "clamp(44px, 7vh, 60px)";
  const rowGap = "clamp(4px, 0.8vh, 8px)";
  const topMult = ladderVals ? ladderVals[rowsCount - 1] : null;
  const apexReached = over && outcome === "win" && safeClimbs >= rowsCount;

  return (
    <SpaceRoot>
      <SpaceBackground variant="game" fastDur={7} />

      {/* win/lose flash */}
      <div style={{ position: "absolute", inset: 0, zIndex: 8, pointerEvents: "none", background: flash.kind === "lose" ? "radial-gradient(circle at 50% 50%, rgba(255,60,50,.5), rgba(255,60,50,0) 70%)" : "radial-gradient(circle at 50% 50%, rgba(46,230,166,.42), rgba(46,230,166,0) 70%)", opacity: flash.on ? 1 : 0, transition: "opacity .3s ease" }} />

      <SpaceHeader title="TOWER" chip={chip} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", gap: 0 }}>

        {/* ── left control panel ── */}
        <SpaceSidebar>
          <SoundButton />
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 2vh, 16px)", opacity: lock ? 0.4 : 1, pointerEvents: lock ? "none" : "auto", transition: "opacity .2s ease" }}>
            <BetStepper bet={bet} setBet={setBet} disabled={lock} maxBet={MAX_BET} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SectionLabel>DIFFICULTY</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: "clamp(6px, 1vh, 9px)" }}>
                {DIFF_ORDER.map((d) => (
                  <button key={d} onClick={() => setDiff(d)}
                    style={pillStyle(difficulty === d, { display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: "clamp(36px, 5.8vh, 52px)", padding: "0 clamp(10px, 1vw, 16px)", fontSize: "clamp(13px, 2.2vh, 17px)", letterSpacing: 2 })}>
                    <span>{d.toUpperCase()}</span>
                    <span style={{ fontSize: "clamp(11px, 1.8vh, 14px)", letterSpacing: 1, color: difficulty === d ? T.accent : T.muted }}>{DIFFS[d].safe}/{DIFFS[d].tiles} SAFE</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SpaceSidebar>

        {/* ── tower column ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* readout */}
          <div style={{ position: "relative", zIndex: 4, height: 46, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div ref={readRef} style={{ opacity: readOpacity, transform: "scale(1)", fontSize: readSize, fontWeight: 700, letterSpacing: 3, color: readColor, textShadow: `0 0 28px ${readGlow}`, transition: "opacity .25s ease" }}>{readText}</div>
          </div>

          {/* the ascent silo */}
          <div style={{ position: "relative", zIndex: 4, flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 24px", animation: quake ? "twQuake .55s ease" : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", maxHeight: "100%" }}>

              {/* apex marker */}
              <div style={{ alignSelf: "center", marginBottom: "clamp(3px, 0.8vh, 8px)", padding: "3px 16px", borderRadius: 20, border: `1px solid ${apexReached ? T.accent : T.panelBorder}`, background: apexReached ? "rgba(217,178,106,.16)" : "rgba(8,11,18,.55)", fontSize: "clamp(11px, 1.8vh, 14px)", fontWeight: 700, letterSpacing: 3, color: apexReached ? T.gold : T.muted, textShadow: apexReached ? "0 0 16px rgba(240,217,154,.5)" : "none", transition: "all .3s ease" }}>
                ▲ APEX {topMult != null ? fmtMult(topMult) : "···"}
              </div>

              {/* silo: rows top→bottom render row 8 → row 0 */}
              <div style={{ display: "flex", flexDirection: "column", gap: rowGap, padding: "clamp(6px, 1.2vh, 12px) clamp(8px, 0.9vw, 14px)", borderRadius: 18, border: `2px solid ${T.panelBorder}`, background: "rgba(8,11,18,.55)", backdropFilter: "blur(6px)" }}>
                {rowsState.map((_, k) => {
                  const r = rowsCount - 1 - k;         // bottom row last in DOM
                  const st = rowsState[r];
                  const earned = r < safeClimbs;
                  const isActive = st.kind === "active";
                  const dly = st.kind === "revealed" ? Math.abs(r - settleOrigin) * 90 : 0;
                  const tagColor = earned ? T.gold : isActive ? T.gold : T.muted;
                  return (
                    <div key={r} style={{ display: "flex", alignItems: "stretch", height: podH, opacity: st.kind === "locked" ? (phase === "idle" ? 0.5 : 0.35) : 1, transition: "opacity .3s ease", animation: st.bust ? "twShakeRow .55s ease" : "none" }}>
                      {/* multiplier rail tag */}
                      <div style={{ flex: "none", width: "clamp(58px, 6vw, 96px)", display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: "clamp(8px, 0.9vw, 14px)", marginRight: "clamp(6px, 0.7vw, 10px)", borderRight: `1px solid ${T.panelBorder}`, fontSize: "clamp(12px, 2vh, 16px)", fontWeight: 700, letterSpacing: 1, color: tagColor, textShadow: earned ? "0 0 14px rgba(240,217,154,.55)" : "none", opacity: isActive && !earned ? undefined : 1, animation: isActive ? "twTagPulse 1.6s ease-in-out infinite" : "none", transition: "color .3s ease, text-shadow .3s ease" }}>
                        {ladderVals ? fmtMult(ladderVals[r]) : "···"}
                      </div>
                      {/* pod strip */}
                      <div style={{ display: "flex", gap: "clamp(5px, 0.6vw, 9px)", width: "clamp(250px, 30vw, 470px)", padding: 3, borderRadius: 14, border: `2px solid ${isActive ? "rgba(240,217,154,.5)" : "transparent"}`, background: isActive ? "rgba(240,217,154,.05)" : "transparent", animation: isActive ? "twAim 1.6s ease-in-out infinite" : "none" }}>
                        {Array.from({ length: tiles }, (_, tIdx) => {
                          const isDragon = st.dragons ? st.dragons.includes(tIdx) : false;
                          const isPick = st.pick === tIdx;
                          const canClick = isActive && pendingTile == null;
                          let bg = "linear-gradient(180deg,#1c2434,#111823)", border = "#26314a", glow = "inset 0 2px 0 rgba(255,255,255,.05), 0 4px 12px rgba(0,0,0,.4)", anim = "none", face = null, faceOp = 1, podOp = 1;
                          if (isActive) {
                            bg = "linear-gradient(180deg,#26324a,#161f30)"; border = "rgba(240,217,154,.55)";
                            glow = "inset 0 2px 0 rgba(255,255,255,.07), 0 0 14px rgba(240,217,154,.18)";
                            if (pendingTile === tIdx) anim = "twPending .8s ease-in-out infinite";
                          } else if (st.kind === "climbed") {
                            if (isPick && !st.bust) { bg = "radial-gradient(circle at 50% 32%, #1f7d5b, #0d5a3f 70%)"; border = "#3fe0a0"; glow = "0 0 18px rgba(46,230,166,.45), inset 0 2px 0 rgba(255,255,255,.2)"; anim = "twBloom .55s cubic-bezier(.2,1.5,.4,1) both"; face = CELL_SVG; }
                            else if (isPick && st.bust) { bg = "radial-gradient(circle at 50% 35%, #5a2118, #2a1012 80%)"; border = "#ff6a5a"; glow = "0 0 30px rgba(255,90,74,.65)"; anim = "twSlam .45s cubic-bezier(.3,1.4,.4,1) both"; face = FLARE_SVG; }
                            else if (isDragon) { bg = "radial-gradient(circle at 50% 35%, #2a161a, #180d10 75%)"; border = "#7a352f"; anim = "twRevealSoft .45s ease both"; face = FLARE_SVG; faceOp = 0.8; }
                            else podOp = 0.55;
                          } else if (st.kind === "revealed") {
                            if (isDragon) { bg = "radial-gradient(circle at 50% 35%, #2a161a, #180d10 75%)"; border = "#7a352f"; anim = `twRevealSoft .5s ease ${dly}ms both`; face = FLARE_SVG; faceOp = 0.8; }
                            else { bg = "#10261f"; border = "#1c473a"; anim = `twRevealSoft .5s ease ${dly}ms both`; face = CELL_SVG; faceOp = 0.45; }
                          }
                          const showFx = fx && fx.row === r && fx.tile === tIdx;
                          return (
                            <button key={tIdx} onClick={canClick ? () => pick(tIdx) : undefined} className={canClick ? "tw-pod" : undefined}
                              style={{ position: "relative", flex: 1, minWidth: 0, borderRadius: 12, border: `2px solid ${border}`, background: bg, boxShadow: glow, opacity: podOp, cursor: canClick ? "pointer" : "default", outline: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", animation: anim, transition: "opacity .3s ease" }}>
                              {face && <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", opacity: faceOp }}>{face}</span>}
                              {showFx && (
                                <>
                                  <span style={{ position: "absolute", left: "50%", top: "50%", width: 90, height: 90, borderRadius: "50%", border: "3px solid #7ef0c0", pointerEvents: "none", animation: "twRing .6s ease-out both" }} />
                                  <span style={{ position: "absolute", left: "50%", top: 0, whiteSpace: "nowrap", zIndex: 9, fontSize: 22, fontWeight: 700, letterSpacing: 2, color: "#7ef0c0", textShadow: "0 0 16px rgba(46,230,166,.6)", pointerEvents: "none", animation: "twRise .95s ease-out both" }}>{fx.text}</span>
                                </>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {/* engine platform */}
                <div style={{ height: 8, marginLeft: "clamp(64px, 6.7vw, 106px)", borderRadius: 6, background: lock ? "linear-gradient(90deg, rgba(240,217,154,.15), rgba(240,217,154,.7), rgba(240,217,154,.15))" : "linear-gradient(90deg, transparent, #2a3345, transparent)", animation: lock ? "twEngine 1.8s ease-in-out infinite" : "none", transition: "background .3s ease" }} />
              </div>
            </div>
          </div>

          {/* ── bottom bar ── */}
          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", gap: "clamp(8px, 1vw, 14px)", margin: "10px clamp(10px, 1.6vw, 24px) 20px 10px" }}>
            <button onClick={() => { twSfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 30px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, backdropFilter: "blur(8px)", color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>LOBBY
            </button>
            <button onClick={() => { twSfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={{ flex: "none", width: "clamp(56px, 11vh, 88px)", minHeight: "clamp(56px, 11vh, 88px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, backdropFilter: "blur(8px)", color: T.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" /></svg>
            </button>
            <div style={{ flex: 1 }} />
            {primary}
          </div>

        </div>
      </div>

      {rules && <RulesModal onClose={() => setRules(false)} />}
    </SpaceRoot>
  );
}
