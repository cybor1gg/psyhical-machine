// DICE — space-theme cabinet screen, designed in the established space
// visual language (no handoff prototype existed for this game). The board is
// the ORBIT GAUGE: a golden orbit track across the starfield, the win zone
// glowing gold on the chosen side of a draggable ringed-planet target
// handle, and a huge roll number above it. On ROLL a comet streaks along
// the track and lands on the roll with a spark burst (mines burst idiom)
// while the number spins up digits.
//
// INSTANT family: one POST settles the round — the server is the only
// authority on the roll, win, multiplier, payout and balance
// (api/routes/dice.js). The client only paces the story (~600ms comet
// flight) and keeps display math (multiplier / win chance / profit) locally,
// self-corrected from each response's multiplier × winChance.
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api";
import { useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar, SectionLabel,
  GoldButton, SoundButton, BetStepper, tileStyle, pillStyle, T,
} from "./Shell";
import { whoosh, sfx, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import { useMaxBet } from "./limits";
import "./space.css";
import "./dice.css";

const FLIGHT = 600;     // comet travel / digit spin-up, ms
const MIN_T = 2, MAX_T = 98;

// Dice-specific sfx on the shared audio engine. Wins get the space win
// chord; a loss makes no sound at all — this cabinet never scores a defeat.
const dcSfx = {
  roll: sfx.bet,
  flight: () => whoosh(500, 2600, 0.07, 0.55),
  tick: sfx.tick,
  win: () => { sfx.win(); whoosh(1200, 4200, 0.05, 0.45, 0.1); },
  click: sfx.click,
};

function RulesModal({ onClose }) {
  const row = (mark, color, text) => (
    <div style={{ display: "flex", gap: 13 }}>
      <span style={{ color, fontWeight: 700 }}>{mark}</span><span>{text}</span>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,6,10,.72)", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540, padding: "38px 42px", borderRadius: 24, border: `2px solid ${T.ctlBorder}`, background: "linear-gradient(180deg,#111826,#0a0d14)", boxShadow: "0 34px 90px rgba(0,0,0,.65)" }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>HOW TO PLAY</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 15, margin: "26px 0 30px", fontSize: 17, lineHeight: 1.5, color: "#b7c0d1" }}>
          {row("◆", T.gold, "Drag the planet to set a target (2–98) and pick OVER or UNDER.")}
          {row("●", T.win, "The comet rolls 0.00–99.99. Land inside your golden zone to win.")}
          {row("↑", T.text2, "A smaller zone means a lower win chance — and a bigger multiplier.")}
          {row("✦", T.gold, "RTP 99% at every target: payout = 0.99 ÷ win chance.")}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}

export default function DiceSpace() {
  // the backoffice owns this; the screen used to hardcode it
  const MAX_BET = useMaxBet("dice");
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  // phase: idle → rolling (comet in flight) → settled → rolling again
  const [phase, setPhase] = useState("idle");
  const [bet, setBet] = useState(100);
  const [target, setTarget] = useState(50);     // integer 2..98
  const [over, setOver] = useState(true);       // win side: right (over) / left (under)
  const [roll, setRoll] = useState(null);       // last server roll (number)
  const [won, setWon] = useState(false);
  const [lastWin, setLastWin] = useState(0);    // server payout of the last win
  const [rolls, setRolls] = useState([]);       // recent pills, newest first
  const [payoutFactor, setPayoutFactor] = useState(0.99); // (1−edge), corrected from responses
  const [display, setDisplay] = useState(null); // the huge number (null → dim placeholder)
  const [comet, setComet] = useState(null);     // { left } while the comet flies
  const [marker, setMarker] = useState(null);   // { left, won } landing diamond
  const [bursts, setBursts] = useState([]);
  const [numKey, setNumKey] = useState(0);      // retriggers the settle pop
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");

  const trackRef = useRef(null);
  const dragRef = useRef(false);
  const busyRef = useRef(false);      // one request in flight at a time
  const timers = useRef([]);
  const bid = useRef(0);
  const scrTimer = useRef(0);
  const scrCount = useRef(0);

  // ── suspense: the credits stay frozen until the comet lands ───────────────
  const heldRef = useRef(false);
  const holdCredits = () => { if (!heldRef.current) { heldRef.current = true; holdBalance(); } };
  const releaseCredits = () => { if (heldRef.current) { heldRef.current = false; releaseBalance(); } };

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    clearInterval(scrTimer.current);
    releaseCredits(); // unmounted mid-flight — never strand the hold
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── mount: ambience (instant game — never a live round to resume) ─────────
  useEffect(() => {
    armAmbientOnGesture();
    startAmbient();
  }, []);

  // ── digit spin-up while the comet flies ───────────────────────────────────
  const startScramble = () => {
    clearInterval(scrTimer.current);
    scrCount.current = 0;
    scrTimer.current = setInterval(() => {
      setDisplay(Math.floor(Math.random() * 10000) / 100);
      if ((scrCount.current++ & 1) === 0) dcSfx.tick();
    }, 48);
  };
  const stopScramble = () => clearInterval(scrTimer.current);

  // ── landing burst (mines ring + sparks idiom, on the track) ───────────────
  const burst = useCallback((pct, wonB) => {
    const id = ++bid.current;
    const cnt = wonB ? 9 : 7;
    const sparks = Array.from({ length: cnt }, (_, k) => ({ rot: Math.round(k * 360 / cnt + Math.random() * 34) + "deg", sc: (0.7 + Math.random() * 0.8).toFixed(2) }));
    // a win bursts green; a miss gets the same shape in neutral grey
    const b = { id, left: pct + "%", sparks, ring: wonB ? "#7ef0c0" : "rgba(141,160,190,.55)", spark: wonB ? "#8df0c8" : "rgba(141,160,190,.5)", ringSize: wonB ? 110 : 86 };
    setBursts((bs) => bs.concat(b));
    later(() => setBursts((bs) => bs.filter((x) => x.id !== id)), 950);
  }, []);

  // ── target: drag / tap on the orbit track ─────────────────────────────────
  const setFromClientX = useCallback((clientX) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1) return;
    const t = Math.max(MIN_T, Math.min(MAX_T, Math.round(((clientX - r.left) / r.width) * 100)));
    setTarget((prev) => { if (prev !== t) dcSfx.tick(); return t; });
  }, []);

  const lock = phase === "rolling";

  function onTrackDown(e) {
    if (lock) return;
    dragRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
    setFromClientX(e.clientX);
  }
  function onTrackMove(e) { if (dragRef.current && !lock) setFromClientX(e.clientX); }
  function onTrackUp() { dragRef.current = false; }

  function stepTarget(d) {
    if (lock) return;
    dcSfx.click();
    setTarget((t) => Math.max(MIN_T, Math.min(MAX_T, t + d)));
  }

  // ── the round: one POST settles everything ────────────────────────────────
  async function doRoll() {
    if (lock || busyRef.current) return;
    if (balance < 50) return;
    const stake = Math.min(bet, MAX_BET, Math.floor(balance));
    setBet(stake);
    setError("");
    setPhase("rolling");
    busyRef.current = true;
    setMarker(null);
    setLastWin(0);
    startScramble();          // digits spin from the tap — the story starts NOW
    dcSfx.roll();
    holdCredits();            // freeze the readout before the stake is debited
    let flying = false;       // true once the comet owns the hold
    try {
      const { ok, data } = await apiPost("/api/games/dice/start", { betAmount: stake, target, over });
      if (!ok) {
        stopScramble();
        busyRef.current = false;
        setPhase("idle");
        setDisplay(roll);       // restore the previous roll on the big number
        setError(data?.error || "Something went wrong");
        return;
      }
      // self-correct the local display math from the server's truth
      setPayoutFactor(Math.round(data.multiplier * data.winChance * 10000) / 10000);
      // comet flight: offscreen-left → the landing spot, digits spinning
      dcSfx.flight();
      setComet({ left: "-6%" });
      requestAnimationFrame(() => requestAnimationFrame(() => setComet({ left: data.roll + "%" })));
      later(() => {
        stopScramble();
        setComet(null);
        setRoll(data.roll);
        setDisplay(data.roll);
        setWon(data.won);
        setNumKey((k) => k + 1);
        setMarker({ left: data.roll + "%", won: data.won });
        burst(data.roll, data.won);
        setRolls((prev) => [{ n: data.roll, won: data.won, id: data.roundId }, ...prev].slice(0, 6));
        setLastWin(data.won ? data.payout : 0);
        releaseCredits();       // the reveal: the comet has landed
        if (data.won) dcSfx.win(); // a loss lands in silence
        busyRef.current = false;
        setPhase("settled");
      }, FLIGHT + 60);
      flying = true;
    } finally {
      // any path that never reaches the landing must give the hold back
      if (!flying) releaseCredits();
    }
  }

  // ── local display math (server-corrected, same shape as the old client) ───
  const wc = over ? (9999 - target * 100) / 10000 : (target * 100) / 10000;
  const mult = Math.floor((payoutFactor / wc) * 10000) / 10000;
  const profit = Math.floor(bet * (mult - 1) * 100) / 100;

  // win zone geometry (percent of the track)
  const zoneLeft = over ? target : 0;
  const zoneWidth = over ? 100 - target : target;

  // ── readout line — server errors take it over, in red ─────────────────────
  let readText = "", readColor = T.muted, readGlow = "rgba(0,0,0,0)", readOpacity = 1, readSize = 26;
  if (error) { readText = error.toUpperCase(); readColor = "#ff6a5a"; readGlow = "rgba(255,90,74,.55)"; }
  else if (phase === "idle") { readText = "SET TARGET · PRESS ROLL"; readOpacity = 0.8; }
  else if (lock) { readText = "ROLLING"; readColor = T.gold; readGlow = "rgba(240,217,154,.5)"; readSize = 30; }
  else {
    readSize = 34;
    if (won) { readText = "WIN +" + fmtMKD(lastWin); readColor = T.win; readGlow = "rgba(46,230,166,.5)"; }
    else { readText = "NO WIN"; readColor = T.text2; readSize = 28; }
  }

  // header status chip: last win, or the game's range while idle
  const chip = lock
    ? { label: "ROLLING", color: T.gold }
    : lastWin > 0
      ? { label: "+" + fmtMKD(lastWin), color: T.win }
      : { label: "DICE 2–98", color: T.text2 };

  // huge roll number: gold while idle/rolling, outcome-colored after settle
  const settled = phase === "settled";
  const numColor = settled ? (won ? T.win : T.text2) : T.gold;
  const numGlow = settled ? (won ? "rgba(46,230,166,.45)" : "rgba(141,160,190,.28)") : "rgba(240,217,154,.35)";

  const canRoll = balance >= 50;
  const handlePx = "clamp(44px, 8vh, 60px)";     // touch-sized hit box
  const planetPx = "clamp(30px, 5.6vh, 42px)";

  const stat = (label, value, color = T.text) => (
    <div key={label} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "clamp(7px, 1.4vh, 12px) 3px", borderRadius: 14, border: `2px solid ${T.ctlBorder}`, background: "rgba(255,255,255,.03)" }}>
      <span style={{ fontSize: "clamp(9px, 1.5vh, 11px)", letterSpacing: 1.5, color: T.muted, whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: "clamp(12px, 2.1vh, 16px)", fontWeight: 700, color, whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );

  return (
    <SpaceRoot>

      <SpaceHeader title="DICE" chip={chip} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", gap: 0 }}>

        {/* ── left control panel ── */}
        <SpaceSidebar>
          <SoundButton />
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 2vh, 16px)", opacity: lock ? 0.4 : 1, pointerEvents: lock ? "none" : "auto", transition: "opacity .2s ease" }}>
            <BetStepper bet={bet} setBet={setBet} disabled={lock} maxBet={MAX_BET} />

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SectionLabel>TARGET</SectionLabel>
              <div style={{ display: "flex", gap: 10 }}>
                {[["OVER", true], ["UNDER", false]].map(([lbl, dir]) => (
                  <button key={lbl} onClick={() => { if (over !== dir) { dcSfx.click(); setOver(dir); } }}
                    style={pillStyle(over === dir, { flex: 1, minHeight: "clamp(42px, 7.5vh, 60px)", fontSize: "clamp(13px, 2.2vh, 18px)", letterSpacing: 2 })}>{lbl}</button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
                <button onClick={() => stepTarget(-1)} className="sp-hover-gold" style={tileStyle({ flex: "none", width: "clamp(44px, 8vh, 64px)", minHeight: "clamp(44px, 8vh, 64px)", fontSize: "clamp(24px, 4vh, 34px)" })}>−</button>
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: "clamp(44px, 8vh, 64px)", border: `2px solid ${T.ctlBorder}`, borderRadius: 16, background: "rgba(255,255,255,.03)", whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: "clamp(10px, 1.7vh, 13px)", letterSpacing: 2, color: T.muted }}>{over ? "OVER" : "UNDER"}</span>
                  <span style={{ fontSize: "clamp(18px, 3.2vh, 26px)", fontWeight: 700, color: T.gold }}>{target}</span>
                </div>
                <button onClick={() => stepTarget(1)} className="sp-hover-gold" style={tileStyle({ flex: "none", width: "clamp(44px, 8vh, 64px)", minHeight: "clamp(44px, 8vh, 64px)", fontSize: "clamp(22px, 3.7vh, 32px)" })}>+</button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {stat("MULTIPLIER", "×" + mult.toFixed(2), T.gold)}
              {stat("WIN CHANCE", (wc * 100).toFixed(2) + "%")}
              {stat("PROFIT ON WIN", fmtMKD(profit), T.win)}
            </div>
          </div>
        </SpaceSidebar>

        {/* ── board column ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* readout */}
          <div style={{ position: "relative", zIndex: 4, height: 46, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ opacity: readOpacity, fontSize: readSize, fontWeight: 700, letterSpacing: 3, color: readColor, textShadow: `0 0 28px ${readGlow}`, transition: "opacity .25s ease" }}>{readText}</div>
          </div>

          {/* recent rolls — last 6, newest first */}
          <div style={{ position: "relative", zIndex: 4, flex: "none", minHeight: "clamp(30px, 5.5vh, 42px)", display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(6px, .8vw, 12px)" }}>
            {rolls.map((r) => (
              <span key={r.id} style={{ padding: "clamp(4px, .8vh, 7px) clamp(10px, 1.2vw, 16px)", borderRadius: 999, fontSize: "clamp(12px, 2vh, 15px)", fontWeight: 700, letterSpacing: 1, color: r.won ? T.win : T.text2, border: `2px solid ${r.won ? "rgba(58,224,161,.45)" : "rgba(141,160,190,.32)"}`, background: r.won ? "rgba(46,230,166,.1)" : "rgba(141,160,190,.07)", animation: "dcPillIn .35s cubic-bezier(.2,1.5,.4,1) both" }}>
                {r.n.toFixed(2)}
              </span>
            ))}
          </div>

          {/* ── the ORBIT GAUGE ── */}
          <div style={{ position: "relative", zIndex: 4, flex: 1, minHeight: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(8px, 3.5vh, 34px)" }}>

            {/* huge roll number */}
            <div key={numKey} style={{ fontSize: "clamp(64px, 14vh, 120px)", fontWeight: 700, lineHeight: 1, letterSpacing: 2, fontVariantNumeric: "tabular-nums", color: numColor, opacity: display == null ? 0.4 : 1, textShadow: `0 0 46px ${numGlow}`, animation: settled ? "dcNumPop .34s cubic-bezier(.2,1.5,.4,1) both" : "none", transition: "color .2s ease" }}>
              {(display == null ? 0 : display).toFixed(2)}
            </div>

            {/* the orbit track (drag / tap anywhere on it to set the target) */}
            <div ref={trackRef} className={"dc-track" + (lock ? " dc-locked" : "")}
              onPointerDown={onTrackDown} onPointerMove={onTrackMove} onPointerUp={onTrackUp} onPointerCancel={onTrackUp}
              style={{ position: "relative", width: "min(70%, 1050px)", height: "clamp(84px, 16vh, 124px)", touchAction: "none" }}>

              {/* base orbit — the lose side stays dim */}
              <div style={{ position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)", height: "clamp(14px, 2.6vh, 20px)", borderRadius: 999, background: "#2a3345", boxShadow: "inset 0 2px 5px rgba(0,0,0,.55), 0 0 18px rgba(217,178,106,.1)" }} />
              {/* golden win zone */}
              <div style={{ position: "absolute", left: zoneLeft + "%", width: zoneWidth + "%", top: "50%", transform: "translateY(-50%)", height: "clamp(14px, 2.6vh, 20px)", borderRadius: 999, background: "linear-gradient(180deg, rgba(240,217,154,.5), rgba(217,178,106,.35))", boxShadow: "0 0 22px rgba(217,178,106,.35), inset 0 1px 0 rgba(255,255,255,.25)", transition: lock ? "none" : "left .2s ease, width .2s ease" }} />

              {/* scale labels */}
              {[0, 25, 50, 75, 100].map((v) => (
                <span key={v} style={{ position: "absolute", left: v + "%", top: "calc(50% + clamp(16px, 3vh, 24px))", transform: "translateX(-50%)", fontSize: "clamp(10px, 1.7vh, 13px)", letterSpacing: 2, color: T.muted, pointerEvents: "none" }}>{v}</span>
              ))}

              {/* landing marker (previous roll) */}
              {marker && (
                <span style={{ position: "absolute", left: marker.left, top: "50%", width: "clamp(12px, 2.2vh, 17px)", height: "clamp(12px, 2.2vh, 17px)", borderRadius: 3, background: marker.won ? T.win : T.text2, boxShadow: `0 0 16px ${marker.won ? "rgba(46,230,166,.7)" : "rgba(141,160,190,.35)"}`, animation: "dcLand .4s cubic-bezier(.3,1.4,.4,1) both", pointerEvents: "none", zIndex: 5 }} />
              )}

              {/* the comet */}
              {comet && (
                <div style={{ position: "absolute", left: comet.left, top: "50%", zIndex: 6, pointerEvents: "none", transition: `left ${FLIGHT}ms cubic-bezier(.3,.7,.25,1)` }}>
                  <span style={{ position: "absolute", right: 5, top: -2, width: "clamp(44px, 6vw, 84px)", height: 3.5, borderRadius: 3, background: "linear-gradient(90deg, rgba(240,217,154,0), rgba(255,255,255,.9))" }} />
                  <span style={{ position: "absolute", left: -8, top: -8, width: 16, height: 16, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #ffffff, #f0d99a 55%, rgba(240,217,154,0) 78%)", boxShadow: "0 0 20px rgba(240,217,154,.85)" }} />
                </div>
              )}

              {/* landing burst (mines ring + sparks idiom) */}
              {bursts.map((b) => (
                <div key={b.id} style={{ position: "absolute", left: b.left, top: "50%", width: 0, height: 0, zIndex: 7, pointerEvents: "none" }}>
                  <span style={{ position: "absolute", left: 0, top: 0, width: b.ringSize, height: b.ringSize, borderRadius: "50%", border: `3px solid ${b.ring}`, animation: "dcRing .6s ease-out both" }} />
                  {b.sparks.map((sp, k) => (
                    <span key={k} style={{ position: "absolute", left: 0, top: 0, transform: `rotate(${sp.rot}) scale(${sp.sc})` }}>
                      <span style={{ position: "absolute", left: 0, top: -2, width: 14, height: 4, borderRadius: 2, background: b.spark, animation: "dcSpark .55s ease-out both" }} />
                    </span>
                  ))}
                </div>
              ))}

              {/* target handle — a small ringed planet, value above it */}
              <div className="dc-handle" style={{ position: "absolute", left: target + "%", top: "50%", width: handlePx, height: handlePx, transform: "translate(-50%,-50%)", zIndex: 8, display: "flex", alignItems: "center", justifyContent: "center", transition: dragRef.current ? "none" : "left .12s ease-out", opacity: lock ? 0.75 : 1 }}>
                <span style={{ position: "absolute", left: "50%", bottom: "calc(100% + clamp(2px, .6vh, 6px))", transform: "translateX(-50%)", fontSize: "clamp(14px, 2.4vh, 18px)", fontWeight: 700, letterSpacing: 1, color: T.gold, textShadow: "0 0 14px rgba(240,217,154,.5)", pointerEvents: "none" }}>{target}</span>
                <span style={{ position: "relative", width: planetPx, height: planetPx, borderRadius: "50%", background: "radial-gradient(circle at 32% 28%, #f6ecc9, #c79a54 60%, #7a5e2c)", animation: "dcHandleGlow 2.6s ease-in-out infinite" }}>
                  <span style={{ position: "absolute", left: "-34%", top: "30%", width: "168%", height: "40%", borderRadius: "50%", border: "2px solid rgba(240,217,154,.55)", transform: "rotate(-16deg)" }} />
                  <span style={{ position: "absolute", left: "18%", top: "16%", width: "26%", height: "18%", borderRadius: "50%", background: "rgba(255,255,255,.4)", filter: "blur(1px)" }} />
                </span>
              </div>
            </div>
          </div>

          {/* ── bottom bar ── */}
          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", gap: "clamp(8px, 1vw, 14px)", margin: "0 clamp(10px, 1.6vw, 24px) 20px 10px" }}>
            <button onClick={() => { dcSfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 30px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>LOBBY
            </button>
            <button onClick={() => { dcSfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={{ flex: "none", width: "clamp(56px, 11vh, 88px)", minHeight: "clamp(56px, 11vh, 88px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" /></svg>
            </button>
            <div style={{ flex: 1 }} />
            <GoldButton label={lock ? "ROLLING…" : "ROLL"} sub={fmtMKD(Math.min(bet, Math.max(50, Math.floor(balance) || 50)))}
              onClick={doRoll} disabled={lock || !canRoll} labelSize="clamp(21px, 2.2vw, 32px)"
              style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 }} />
          </div>

        </div>
      </div>

      {rules && <RulesModal onClose={() => setRules(false)} />}
    </SpaceRoot>
  );
}
