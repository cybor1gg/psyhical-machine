// KENO — space-theme cabinet screen, designed in the established space
// visual language (no handoff prototype for this one). The board is a
// "STAR CHART": a centered 8×5 grid of 40 round star-nodes. The round is
// INSTANT and SERVER-authoritative: one POST to api/routes/keno.js debits,
// draws all 10 numbers and settles; this client only PACES the ten reveals
// (~90ms apart) — drawn numbers, hits, multiplier, payout, table and the
// balance all come from the server. The PAYS ladder is fetched per
// risk/pick-count from GET /keno/table so operator RTP overrides always
// show real numbers before any bet.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { useBalance, getBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar, SectionLabel,
  GoldButton, SoundButton, BetStepper, tileStyle, pillStyle, T,
} from "./Shell";
import { beep, whoosh, sfx, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import { useMaxBet } from "./limits";
import "./space.css";
import "./keno.css";

const MAX_PICKS = 10;   // server: 1..10 picks from 1..40
const NUMBERS = 40;
const REVEAL_MS = 90;   // pacing between drawn-number reveals

// LOW / MED / HIGH pills → the server's risk value spellings.
const RISKS = [
  { label: "LOW", value: "low" },
  { label: "MED", value: "medium" },
  { label: "HIGH", value: "high" },
];

// Node disc size — round buttons, ≥44px touch target, compresses with vh.
const NODE = "clamp(44px, 7vh, 64px)";

// Keno-specific sfx kinds on the shared audio engine.
const knSfx = {
  // rising ping per hit: 520 Hz × 1.07^(n−1)
  hit(n) {
    const base = 520 * Math.pow(1.07, (n || 1) - 1);
    whoosh(700, 2600, 0.08, 0.18);
    beep("triangle", base, base * 1.5, 0.15, 0.14);
    beep("sine", base * 2, base * 3, 0.07, 0.12, 0.04);
  },
  // NOTE: a drawn number you didn't pick plays nothing — the cabinet only
  // celebrates hits, so there is no "miss" recipe any more.
  bet: sfx.bet,
  cash: sfx.cash,
  win: sfx.win,
  click: sfx.click,
  tick: sfx.tick,
};

// Ladder multiplier formatting — the server truncates to 4 dp; show what fits.
function fmtMult(m) {
  if (m >= 100) return "×" + Math.round(m);
  if (m >= 10) return "×" + m.toFixed(1);
  return "×" + m.toFixed(2);
}

function RulesModal({ onClose }) {
  const row = (mark, color, text) => (
    <div style={{ display: "flex", gap: 13 }}>
      <span style={{ color, fontWeight: 700 }}>{mark}</span><span>{text}</span>
    </div>
  );
  return (
    // a flat scrim, never backdrop-filter: the scene behind this never stops
    // moving, so the blur would re-read and re-blur the whole screen every
    // frame for as long as a player leaves the rules open
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,6,10,.86)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540, padding: "38px 42px", borderRadius: 24, border: `2px solid ${T.ctlBorder}`, background: "linear-gradient(180deg,#111826,#0a0d14)", boxShadow: "0 34px 90px rgba(0,0,0,.65)" }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>HOW TO PLAY</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 15, margin: "26px 0 30px", fontSize: 17, lineHeight: 1.5, color: "#b7c0d1" }}>
          {row("✦", T.gold, "Pick up to 10 numbers on the star chart.")}
          {row("◉", T.win, "Ten stars are drawn — every drawn number you picked is a HIT.")}
          {row("▤", T.gold, "The PAYS ladder shows what each hit count multiplies your bet by.")}
          {row("↑", T.lose, "Higher risk reshapes the ladder: rarer hits, far bigger top pays.")}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}

export default function KenoSpace() {
  // the backoffice owns this; the screen used to hardcode it
  const MAX_BET = useMaxBet("keno");
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  // phase: idle (picking) → drawing (paced reveals) → over (settled) → idle
  const [phase, setPhase] = useState("idle");
  const [bet, setBet] = useState(100);
  const [risk, setRisk] = useState("medium");
  const [picks, setPicks] = useState(() => new Set());
  const [revealed, setRevealed] = useState([]);   // drawn numbers shown so far, draw order
  const [result, setResult] = useState(null);     // { hits, multiplier, payout } after settle
  const [lastWin, setLastWin] = useState(0);      // server payout, survives resets for the chip
  const [table, setTable] = useState(null);       // scaled ladder, index = hits
  const [flash, setFlash] = useState(false);
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");

  const readRef = useRef(null);
  const timers = useRef([]);
  const busyRef = useRef(false);       // one request in flight at a time
  const picksRef = useRef(picks);
  picksRef.current = picks;

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => clearTimers(), []);

  // ── suspense: the whole point of Keno is not knowing until the balls stop ──
  // The server settles the round in one POST, so the credits are frozen from
  // the moment BET is pressed until the tenth star has landed and the result
  // readout appears. Every hold is matched by exactly one release (error paths
  // included) and anything outstanding is released on unmount.
  const holdRef = useRef(0);
  const holdCredits = () => { holdRef.current++; holdBalance(); };
  const releaseCredits = () => { if (holdRef.current > 0) { holdRef.current--; releaseBalance(); } };
  useEffect(() => () => { while (holdRef.current > 0) { holdRef.current--; releaseBalance(); } }, []);

  // ── mount: ambience (instant game — no live round to resume) ─────────────
  useEffect(() => {
    armAmbientOnGesture();
    startAmbient();
  }, []);

  // ── PAYS ladder from the server, per risk + pick count ───────────────────
  const np = picks.size;
  useEffect(() => {
    if (np === 0) { setTable(null); return; }
    let dead = false;
    apiGet(`/api/games/keno/table?risk=${risk}&picks=${np}`).then(({ ok, data }) => {
      if (!dead && ok) setTable(data.table);
    });
    return () => { dead = true; };
  }, [risk, np]);

  // readout scale-pop on each hit (Mines idiom)
  const popRead = () => {
    const el = readRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = "scale(1.22)";
    requestAnimationFrame(() => { el.style.transition = "transform .34s cubic-bezier(.2,1.5,.4,1)"; el.style.transform = "scale(1)"; });
  };

  const flashTimer = useRef(0);
  const doFlash = () => {
    setFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = later(() => setFlash(false), 420);
  };

  // clear the settled board back to a fresh selection state
  const resetRound = () => {
    clearTimers();
    setRevealed([]);
    setResult(null);
    setPhase("idle");
  };

  // ── selection ─────────────────────────────────────────────────────────────
  const lock = phase === "drawing";

  function toggleNode(n) {
    if (lock || busyRef.current) return;
    if (phase === "over") resetRound();
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else if (next.size < MAX_PICKS) next.add(n);
      else return prev;
      return next;
    });
    knSfx.click();
  }

  function autoPick() {
    if (lock || busyRef.current) return;
    if (phase === "over") resetRound();
    const have = picksRef.current;
    const pool = [];
    for (let n = 1; n <= NUMBERS; n++) if (!have.has(n)) pool.push(n);
    for (let k = pool.length - 1; k > 0; k--) { const j = (Math.random() * (k + 1)) | 0; const t = pool[k]; pool[k] = pool[j]; pool[j] = t; }
    const add = pool.slice(0, MAX_PICKS - have.size);
    add.forEach((n, i) => later(() => {
      setPicks((prev) => { const next = new Set(prev); if (next.size < MAX_PICKS) next.add(n); return next; });
      knSfx.tick();
    }, i * 60));
  }

  function clearPicks() {
    if (lock || busyRef.current) return;
    resetRound();
    setPicks(new Set());
    knSfx.click();
  }

  function pickRisk(v) {
    if (lock || busyRef.current || v === risk) return;
    if (phase === "over") resetRound();
    setRisk(v);
    knSfx.click();
  }

  // ── server round flow: one POST settles; we pace the ten reveals ─────────
  async function startBet() {
    if (lock || busyRef.current || np === 0) return;
    const bal = getBalance() ?? 0;   // true credits, even mid-hold, so the cap is right
    if (bal < 50) return;
    const stake = Math.min(bet, MAX_BET, Math.floor(bal));
    busyRef.current = true;
    setError("");
    // freeze the credits BEFORE the request: this one call debits, draws and
    // settles, and the answer must not reach the readout before the balls do
    holdCredits();
    let handoff = false;
    try {
      const { ok, data } = await apiPost("/api/games/keno/start", { betAmount: stake, picks: [...picksRef.current], risk });
      busyRef.current = false;
      if (!ok) { setError(data?.error || "Something went wrong"); return; }
      setBet(stake);
      clearTimers();
      setRevealed([]);
      setResult(null);
      setTable(data.table);   // the ladder this round actually paid under
      setPhase("drawing");
      knSfx.bet();

      const pickSet = new Set(data.picks);
      let hitN = 0;
      data.drawn.forEach((n, i) => {
        const isHit = pickSet.has(n);
        if (isHit) hitN += 1;
        const pitch = hitN; // rising ping per hit
        later(() => {
          setRevealed((r) => r.concat(n));
          if (isHit) { knSfx.hit(pitch); popRead(); }   // a miss lands silently
        }, 260 + i * REVEAL_MS);
      });
      // the reveal is now the paced part of the round: nothing about the
      // outcome reaches the screen — credits included — until this last beat
      handoff = true;
      later(() => {
        setPhase("over");
        setResult({ hits: data.hits, multiplier: data.multiplier, payout: data.payout });
        setLastWin(data.payout);
        if (data.payout > 0) {
          if (data.multiplier >= 10) knSfx.cash(); else knSfx.win();
          doFlash();
          popRead();
        }
        releaseCredits();   // last star drawn, result on screen — credits catch up
      }, 260 + data.drawn.length * REVEAL_MS + 420);
    } finally {
      if (!handoff) releaseCredits();
    }
  }

  // ── derived render values ─────────────────────────────────────────────────
  const over = phase === "over";
  const revealedSet = new Set(revealed);
  const liveHits = revealed.filter((n) => picks.has(n)).length;

  // star-chart nodes: 8×5 grid of round buttons, index 1..40
  const nodes = Array.from({ length: NUMBERS }, (_, k) => {
    const n = k + 1;
    const picked = picks.has(n);
    const drawn = revealedSet.has(n);
    const isHit = drawn && picked;
    const isMiss = drawn && !picked;
    // visual state
    let border = "#2a3345", bg = "rgba(10,14,22,.8)", color = T.text2, glow = "none", anim = "none", opacity = 1;
    if (isHit) {
      border = "#3ae0a1"; bg = "radial-gradient(circle at 50% 32%, #1f7d5b, #0d5a3f 70%)"; color = "#eafff7";
      glow = "0 0 22px rgba(46,230,166,.5), inset 0 2px 0 rgba(255,255,255,.18)";
      anim = "knHit .5s cubic-bezier(.2,1.5,.4,1) both";
    } else if (isMiss) {
      border = "#4a5568"; bg = "rgba(255,255,255,.06)"; color = T.text; opacity = 0.45;
    } else if (picked && over) {
      // picked-but-missed after settle: gold-dim
      border = "rgba(217,178,106,.45)"; bg = "rgba(217,178,106,.08)"; color = "rgba(240,217,154,.55)"; opacity = 0.75;
    } else if (picked) {
      border = T.accent; bg = "rgba(217,178,106,.16)"; color = T.gold;
      glow = "0 0 14px rgba(217,178,106,.25)";
      anim = "knPick .25s ease";
    }
    return { n, picked, drawn, isHit, isMiss, border, bg, color, glow, anim, opacity };
  });

  // readout line — server errors take it over, in red
  let readText = "", readColor = T.muted, readGlow = "rgba(0,0,0,0)", readOpacity = 1, readSize = 26;
  if (error) { readText = error.toUpperCase(); readColor = "#ff6a5a"; readGlow = "rgba(255,90,74,.55)"; }
  else if (phase === "idle") { readText = np === 0 ? "PICK UP TO 10 NUMBERS" : "PRESS BET TO DRAW"; readOpacity = 0.8; }
  else if (lock) { readText = liveHits + (liveHits === 1 ? " HIT" : " HITS"); readColor = T.gold; readGlow = "rgba(240,217,154,.5)"; readSize = 34; }
  else if (over && result) {
    readSize = 34;
    if (result.payout > 0) { readText = "×" + result.multiplier.toFixed(2) + "  WIN +" + fmtMKD(result.payout); readColor = T.win; readGlow = "rgba(46,230,166,.5)"; }
    // neutral grey, never punishing
    else if (result.hits === 0) { readText = "NO WIN"; readColor = T.text2; readSize = 30; }
    else { readText = result.hits + (result.hits === 1 ? " HIT  ·  NO WIN" : " HITS  ·  NO WIN"); readColor = T.text2; readSize = 30; }
  }

  // header status chip: last win, or the pick prompt when idle
  const chip = lock
    ? { label: "DRAWING", color: T.gold }
    : lastWin > 0
      ? { label: "WIN " + fmtMKD(lastWin), color: T.win }
      : { label: "PICK UP TO 10", color: T.text2 };

  // primary button
  const canBet = balance >= 50;
  const stakeShown = Math.min(bet, Math.max(50, Math.floor(balance) || 50));
  const primaryStyle = { flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 };
  let primary;
  if (lock) primary = <GoldButton label="DRAWING…" disabled labelSize="clamp(21px, 2.2vw, 32px)" style={primaryStyle} />;
  else if (np === 0) primary = <GoldButton label="PICK NUMBERS" disabled labelSize="clamp(21px, 2.2vw, 32px)" style={primaryStyle} />;
  else primary = <GoldButton label="BET" sub={fmtMKD(stakeShown)} onClick={startBet} disabled={!canBet} labelSize="clamp(21px, 2.2vw, 32px)" style={primaryStyle} />;

  // PAYS ladder highlight: achieved row (green) after settle, else the row
  // the current hit count would pay (gold) — row 0 while picking.
  const hlHits = over && result ? result.hits : liveHits;

  const secondaryTile = (label, onClick) => (
    <button onClick={onClick} className="sp-hover-gold"
      style={tileStyle({ flex: 1, minHeight: "clamp(42px, 7vh, 58px)", fontSize: "clamp(13px, 2vh, 17px)", letterSpacing: 2, opacity: lock ? 0.4 : 1, pointerEvents: lock ? "none" : "auto", transition: "all .2s ease" })}>
      {label}
    </button>
  );

  return (
    <SpaceRoot>

      {/* win flash */}
      <div style={{ position: "absolute", inset: 0, zIndex: 8, pointerEvents: "none", background: "radial-gradient(circle at 50% 50%, rgba(46,230,166,.42), rgba(46,230,166,0) 70%)", opacity: flash ? 1 : 0, transition: "opacity .3s ease" }} />

      <SpaceHeader title="KENO" chip={chip} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", gap: 0 }}>

        {/* ── left control panel ── */}
        <SpaceSidebar>
          <SoundButton />
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 2.2vh, 18px)", opacity: lock ? 0.4 : 1, pointerEvents: lock ? "none" : "auto", transition: "opacity .2s ease" }}>
            <BetStepper bet={bet} setBet={setBet} disabled={lock} maxBet={MAX_BET} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SectionLabel>RISK</SectionLabel>
              <div style={{ display: "flex", gap: 10 }}>
                {RISKS.map((r) => (
                  <button key={r.value} onClick={() => pickRisk(r.value)} style={pillStyle(risk === r.value, { flex: 1, minHeight: "clamp(42px, 7vh, 60px)", fontSize: "clamp(13px, 2.1vh, 18px)", letterSpacing: 2 })}>{r.label}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SectionLabel>PICKED</SectionLabel>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: "clamp(42px, 7vh, 58px)", border: `2px solid ${T.ctlBorder}`, borderRadius: 16, background: "rgba(255,255,255,.03)", fontWeight: 700, fontSize: "clamp(17px, 2.8vh, 24px)" }}>
              <span style={{ color: np > 0 ? T.gold : T.muted }}>{np}</span>
              <span style={{ color: T.muted, fontSize: "clamp(13px, 2.1vh, 18px)" }}>/ {MAX_PICKS}</span>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {secondaryTile("AUTO PICK", autoPick)}
              {secondaryTile("CLEAR", clearPicks)}
            </div>
          </div>
        </SpaceSidebar>

        {/* ── field column ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* readout */}
          <div style={{ position: "relative", zIndex: 4, height: 46, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div ref={readRef} style={{ opacity: readOpacity, transform: "scale(1)", fontSize: readSize, fontWeight: 700, letterSpacing: 3, color: readColor, textShadow: `0 0 28px ${readGlow}`, transition: "opacity .25s ease", whiteSpace: "nowrap" }}>{readText}</div>
          </div>

          {/* ── STAR CHART + PAYS ladder ── */}
          <div style={{ position: "relative", zIndex: 4, flex: 1, minHeight: 140, margin: "4px clamp(12px, 1.8vw, 28px) 10px", display: "flex", alignItems: "center", justifyContent: "center", gap: "clamp(14px, 2vw, 32px)" }}>

            {/* 8×5 grid of round star-nodes */}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(8, ${NODE})`, gridAutoRows: NODE, gap: "clamp(8px, 1.4vh, 14px)" }}>
              {nodes.map((t) => (
                <button key={t.n} className="kn-node" disabled={lock} onClick={() => toggleNode(t.n)}
                  style={{
                    position: "relative", width: NODE, height: NODE, padding: 0, borderRadius: "50%",
                    border: `2px solid ${t.border}`, background: t.bg, color: t.color, opacity: t.opacity,
                    boxShadow: t.glow, animation: t.anim,
                    fontFamily: "'DM Sans', Helvetica, sans-serif", fontWeight: 700, fontSize: "clamp(15px, 2.6vh, 22px)",
                    cursor: lock ? "default" : "pointer", outline: "none",
                    transition: "border-color .18s ease, background .18s ease, color .18s ease, opacity .3s ease, box-shadow .18s ease",
                  }}>
                  {t.n}
                  {/* reveal twinkle (every drawn number) */}
                  {t.drawn && <span style={{ position: "absolute", inset: -4, borderRadius: "50%", pointerEvents: "none", background: "radial-gradient(circle, rgba(255,255,255,.55), transparent 65%)", animation: "knTwinkle .5s ease-out both" }} />}
                  {/* hit ring burst */}
                  {t.isHit && <span style={{ position: "absolute", left: "50%", top: "50%", width: "150%", height: "150%", borderRadius: "50%", border: "3px solid #7ef0c0", pointerEvents: "none", animation: "knRing .6s ease-out both" }} />}
                  {/* miss: soft white flash that fades to the dimmed disc */}
                  {t.isMiss && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", pointerEvents: "none", background: "rgba(255,255,255,.8)", animation: "knMissFade .55s ease both" }} />}
                </button>
              ))}
            </div>

            {/* PAYS ladder — hits → multiplier for the current risk/pick count */}
            <div style={{ flex: "none", width: "clamp(150px, 13vw, 205px)", maxHeight: "100%", display: "flex", flexDirection: "column", gap: "clamp(3px, .7vh, 6px)", padding: "clamp(10px, 1.6vh, 16px) clamp(10px, 1vw, 14px)", borderRadius: 18, border: `2px solid ${T.panelBorder}`, background: T.panelBg, overflow: "hidden" }}>
              <div style={{ fontSize: "clamp(11px, 1.8vh, 14px)", letterSpacing: 4, color: T.muted, marginBottom: 4 }}>PAYS</div>
              {np === 0 || !table ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: T.muted, fontSize: "clamp(12px, 1.9vh, 15px)", letterSpacing: 2, lineHeight: 1.6, padding: "0 4px" }}>
                  PICK NUMBERS TO SEE THE LADDER
                </div>
              ) : (
                table.map((m, h) => {
                  const achieved = over && result && h === result.hits;
                  const current = !achieved && h === hlHits;
                  const zero = m <= 0;
                  return (
                    <div key={h} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "clamp(3px, .7vh, 6px) clamp(8px, .9vw, 12px)", borderRadius: 10,
                      border: `1px solid ${achieved ? "#3ae0a1" : current ? T.accent : "transparent"}`,
                      background: achieved ? "rgba(58,224,161,.12)" : current ? "rgba(217,178,106,.12)" : "transparent",
                      color: achieved ? T.win : current ? T.gold : zero ? T.disabled : T.text2,
                      fontWeight: 700, fontSize: "clamp(12px, 2vh, 16px)",
                      animation: achieved ? "knRowLight .5s ease both" : "none",
                      transition: "all .2s ease",
                    }}>
                      <span style={{ letterSpacing: 1, fontSize: "clamp(11px, 1.8vh, 14px)", opacity: 0.85 }}>{h} HIT{h === 1 ? "" : "S"}</span>
                      <span>{fmtMult(m)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── bottom bar ── */}
          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", gap: "clamp(8px, 1vw, 14px)", margin: "0 clamp(10px, 1.6vw, 24px) 20px 10px" }}>
            <button onClick={() => { knSfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 30px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>LOBBY
            </button>
            <button onClick={() => { knSfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={{ flex: "none", width: "clamp(56px, 11vh, 88px)", minHeight: "clamp(56px, 11vh, 88px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
