// CHICKEN CROSS — space-theme cabinet screen around the ORIGINAL road stage.
// The play area is the real chicken game (ChickenVisuals: hen sprites, road,
// lanes, cars, bollard saves, gas manholes — the /games/chicken/*.webp art),
// driven by the old ChickenGame brain ported 1:1: hop-at-the-tap theatre,
// bollard save choreography, killer-car impact timing, Manual/Auto rounds.
// Only the CHROME is the space theme: SpaceBackground behind the stage panel,
// SpaceHeader with status + МКД credits chips, the sidebar (sound / bet
// stepper / mode / difficulty / auto fields) and the LOBBY · ⓘ · GO / CASH
// OUT bottom bar. The round is SERVER-authoritative: every outcome comes from
// api/routes/chicken.js (start / step / cashout / active); the theatre only
// dramatises what the ledger already settled.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { useBalance, getBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import { sound } from "../lib/sound";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar, SectionLabel,
  GoldButton, SoundButton, BetStepper, tileStyle, pillStyle, T,
} from "./Shell";
import { sfx, useVol, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import { ChickenStage, pickCar, CARS, CAR_IMPACT_MS, preloadChickenArt } from "../components/mint/ChickenVisuals";
import { useMaxBet } from "./limits";
import "./space.css";
import "./chicken.css";


const DIFFS = {
  easy:      { lanes: 24, death: 0.05, label: "EASY" },
  medium:    { lanes: 22, death: 0.12, label: "MEDIUM" },
  hard:      { lanes: 18, death: 0.24, label: "HARD" },
  daredevil: { lanes: 13, death: 0.45, label: "DAREDEVIL" },
};
const DIFF_KEYS = Object.keys(DIFFS);

// Display math for the idle road (the design always shows the full ladder).
// The server's real ladder replaces it the moment a round starts.
const buildMults = (difficulty) => {
  const { lanes, death } = DIFFS[difficulty];
  const out = [];
  for (let n = 1; n <= lanes; n++) out.push(Math.floor((0.99 / Math.pow(1 - death, n)) * 100) / 100);
  return out;
};
// design rhythm: EVERY hop locks Go for exactly this long — same beat whether
// or not a save happens
const STEP_LOCK_MS = 450;
const fmt = (n) => (isFinite(n) ? n : 0).toFixed(2);

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
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, padding: "38px 42px", borderRadius: 24, border: `2px solid ${T.ctlBorder}`, background: "linear-gradient(180deg,#111826,#0a0d14)", boxShadow: "0 34px 90px rgba(0,0,0,.65)" }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>HOW TO PLAY</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 15, margin: "26px 0 30px", fontSize: 17, lineHeight: 1.5, color: "#b7c0d1" }}>
          {row("▸", T.win, "Guide the chicken across the road one lane at a time. Every lane you clear compounds your multiplier.")}
          {row("●", T.lose, "A car ends the round — and some manholes leak gas. Get caught and the bet is lost.")}
          {row("↑", T.gold, "Cash out any time after the first lane. Cross every lane and you're paid automatically.")}
          {row("✦", T.gold, "Four difficulties, from Easy (24 lanes, 5% deadly) to Daredevil (13 lanes, 45% deadly).")}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}

export default function ChickenSpace() {
  // the backoffice owns this; the screen used to hardcode it
  const MAX_BET = useMaxBet("chicken");
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;
  const vol = useVol();

  // ── the old brain's round state, verbatim ─────────────────────────────────
  const [bet, setBet] = useState(100);
  const [mode, setMode] = useState("Manual");
  const [difficulty, setDifficulty] = useState("medium");
  const [lane, setLane] = useState(0);
  const [ladder, setLadder] = useState(() => buildMults("medium")); // display; server's replaces it at start
  const [playing, setPlaying] = useState(false);
  const [dead, setDead] = useState(false);
  const [hit, setHit] = useState(false);             // chicken actually struck (splat + red manhole + shake)
  const [cashed, setCashed] = useState(false);
  const [hitLane, setHitLane] = useState(0);
  const [carSrc, setCarSrc] = useState(CARS[0]);
  const [deathType, setDeathType] = useState("car");
  const [hopKey, setHopKey] = useState(0);
  const [startKey, setStartKey] = useState(0);
  const [win, setWin] = useState(null);              // {payout, profit} → stage's cash-out popup
  const [busy, setBusy] = useState(false);
  const [rushLane, setRushLane] = useState(0);       // lane the chicken just hopped into → cars there floor it
  const [save, setSave] = useState(null);            // bollard near-miss {lane, key, carSrc, startY, impactMs, riseMs}
  const [saveLock, setSaveLock] = useState(false);
  const [steamLanes, setSteamLanes] = useState([]);  // cosmetic: which lanes leak green gas this round
  const [potential, setPotential] = useState(0);     // server potentialPayout (CASH OUT sub-label)
  const [lastWin, setLastWin] = useState(0);         // server payout (header chip)
  const [error, setError] = useState("");
  const [rules, setRules] = useState(false);

  const timers = useRef([]);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => clearTimers(), []);

  // ── suspense: freeze the credits readout until the reveal lands ───────────
  // Every hold is matched by exactly one release (error paths included), and
  // anything still outstanding is released on unmount.
  const holdRef = useRef(0);
  const holdCredits = () => { holdRef.current++; holdBalance(); };
  const releaseCredits = () => { if (holdRef.current > 0) { holdRef.current--; releaseBalance(); } };
  useEffect(() => () => { while (holdRef.current > 0) { holdRef.current--; releaseBalance(); } }, []);
  const hitTimerRef = useRef(null);
  const saveTimers = useRef([]);
  const saveRef = useRef(null);
  saveRef.current = save;
  const endedRef = useRef(false);      // previous round ended → next start hops out of the train
  const steamRef = useRef([]);
  const deadRef = useRef(false);
  deadRef.current = dead;
  const busyRef = useRef(false);       // one request in flight at a time

  const N = ladder.length;
  const curMult = lane >= 1 && N ? ladder[Math.min(lane, N) - 1] : 1;
  const nextMult = N && lane < N ? ladder[lane] : curMult;
  const winNow = bet * curMult;

  // only a few rare lanes per round leak green gas — pure theatre; deadliness
  // is the server's call, this only picks HOW a death on that lane looks
  const genSteam = (n) => { const a = []; for (let i = 1; i <= n; i++) a[i] = Math.random() < 0.2; return a; };

  // ── space chrome plumbing: ambience, art preload, engine mute tie ─────────
  useEffect(() => {
    armAmbientOnGesture();
    startAmbient();
    preloadChickenArt();
  }, []);
  // the stage's own engine (lib/sound.js) follows the space volume: OFF mutes it
  useEffect(() => { sound.setMuted(vol === 0); }, [vol]);

  // ── resume a live round on refresh ──
  const initRan = useRef(false);
  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    apiGet("/api/games/chicken/active").then(({ ok, data }) => {
      if (!ok || !data.active) return;
      setDifficulty(data.difficulty);
      setLadder(data.ladder || []);
      setLane(data.lane || 0);
      if (data.betAmount != null) setBet(Math.max(50, Math.round(Number(data.betAmount))));
      setPotential(data.potentialPayout ?? 0);
      const sl = genSteam((data.ladder || []).length); steamRef.current = sl; setSteamLanes(sl);
      setPlaying(true);
    });
  }, []);

  async function api(path, body) {
    busyRef.current = true;
    const { ok, data } = await apiPost(path, body);
    busyRef.current = false;
    if (!ok) { setError(data?.error || "Something went wrong"); return null; }
    return data;
  }

  const resetRound = () => {
    clearTimeout(hitTimerRef.current);
    saveTimers.current.forEach(clearTimeout); saveTimers.current = [];
    setSave(null); setSaveLock(false);
    setDead(false); setHit(false); setCashed(false); setWin(null); setHitLane(0);
  };

  // ── start ──
  async function start() {
    if (playing || busy || busyRef.current) return;
    const bal = getBalance() ?? 0;
    const stake = Math.min(bet, MAX_BET, Math.floor(bal));
    if (stake < 50) { setError("Insufficient balance"); return null; }
    sound.prime();
    setError("");
    resetRound();
    setLane(0);
    setPotential(0);
    setLastWin(0);
    sound.walk(); // the pedestrian signal turns mint — the chicken has right of way
    sfx.bet();
    // a fresh chicken hops out of the train door when the last one is gone
    if (endedRef.current) { setStartKey((k) => k + 1); endedRef.current = false; }
    setPlaying(true);
    const data = await api("/api/games/chicken/start", { betAmount: stake, difficulty });
    if (!data) { setPlaying(false); return null; }
    setBet(stake);
    setLadder(data.ladder);
    const sl = genSteam(data.ladder.length); steamRef.current = sl; setSteamLanes(sl);
    return data;
  }

  // ── bollard save theatre (pure presentation, only ever on SAFE lanes) ──
  const triggerSave = (idx, opts) => {
    const o = opts || {};
    const impactMs = o.impactMs != null ? o.impactMs : 380;
    const riseMs = o.riseMs != null ? o.riseMs : 0;
    saveTimers.current.forEach(clearTimeout); saveTimers.current = [];
    setSave({ lane: idx, key: Date.now(), carSrc: o.carSrc || pickCar(), startY: o.startY, impactMs, riseMs });
    setSaveLock(true);
    const T2 = saveTimers.current;
    T2.push(setTimeout(() => sound.bollardUp(), riseMs));
    T2.push(setTimeout(() => sound.bollardCrash(), impactMs));
    T2.push(setTimeout(() => setSaveLock(false), STEP_LOCK_MS));   // fixed unlock — same beat as a plain hop
    // wreck + raised bollards stay in place for the rest of the round
  };
  // a traffic car caught still ABOVE the crossing when the chicken hops in → it
  // becomes the rogue car: bollards pop up right in front of it and it crashes
  // into them, starting from exactly where it already is
  const chargeSave = (laneIdx, src, y, H) => {
    if (saveRef.current || deadRef.current) return false;   // a death is playing out — no save
    const crashY = -287, enterY = -(H * 0.62 + 200);
    const impactMs = Math.max(260, Math.min(380, Math.round(618 * (crashY - y) / (crashY - enterY))));
    const riseMs = Math.max(0, Math.min(60, impactMs - 330));
    triggerSave(laneIdx, { carSrc: src, startY: y, impactMs, riseMs });
    return true;
  };

  // ── death orchestration — dramatises the server's settled loss ──
  // The stage's own art (splat, wreck, gas) is untouched; the SOUND is not:
  // the cabinet celebrates wins and stays silent on a loss, so neither the
  // explosion nor the car crash is played any more.
  const runDeath = (atLane) => {
    const byGas = !!steamRef.current[atLane] && Math.random() < 0.6;
    setDeathType(byGas ? "steam" : "car");
    setHitLane(atLane); endedRef.current = true;
    clearTimeout(hitTimerRef.current);
    if (byGas) {
      setDead(true); setHit(true); setPlaying(false);     // instantaneous, and silent
      return 0;
    }
    setCarSrc(pickCar());
    setDead(true);                                        // mount car at top; chicken still standing
    hitTimerRef.current = setTimeout(() => { setHit(true); setPlaying(false); }, CAR_IMPACT_MS);
    return CAR_IMPACT_MS;
  };

  // ── advance one lane (GO button or tapping the glowing medallion) ──
  async function step(idx) {
    if (!playing || dead || cashed || busy || busyRef.current || saveLock || idx !== lane + 1 || !N) return;
    setBusy(true);
    sound.prime();
    // the hop launches AT THE TAP — the response only decides how it ends
    setHopKey((k) => k + 1);
    setLane(idx);
    // any car already in this lane floors it to clear before the chicken lands
    setRushLane(idx); later(() => setRushLane(0), 600);
    sound.hop();
    // the final lane auto-settles the win — hold the credits until we know,
    // and hand the release to the pay-out beat if it does
    holdCredits();
    let handoff = false;
    try {
      const data = await api("/api/games/chicken/step");
      if (!data) { setLane(idx - 1); setBusy(false); return; }
      if (data.status === "lost") {
        const settle = runDeath(idx);
        // the round only "ends" (buttons swap) at the exact strike frame
        later(() => setBusy(false), settle);
        return;
      }
      if (data.status === "cashed_out") {
        // crossed every lane — one more hop onto the far sidewalk, THEN it settles
        handoff = true;
        later(() => { setHopKey((k) => k + 1); setLane(N + 1); sound.hop(); }, 360);
        later(() => {
          endedRef.current = true;
          setCashed(true); setPlaying(false);
          setLastWin(data.payout);
          setWin({ payout: data.multiplier, profit: fmt(data.payout) });
          sound.coins(); sound.cluck();
          setBusy(false);
          releaseCredits();   // the pay-out popup is up — let the credits catch up
        }, 720);
        return;
      }
      // safe — server truth drives the CASH OUT sub-label
      if (data.potentialPayout != null) setPotential(data.potentialPayout);
      // now and then a car charges the lane and the bollards save the chicken
      if (idx < N && !saveRef.current && Math.random() < 0.18) triggerSave(idx);
      later(() => setBusy(false), STEP_LOCK_MS);
    } finally {
      if (!handoff) releaseCredits();
    }
  }

  // ── cash out ──
  async function cashout() {
    if (!playing || dead || cashed || busy || busyRef.current || lane < 1) return;
    setBusy(true);
    sound.prime();
    holdCredits();
    try {
      const data = await api("/api/games/chicken/cashout");
      setBusy(false);
      if (!data) return;
      endedRef.current = true;
      setCashed(true); setPlaying(false);
      setLastWin(data.payout);
      setWin({ payout: data.multiplier, profit: fmt(data.payout) });
      sound.coins(); sound.cluck();
      sfx.cash();
    } finally {
      // released on the same frame the pay-out popup and cash arpeggio land
      releaseCredits();
    }
  }

  // ── autobet: real rounds, the design's cadence ──
  const [autoTarget, setAutoTarget] = useState("3");
  const [autoBets, setAutoBets] = useState("0");
  const [autoRunning, setAutoRunning] = useState(false);
  const autoRef = useRef({ stop: true });
  const stopAuto = () => { autoRef.current.stop = true; setAutoRunning(false); };
  const startAuto = () => {
    if (autoRunning || playing || busy || busyRef.current) return;
    const bets = parseInt(autoBets) || 0;
    autoRef.current = { stop: false, bets, done: 0 };
    setAutoRunning(true);
    autoRound();
  };
  const autoRound = async () => {
    const s = autoRef.current;
    if (s.stop) { setAutoRunning(false); return; }
    if (s.bets > 0 && s.done >= s.bets) { setAutoRunning(false); return; }
    const started = await start();
    if (!started) { setAutoRunning(false); return; }
    const lanes = started.ladder.length;
    const target = Math.max(1, Math.min(lanes, parseInt(autoTargetRef.current) || 1));
    let cur = 0;
    const stepOnce = async () => {
      if (s.stop) { setAutoRunning(false); return; }
      const idx = cur + 1;
      setHopKey((k) => k + 1);
      setLane(idx);
      setRushLane(idx); later(() => setRushLane(0), 600);
      sound.hop();
      holdCredits();
      let handoff = false;
      try {
        const data = await api("/api/games/chicken/step");
        if (!data) { setLane(idx - 1); setAutoRunning(false); return; }
        cur = idx;
        if (data.status === "lost") {
          const settle = runDeath(idx);
          s.done++;
          later(autoRound, settle + 700);   // let the strike land, then a beat
          return;
        }
        if (data.status === "cashed_out") {
          handoff = true;
          later(() => { setHopKey((k) => k + 1); setLane(lanes + 1); sound.hop(); }, 360);
          later(() => {
            endedRef.current = true;
            setCashed(true); setPlaying(false);
            setLastWin(data.payout);
            setWin({ payout: data.multiplier, profit: fmt(data.payout) });
            sound.coins();
            s.done++;
            releaseCredits();   // the pay-out popup is up
            later(autoRound, 950);
          }, 720);
          return;
        }
        if (data.potentialPayout != null) setPotential(data.potentialPayout);
        if (idx >= target) {
          // reached the target lane — cash out for real
          later(async () => {
            holdCredits();
            try {
              const co = await api("/api/games/chicken/cashout");
              if (!co) { setAutoRunning(false); return; }
              endedRef.current = true;
              setCashed(true); setPlaying(false);
              setLastWin(co.payout);
              setWin({ payout: co.multiplier, profit: fmt(co.payout) });
              sound.coins();
              s.done++;
              later(autoRound, 950);
            } finally {
              releaseCredits();
            }
          }, 300);
          return;
        }
        later(stepOnce, 520);
      } finally {
        if (!handoff) releaseCredits();
      }
    };
    later(stepOnce, 420);
  };
  const autoTargetRef = useRef(autoTarget);
  autoTargetRef.current = autoTarget;
  useEffect(() => () => { autoRef.current.stop = true; }, []);

  function pickDifficulty(d) {
    if (locked || d === difficulty) return;
    setDifficulty(d);
    setLadder(buildMults(d));
    setLane(0);
    sfx.click();
  }

  // changing difficulty / amount mid-round isn't allowed
  const locked = playing || autoRunning || busy;
  const atEnd = lane >= N;

  // ── space chrome derived values ───────────────────────────────────────────
  const live = playing && !dead && !cashed;
  const chip = dead || hit
    ? { label: "NO WIN", color: T.text2 }
    : cashed && win
      ? { label: "WIN " + fmtMKD(lastWin), color: T.win }
      : live
        ? { label: "× " + curMult.toFixed(2), color: T.gold }
        : { label: "READY", color: T.text2 };

  // readout line above the stage — server errors take it over, in red
  let readText = "", readColor = T.muted, readGlow = "rgba(0,0,0,0)", readOpacity = 1, readSize = 24;
  if (error) { readText = error.toUpperCase(); readColor = "#ff6a5a"; readGlow = "rgba(255,90,74,.55)"; }
  else if (dead || hit) { readText = "ROUND OVER"; readColor = T.text2; readSize = 28; }
  else if (cashed && win) { readText = "WIN +" + fmtMKD(lastWin); readColor = T.win; readGlow = "rgba(46,230,166,.5)"; readSize = 30; }
  else if (live) { readText = "×" + curMult.toFixed(2); readColor = T.gold; readGlow = "rgba(240,217,154,.5)"; readSize = 30; }
  else { readText = "PRESS BET TO START"; readOpacity = 0.8; }

  const cashSub = lane >= 1 ? fmtMKD(potential > 0 ? potential : winNow) : "CROSS 1 LANE";

  // bottom-bar actions — the old game's buttons in the mines dual-primary idiom
  let actions;
  if (mode === "Auto") {
    actions = (
      <GoldButton label={autoRunning ? "STOP AUTOBET" : "START AUTOBET"} onClick={autoRunning ? stopAuto : startAuto}
        disabled={!autoRunning && (playing || busy || balance < 50)}
        labelSize="clamp(18px, 1.9vw, 28px)" style={{ flex: "none", minWidth: "clamp(210px, 26vw, 360px)", borderRadius: 22 }} />
    );
  } else if (!playing) {
    actions = (
      <GoldButton label="BET" sub={fmtMKD(Math.min(bet, MAX_BET, Math.max(50, Math.floor(balance) || 50)))} onClick={start} disabled={balance < 50}
        labelSize="clamp(21px, 2.2vw, 32px)" style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 }} />
    );
  } else {
    actions = (
      <>
        <GoldButton label="CASH OUT" sub={cashSub} onClick={cashout} disabled={busy || dead || lane < 1}
          labelSize="clamp(18px, 1.8vw, 27px)" style={{ flex: "none", minWidth: "clamp(170px, 18vw, 280px)", borderRadius: 22 }} />
        <GoldButton label={atEnd ? "FINISHED" : "GO"} sub={!atEnd ? "NEXT ×" + nextMult.toFixed(2) : ""} onClick={() => step(lane + 1)}
          disabled={busy || dead || saveLock || atEnd}
          labelSize="clamp(24px, 2.5vw, 36px)" style={{ flex: "none", minWidth: "clamp(180px, 20vw, 300px)", borderRadius: 22 }} />
      </>
    );
  }

  return (
    <SpaceRoot>

      <SpaceHeader title="CHICKEN CROSS" chip={chip} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", gap: 0 }}>

        {/* ── left control panel ── */}
        <SpaceSidebar>
          <SoundButton />
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 2vh, 16px)", opacity: locked ? 0.4 : 1, pointerEvents: locked ? "none" : "auto", transition: "opacity .2s ease" }}>
            {/* Manual / Auto */}
            <div style={{ display: "flex", gap: 10 }}>
              {["Manual", "Auto"].map((m) => (
                <button key={m} onClick={() => { if (!locked && m !== mode) { setMode(m); sfx.click(); } }}
                  style={pillStyle(mode === m, { flex: 1, minHeight: "clamp(40px, 7vh, 56px)", fontSize: "clamp(13px, 2.2vh, 17px)", letterSpacing: 2 })}>
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
            <BetStepper bet={bet} setBet={setBet} disabled={locked} maxBet={MAX_BET} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SectionLabel>DIFFICULTY</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {DIFF_KEYS.map((d) => (
                  <button key={d} onClick={() => pickDifficulty(d)}
                    style={pillStyle(difficulty === d, { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minHeight: "clamp(44px, 7.6vh, 64px)", padding: "4px 2px", fontSize: "clamp(12px, 2vh, 16px)", letterSpacing: 1 })}>
                    <span>{DIFFS[d].label}</span>
                    <span style={{ fontSize: "clamp(9px, 1.5vh, 12px)", letterSpacing: 1, opacity: 0.7 }}>{DIFFS[d].lanes} LANES · {Math.round(DIFFS[d].death * 100)}%</span>
                  </button>
                ))}
              </div>
            </div>
            {mode === "Auto" && (
              <div style={{ display: "flex", gap: 10, opacity: autoRunning ? 0.5 : 1, pointerEvents: autoRunning ? "none" : "auto" }}>
                {[{ label: "LANE", value: autoTarget, set: setAutoTarget }, { label: "ROUNDS (∞)", value: autoBets, set: setAutoBets }].map((f) => (
                  <label key={f.label} style={tileStyle({ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, minHeight: "clamp(46px, 8vh, 64px)", padding: "4px 12px", cursor: "text" })}>
                    <span style={{ fontSize: 11, letterSpacing: 2, color: T.muted, fontWeight: 700 }}>{f.label}</span>
                    <input className="chs-num" value={f.value} inputMode="numeric"
                      onChange={(e) => f.set(e.target.value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, ""))}
                      style={{ width: "100%", background: "transparent", border: "none", outline: "none", color: T.gold, fontWeight: 700, fontSize: "clamp(15px, 2.4vh, 20px)", padding: 0, fontFamily: "'DM Sans', Helvetica, sans-serif" }} />
                  </label>
                ))}
              </div>
            )}
          </div>
        </SpaceSidebar>

        {/* ── stage column ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* readout */}
          <div style={{ position: "relative", zIndex: 4, height: 42, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ opacity: readOpacity, fontSize: readSize, fontWeight: 700, letterSpacing: 3, color: readColor, textShadow: `0 0 28px ${readGlow}`, transition: "opacity .25s ease" }}>{readText}</div>
          </div>

          {/* the ORIGINAL road stage, floating in space as a rounded game panel */}
          <div style={{ position: "relative", zIndex: 4, flex: 1, minHeight: 140, margin: "2px 24px 10px 10px", borderRadius: 24, border: `2px solid ${T.panelBorder}`, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 26px 70px rgba(0,0,0,.55)" }}>
            <ChickenStage
              mults={N ? ladder : []} lane={lane} playing={playing} dead={dead} hit={hit} cashed={cashed}
              hitLane={hitLane} carSrc={carSrc} deathType={deathType} hopKey={hopKey} startKey={startKey}
              win={win} rushLane={rushLane} steamLanes={steamLanes} save={save}
              onStep={(i) => step(i)} onCharge={chargeSave} mobileUI={false}
            />
          </div>

          {/* ── bottom bar ── */}
          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", gap: "clamp(8px, 1vw, 14px)", margin: "0 clamp(10px, 1.6vw, 24px) 20px 10px" }}>
            <button onClick={() => { sfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 30px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>LOBBY
            </button>
            <button onClick={() => { sfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={{ flex: "none", width: "clamp(56px, 11vh, 88px)", minHeight: "clamp(56px, 11vh, 88px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" /></svg>
            </button>
            <div style={{ flex: 1 }} />
            {actions}
          </div>

        </div>
      </div>

      {rules && <RulesModal onClose={() => setRules(false)} />}
    </SpaceRoot>
  );
}
