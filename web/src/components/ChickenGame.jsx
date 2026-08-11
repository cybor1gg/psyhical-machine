// Chicken Cross — the "brain", running the original Claude Design app flow
// (MintBets Design System ChickenGame.jsx) against our provably-fair server.
// CLIMB family: every lane is committed at bet time server-side; each Go is
// one POST that reveals safe/deadly for the lane the chicken just hopped into.
// The design's theatre is preserved exactly — hop-at-the-tap, cars that rush
// out of the way, bollard saves, gas lanes, the killer car whose thud lands
// at the moment of impact — but every OUTCOME comes from the server response;
// the theatre only ever dramatises what the ledger already settled.
import { useState, useEffect, useRef } from "react";
import { apiGet, apiPost } from "../api";
import { sound } from "../lib/sound";
import { reportBalance, reportStakeDebit, reportRoundEnd } from "../lib/operatorBridge";
import { GameBottombar } from "./mint/GameChrome";
import { useStableViewportHeight } from "./mint/FitBox";
import { useHiloMobile } from "./mint/HiloVisuals";
import { BetAmountInput, ActionButton, StatField, SelectField } from "./mint/BetPanelLite";
import { ChickenStage, pickCar, CARS, CAR_IMPACT_MS, preloadChickenArt } from "./mint/ChickenVisuals";

const DIFF_OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "daredevil", label: "Daredevil" },
];
// Display math for the idle road (the design always shows the full ladder).
// Mirrors the server's pricing at the platform default edge; the response's
// real ladder replaces it the moment a round starts, so an operator RTP
// override always shows true numbers on live money.
const DIFFS = {
  easy: { lanes: 24, death: 0.05 },
  medium: { lanes: 22, death: 0.12 },
  hard: { lanes: 18, death: 0.24 },
  daredevil: { lanes: 13, death: 0.45 },
};
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

export default function ChickenGame({ initialBalance } = {}) {
  const [amount, setAmount] = useState("1.00");
  const [balance, setBalance] = useState(typeof initialBalance === "number" ? initialBalance : null);
  const maxBet = () => { if (typeof balance === "number" && Number.isFinite(balance)) setAmount(balance.toFixed(2)); };
  const [mode, setMode] = useState("Manual");
  const [difficulty, setDifficulty] = useState("medium");
  const [lane, setLane] = useState(0);
  const [ladder, setLadder] = useState(() => buildMults("medium")); // display ladder; server's replaces it at start
  const [playing, setPlaying] = useState(false);
  const [dead, setDead] = useState(false);
  const [hit, setHit] = useState(false);             // chicken actually struck (splat + red manhole + shake)
  const [cashed, setCashed] = useState(false);
  const [hitLane, setHitLane] = useState(0);
  const [carSrc, setCarSrc] = useState(CARS[0]);
  const [deathType, setDeathType] = useState("car");
  const [hopKey, setHopKey] = useState(0);
  const [startKey, setStartKey] = useState(0);
  const [win, setWin] = useState(null);              // {payout, profit} → centered cash-out popup
  const [busy, setBusy] = useState(false);
  const [rushLane, setRushLane] = useState(0);       // lane the chicken just hopped into → cars there floor it
  const [save, setSave] = useState(null);            // bollard near-miss {lane, key, carSrc, startY, impactMs, riseMs}
  const [saveLock, setSaveLock] = useState(false);
  const [steamLanes, setSteamLanes] = useState([]);  // cosmetic: which lanes leak green gas this round
  const [error, setError] = useState("");
  const mobile = useHiloMobile();
  const vh = useStableViewportHeight();

  const timers = useRef([]);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => clearTimers(), []);
  const hitTimerRef = useRef(null);
  const saveTimers = useRef([]);
  const saveRef = useRef(null);
  saveRef.current = save;
  const endedRef = useRef(false);      // previous round ended → next start hops out of the train
  const steamRef = useRef([]);
  const deadRef = useRef(false);
  deadRef.current = dead;

  const bet = parseFloat(amount) || 0;
  const N = ladder.length;
  const curMult = lane >= 1 && N ? ladder[Math.min(lane, N) - 1] : 1;
  const nextMult = N && lane < N ? ladder[lane] : curMult;
  const winNow = bet * curMult;

  // only a few rare lanes per round leak green gas — pure theatre; deadliness
  // is the server's call, this only picks HOW a death on that lane looks
  const genSteam = (n) => { const a = []; for (let i = 1; i <= n; i++) a[i] = Math.random() < 0.2; return a; };

  useEffect(() => { preloadChickenArt(); }, []);

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
      if (data.betAmount != null) setAmount(Number(data.betAmount).toFixed(2));
      const sl = genSteam((data.ladder || []).length); steamRef.current = sl; setSteamLanes(sl);
      setPlaying(true);
    });
  }, []);

  async function api(path, body) {
    const { ok, data } = await apiPost(path, body);
    if (!ok) { setError(data.error || "Something went wrong"); return null; }
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
    if (playing || busy) return;
    if (typeof balance === "number" && Number.isFinite(balance) && bet > balance + 1e-9) { setError("Insufficient balance"); return; }
    sound.prime();
    setError("");
    resetRound();
    setLane(0);
    sound.walk(); // the pedestrian signal turns mint — the chicken has right of way
    // a fresh chicken hops out of the train door when the last one is gone
    if (endedRef.current) { setStartKey((k) => k + 1); endedRef.current = false; }
    reportStakeDebit(bet); // stake leaves the operator wallet at the tap
    setPlaying(true);
    const data = await api("/api/games/chicken/start", { betAmount: bet, difficulty });
    if (!data) { setPlaying(false); return; }
    if (typeof data.balance === "number") setBalance(data.balance);
    reportBalance(data.balance, null, "stake"); // server truth; the crossing is still in flight
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
    const T = saveTimers.current;
    T.push(setTimeout(() => sound.bollardUp(), riseMs));
    T.push(setTimeout(() => sound.bollardCrash(), impactMs));
    T.push(setTimeout(() => setSaveLock(false), STEP_LOCK_MS));   // fixed unlock — same beat as a plain hop
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
  // `dead` starts the theatre immediately (killer car mounts off-screen and
  // begins its run; chicken stands its ground); `hit` fires only when the car
  // (or gas) actually reaches the chicken — splat, red manhole, shake and the
  // impact thud all land together. Returns ms until that strike.
  const runDeath = (atLane) => {
    const byGas = !!steamRef.current[atLane] && Math.random() < 0.6;
    setDeathType(byGas ? "steam" : "car");
    setHitLane(atLane); endedRef.current = true;
    clearTimeout(hitTimerRef.current);
    if (byGas) {
      setDead(true); setHit(true); setPlaying(false);     // explosion is instantaneous
      sound.explode();
      return 0;
    }
    setCarSrc(pickCar());
    setDead(true);                                        // mount car at top; chicken still standing
    sound.carCrash(CAR_IMPACT_MS / 1000);                 // engine nears, thud lands at impact
    hitTimerRef.current = setTimeout(() => { setHit(true); setPlaying(false); }, CAR_IMPACT_MS);
    return CAR_IMPACT_MS;
  };

  // ── advance one lane (Go button or tapping the glowing medallion) ──
  async function step(idx) {
    if (!playing || dead || cashed || busy || saveLock || idx !== lane + 1 || !N) return;
    setBusy(true);
    sound.prime();
    // the hop launches AT THE TAP — the response only decides how it ends
    setHopKey((k) => k + 1);
    setLane(idx);
    // any car already in this lane floors it to clear before the chicken lands
    setRushLane(idx); later(() => setRushLane(0), 600);
    sound.hop();
    const data = await api("/api/games/chicken/step");
    if (!data) { setLane(idx - 1); setBusy(false); return; }
    if (data.status === "lost") {
      if (typeof data.balance === "number") setBalance(data.balance);
      const settle = runDeath(idx);
      // the round only "ends" (buttons swap, host told) at the exact strike frame
      later(() => { reportRoundEnd(data.balance); setBusy(false); }, settle);
      return;
    }
    if (data.status === "cashed_out") {
      // crossed every lane — one more hop onto the far sidewalk, THEN it settles
      later(() => { setHopKey((k) => k + 1); setLane(N + 1); sound.hop(); }, 360);
      later(() => {
        endedRef.current = true;
        if (typeof data.balance === "number") setBalance(data.balance);
        reportRoundEnd(data.balance);
        setCashed(true); setPlaying(false);
        setWin({ payout: data.multiplier, profit: fmt(data.payout) });
        sound.coins(); sound.cluck();
        setBusy(false);
      }, 720);
      return;
    }
    // safe — now and then a car charges the lane and the bollards save the chicken
    if (idx < N && !saveRef.current && Math.random() < 0.18) triggerSave(idx);
    later(() => setBusy(false), STEP_LOCK_MS);
  }

  // ── cash out ──
  async function cashout() {
    if (!playing || dead || cashed || busy || lane < 1) return;
    setBusy(true);
    sound.prime();
    const data = await api("/api/games/chicken/cashout");
    setBusy(false);
    if (!data) return;
    endedRef.current = true;
    if (typeof data.balance === "number") setBalance(data.balance);
    reportRoundEnd(data.balance); // operator wallet moves with the cash-out
    setCashed(true); setPlaying(false);
    setWin({ payout: data.multiplier, profit: fmt(data.payout) });
    sound.coins(); sound.cluck();
  }

  // ── autobet: real rounds, the design's cadence ──
  const [autoTarget, setAutoTarget] = useState("3");
  const [autoBets, setAutoBets] = useState("0");
  const [autoRunning, setAutoRunning] = useState(false);
  const autoRef = useRef({ stop: true });
  const stopAuto = () => { autoRef.current.stop = true; setAutoRunning(false); };
  const startAuto = () => {
    if (autoRunning || playing || busy) return;
    const bets = parseInt(autoBets) || 0;
    autoRef.current = { stop: false, bets, done: 0 };
    setAutoRunning(true);
    autoRound();
  };
  const autoRound = async () => {
    const s = autoRef.current;
    if (s.stop) { setAutoRunning(false); return; }
    if (s.bets > 0 && s.done >= s.bets) { setAutoRunning(false); return; }
    if (typeof balance === "number" && Number.isFinite(balance) && bet > balance + 1e-9) { setError("Insufficient balance"); setAutoRunning(false); return; }
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
      const data = await api("/api/games/chicken/step");
      if (!data) { setLane(idx - 1); setAutoRunning(false); return; }
      cur = idx;
      if (data.status === "lost") {
        if (typeof data.balance === "number") setBalance(data.balance);
        const settle = runDeath(idx);
        later(() => reportRoundEnd(data.balance), settle);
        s.done++;
        later(autoRound, settle + 700);   // let the strike land, then a beat
        return;
      }
      if (data.status === "cashed_out") {
        later(() => { setHopKey((k) => k + 1); setLane(lanes + 1); sound.hop(); }, 360);
        later(() => {
          endedRef.current = true;
          if (typeof data.balance === "number") setBalance(data.balance);
          reportRoundEnd(data.balance);
          setCashed(true); setPlaying(false);
          setWin({ payout: data.multiplier, profit: fmt(data.payout) });
          sound.coins();
          s.done++;
          later(autoRound, 950);
        }, 720);
        return;
      }
      if (idx >= target) {
        // reached the target lane — cash out for real
        later(async () => {
          const co = await api("/api/games/chicken/cashout");
          if (!co) { setAutoRunning(false); return; }
          endedRef.current = true;
          if (typeof co.balance === "number") setBalance(co.balance);
          reportRoundEnd(co.balance);
          setCashed(true); setPlaying(false);
          setWin({ payout: co.multiplier, profit: fmt(co.payout) });
          sound.coins();
          s.done++;
          later(autoRound, 950);
        }, 300);
        return;
      }
      later(stepOnce, 520);
    };
    later(stepOnce, 420);
  };
  const autoTargetRef = useRef(autoTarget);
  autoTargetRef.current = autoTarget;
  useEffect(() => () => { autoRef.current.stop = true; }, []);

  // changing difficulty / amount mid-round isn't allowed
  const locked = playing || autoRunning || busy;
  const canStep = playing && !dead && !cashed && lane < N;

  const bottombar = <GameBottombar game="chicken" />;

  // ── controls (design panel, our components) ──
  const segmented = (
    <div style={{ display: "flex", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 3, gap: 3, opacity: autoRunning ? 0.6 : 1 }}>
      {["Manual", "Auto"].map((m) => (
        <button key={m} onClick={() => { if (!locked) setMode(m); }} style={{
          flex: 1, height: 32, borderRadius: "calc(var(--r-md) - 3px)", border: "none",
          background: mode === m ? "var(--ink)" : "transparent",
          color: mode === m ? "var(--text)" : "var(--text-muted)",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12.5,
          cursor: locked ? "default" : "pointer", transition: "background var(--dur-fast), color var(--dur-fast)",
        }}>{m}</button>
      ))}
    </div>
  );

  const riskPicker = (
    <SelectField label="Risk" value={difficulty} disabled={locked}
      onChange={(d) => { if (!locked) { setDifficulty(d); setLadder(buildMults(d)); setLane(0); } }}
      options={DIFF_OPTIONS} />
  );

  const readout = (
    <div style={{ display: "flex", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}><StatField label="Current" value={curMult.toFixed(2) + "×"} tone="mint" /></div>
      <div style={{ flex: 1, minWidth: 0 }}><StatField label={lane >= 1 ? "Profit" : "Next"} value={lane >= 1 ? "$" + fmt(winNow) : nextMult.toFixed(2) + "×"} /></div>
    </div>
  );

  const autoFields = (
    <div style={{ display: "flex", gap: 8 }}>
      {[{ label: "Lane", value: autoTarget, set: setAutoTarget }, { label: "Bets (∞)", value: autoBets, set: setAutoBets }].map((f) => (
        <div key={f.label} style={{ flex: 1, height: 40, borderRadius: "var(--r-md)", background: "var(--surface-raised)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 10px", lineHeight: 1.1, opacity: autoRunning ? 0.5 : 1, pointerEvents: autoRunning ? "none" : "auto" }}>
          <span style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{f.label}</span>
          <input value={f.value} inputMode="numeric"
            onChange={(e) => f.set(e.target.value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, ""))}
            style={{ width: "100%", background: "transparent", border: "none", outline: "none", color: "var(--text)", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 14, padding: 0 }} />
        </div>
      ))}
    </div>
  );

  let action;
  if (mode === "Auto") {
    action = <ActionButton label={autoRunning ? "Stop Autobet" : "Start Autobet"} tone={autoRunning ? "gold" : "primary"} onClick={autoRunning ? stopAuto : startAuto} small />;
  } else if (!playing) {
    action = <ActionButton label="Place Bet" tone="primary" onClick={start} small />;
  } else {
    const atEnd = lane >= N;
    action = (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <ActionButton label={atEnd ? "Finished" : "Go"} tone="primary" onClick={() => step(lane + 1)} disabled={busy || saveLock || atEnd} small />
        <ActionButton label={lane < 1 ? "Cash Out" : "Cash Out  $" + fmt(winNow)} tone="gold" onClick={cashout} disabled={busy || lane < 1} small />
      </div>
    );
  }

  const stage = (
    <ChickenStage
      mults={N ? ladder : []} lane={lane} playing={playing} dead={dead} hit={hit} cashed={cashed}
      hitLane={hitLane} carSrc={carSrc} deathType={deathType} hopKey={hopKey} startKey={startKey}
      win={win} rushLane={rushLane} steamLanes={steamLanes} save={save}
      onStep={(i) => step(i)} onCharge={chargeSave} mobileUI={mobile}
    />
  );

  const errorBanner = error && (
    <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-caption)", fontWeight: 600 }}>{error}</div>
  );

  // ── MOBILE: bigger road on top (64vh, min 400) for a more immersive scene,
  // action first in the sheet directly beneath it so Bet/Go/Cash Out stay in
  // the first viewport, then bet, then risk; page scrolls; bottombar last ──
  if (mobile) {
    return (
      <div style={{ minHeight: vh, display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
        <div style={{ flex: "0 0 auto", height: "64vh", minHeight: 400, display: "flex", flexDirection: "column" }}>
          {stage}
        </div>
        <div style={{ flex: "1 1 auto", padding: "12px 14px 18px", display: "flex", flexDirection: "column", gap: 10, background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
          {errorBanner}
          {mode === "Manual" && playing && readout}
          {action}
          {segmented}
          <div style={{ opacity: locked ? 0.5 : 1, pointerEvents: locked ? "none" : "auto" }}>
            <BetAmountInput value={amount} onChange={setAmount} disabled={locked}
              onHalf={() => setAmount(String(Math.max(0, bet / 2).toFixed(2)))}
              onDouble={() => setAmount(String((bet * 2).toFixed(2)))}
              onMax={maxBet} label="Bet Amount" small />
          </div>
          {riskPicker}
          {mode === "Auto" && autoFields}
        </div>
        {bottombar}
      </div>
    );
  }

  // ── DESKTOP: panel left, road canvas right ──
  return (
    <div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 14, padding: 14, boxSizing: "border-box", alignItems: "stretch" }}>
        <div style={{ flex: "0 0 var(--betpanel-w)", width: "var(--betpanel-w)", display: "flex", flexDirection: "column", gap: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", padding: 14, boxSizing: "border-box", overflowY: "auto" }}>
          {segmented}
          <div style={{ opacity: locked ? 0.5 : 1, pointerEvents: locked ? "none" : "auto" }}>
            <BetAmountInput value={amount} onChange={setAmount} disabled={locked}
              onHalf={() => setAmount(String(Math.max(0, bet / 2).toFixed(2)))}
              onDouble={() => setAmount(String((bet * 2).toFixed(2)))}
              onMax={maxBet} label="Bet Amount" />
          </div>
          {riskPicker}
          {mode === "Auto" && autoFields}
          {errorBanner}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: "auto" }}>
            {mode === "Manual" && playing && readout}
            {action}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", overflow: "hidden" }}>
          {stage}
        </div>
      </div>
      {bottombar}
    </div>
  );
}
