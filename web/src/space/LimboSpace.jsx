// LIMBO — "ROCKET ASCENT" space-theme cabinet screen, designed in the
// established space visual language (Mines is the structural reference:
// shared shell, sidebar config with lock-dimming, readout line, bottom bar
// LOBBY / INFO / primary, rules modal, ambient startup).
//
// The round is SERVER-authoritative and INSTANT: one POST
// /api/games/limbo/start { betAmount, target } debits, rolls and settles —
// the response carries result / target / won / winChance / payout / balance
// (+ roundId, nonce). Everything on screen after that is choreography: the
// huge multiplier counts up in log-space toward the server's result while a
// gold rocket rides the thrust line; crossing the target flips it green
// (ring burst + win chord, rocket exits with a gold trail). Falling short is
// deliberately quiet: no sound, no red — the flame simply goes out and the
// rocket drops away off the bottom of the board.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api";
import { useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import SpaceBackground from "./SpaceBackground";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar, SectionLabel,
  GoldButton, SoundButton, BetStepper, tileStyle, pillStyle, T,
} from "./Shell";
import { beep, whoosh, sfx, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import "./space.css";
import "./limbo.css";

const MAX_BET = 500;          // platform max bet (МКД, steps of 50)
const MIN_TARGET = 1.01;      // server's parseTarget floor
const MAX_TARGET = 1000;      // UI clamp; the server enforces its own cap
const QUICK = [1.5, 2, 5, 10];

// Limbo-specific sfx composed from the shared engine primitives.
const lbSfx = {
  // ignition: rising noise whoosh + low sawtooth thrust + a bright lift tone
  launch() { whoosh(160, 1900, 0.13, 0.55); beep("sawtooth", 80, 260, 0.13, 0.42); beep("triangle", 300, 760, 0.09, 0.3, 0.06); },
  // (a bust makes no sound at all — the cabinet never scores a loss)
  // win chord at the target-cross moment
  chord() { sfx.cash(); },
  // altitude tick — pitch rises with the climb (0..1)
  tick(k) { beep("triangle", 1100 + k * 1500, 0, 0.035, 0.05); },
  bet: sfx.bet,
  click: sfx.click,
};

// Small gold rocket (~60px tall on screen), fins + porthole, gold gradient.
function RocketSVG() {
  return (
    <svg viewBox="0 0 44 70" style={{ width: "100%", height: "100%", display: "block", filter: "drop-shadow(0 0 12px rgba(240,217,154,.35))" }}>
      <defs>
        <linearGradient id="lbBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6ecc9" />
          <stop offset=".55" stopColor="#d9b26a" />
          <stop offset="1" stopColor="#a9843e" />
        </linearGradient>
      </defs>
      <path d="M11 34 L2 53 L11 46 Z" fill="#a9843e" stroke="#7a5e2c" strokeWidth="1" />
      <path d="M33 34 L42 53 L33 46 Z" fill="#a9843e" stroke="#7a5e2c" strokeWidth="1" />
      <path d="M22 2 C30 12 33 24 33 40 L11 40 C11 24 14 12 22 2 Z" fill="url(#lbBody)" stroke="#f6f1e6" strokeWidth="1.4" />
      <circle cx="22" cy="24" r="5.4" fill="#0d1626" stroke="#f6f1e6" strokeWidth="1.6" />
      <rect x="16" y="40" width="12" height="6" rx="2" fill="#7a5e2c" />
    </svg>
  );
}

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
          {row("▲", T.gold, "Set a target multiplier and launch — the rocket flies to a random multiplier.")}
          {row("◆", T.win, "If the result reaches your target, you win bet × target.")}
          {row("●", T.text2, "If it falls short, the flame goes out and the bet is lost.")}
          {row("✦", T.gold, "Win chance ≈ 99% ÷ target — RTP is 99% at every target.")}
        </div>
        <button onClick={onClose} style={{ width: "100%", padding: 16, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}

export default function LimboSpace() {
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  // phase: idle → flying (POST + count-up) → over (win|lose) → idle on LAUNCH
  const [phase, setPhase] = useState("idle");
  const [bet, setBet] = useState(100);
  const [target, setTarget] = useState(2);
  const [disp, setDisp] = useState(1);            // the big counting number
  const [tone, setTone] = useState("base");       // base | win | lose
  const [rocketMode, setRocketMode] = useState("idle"); // idle|flying|exit|dead
  const [lnTop, setLnTop] = useState(null);       // log visual scale of the flight
  const [outcome, setOutcome] = useState(null);   // 'win' | 'lose'
  const [lastWin, setLastWin] = useState(0);      // server payout
  const [lastRound, setLastRound] = useState(null);
  const [rolls, setRolls] = useState([]);         // last 6 results (pills)
  const [rings, setRings] = useState([]);         // target-cross ring bursts
  const [payoutFactor, setPayoutFactor] = useState(0.99); // corrected from server winChance × target
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");

  const numRef = useRef(null);
  const rocketRef = useRef(null);
  // The climb used to setDisp() every frame, re-rendering the entire screen
  // 60x a second. The number and the rocket are now written straight to the
  // DOM and this ref carries the live value into any render that does happen.
  const dispRef = useRef(1);
  const timers = useRef([]);
  const rafRef = useRef(0);
  const busyRef = useRef(false);      // one request/flight at a time
  const crossedRef = useRef(false);
  const lastTickRef = useRef(0);
  const bid = useRef(0);

  // ── suspense: the credits stay frozen until the count-up stops ────────────
  const heldRef = useRef(false);
  const holdCredits = () => { if (!heldRef.current) { heldRef.current = true; holdBalance(); } };
  const releaseCredits = () => { if (heldRef.current) { heldRef.current = false; releaseBalance(); } };

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    cancelAnimationFrame(rafRef.current);
    releaseCredits(); // unmounted mid-flight — never strand the hold
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── mount: ambience (instant game — never a live round to resume) ─────────
  useEffect(() => {
    armAmbientOnGesture();
    startAmbient();
  }, []);

  // ── target controls ───────────────────────────────────────────────────────
  const clampTarget = (n) => Math.min(MAX_TARGET, Math.max(MIN_TARGET, +(+n).toFixed(2)));
  const stepTarget = (d) => {
    lbSfx.click();
    setLnTop(null); // target moved — the altitude line returns to its idle spot
    setTarget((t) => clampTarget(t + d * (d > 0 ? (t >= 5 ? 1 : 0.1) : (t > 5 ? 1 : 0.1))));
  };
  const quickTarget = (v) => { lbSfx.click(); setLnTop(null); setTarget(clampTarget(v)); };

  // same altitude mapping the render uses, hoisted for the rAF writer
  const yPctOf = (v) => { const f = lnTop ? Math.log(Math.max(1, v)) / lnTop : 0; return 8 + 58 * Math.min(1.05, Math.max(0, f)); };

  // ── choreography helpers ──────────────────────────────────────────────────
  const popNum = () => {
    const el = numRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = "scale(1.18)";
    requestAnimationFrame(() => { el.style.transition = "transform .34s cubic-bezier(.2,1.5,.4,1)"; el.style.transform = "scale(1)"; });
  };

  const burstRing = () => {
    const id = ++bid.current;
    const sparks = Array.from({ length: 8 }, (_, k) => ({ rot: Math.round(k * 45 + Math.random() * 30) + "deg", sc: (0.7 + Math.random() * 0.8).toFixed(2) }));
    setRings((rs) => rs.concat({ id, sparks }));
    later(() => setRings((rs) => rs.filter((x) => x.id !== id)), 900);
  };

  // the target moment: number flips green, ring burst, chord, rocket exits
  const onCross = () => {
    if (crossedRef.current) return;
    crossedRef.current = true;
    setTone("win");
    setRocketMode("exit");
    burstRing();
    popNum();
    lbSfx.chord();
  };

  // ── the flight: count 1.00× → result in log space (eased) ─────────────────
  function fly(data) {
    const result = Math.max(1, data.result);
    const lnR = Math.max(Math.log(result), 1e-6);
    // visual scale: 1.00 at the pad, max(result, target)×1.18 near the top —
    // rocket altitude and the target line share it, so the rocket meets the
    // gold line exactly when the number reads the target.
    setLnTop(Math.log(Math.max(result, data.target) * 1.18));
    // ~900ms for small numbers, log-paced longer for big ones
    const dur = Math.min(2400, Math.max(750, 900 + 380 * Math.max(0, Math.log10(result))));
    const t0 = performance.now();
    crossedRef.current = false;
    dispRef.current = 1;
    setDisp(1);
    setTone("base");
    setRocketMode("flying");
    setRings([]);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic — races up, settles in
      const val = Math.min(result, Math.exp(e * lnR));
      dispRef.current = val;
      // write the existing text node in place — textContent would swap in a NEW
      // node and leave React patching a detached one
      const tn = numRef.current && numRef.current.firstChild;
      if (tn && tn.nodeType === 3) tn.nodeValue = val.toFixed(2) + "×";
      if (rocketRef.current) rocketRef.current.style.bottom = yPctOf(val) + "%";
      if (data.won && !crossedRef.current && val >= data.target - 1e-9) onCross();
      if (p < 1 && result > 1.005 && now - lastTickRef.current > 90) { lastTickRef.current = now; lbSfx.tick(e); }
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else finish(data);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  function finish(data) {
    dispRef.current = data.result;
    setDisp(data.result);
    releaseCredits(); // the reveal: the number has stopped, credits may move
    if (data.won) {
      if (!crossedRef.current) onCross(); // safety: cross fires at latest here
    } else {
      setTone("lose");
      setRocketMode("fall"); // flame out, rocket tumbles away below the board
    }
    setOutcome(data.won ? "win" : "lose");
    setLastWin(data.payout);
    setLastRound(data);
    setRolls((prev) => [{ n: data.result, won: data.won, id: data.roundId }, ...prev].slice(0, 6));
    setPhase("over");
    busyRef.current = false;
  }

  // ── server round flow — one POST settles everything ───────────────────────
  async function launch() {
    if (phase === "flying" || busyRef.current) return;
    if (balance < 50) return;
    const stake = Math.min(bet, MAX_BET, Math.floor(balance));
    busyRef.current = true;
    setError("");
    setPhase("flying");
    lbSfx.bet();
    lbSfx.launch();
    holdCredits(); // freeze the readout before the stake is debited
    let flew = false;
    try {
      const { ok, data } = await apiPost("/api/games/limbo/start", { betAmount: stake, target });
      if (!ok) {
        busyRef.current = false;
        setPhase(lastRound ? "over" : "idle");
        setRocketMode(lastRound ? rocketMode : "idle");
        setError(data?.error || "Something went wrong");
        return;
      }
      setBet(stake);
      // display math corrected from the server like the old client: the house
      // factor is winChance × target (≈ 0.99), used for the WIN CHANCE tile
      if (typeof data.winChance === "number") setPayoutFactor(Math.round(data.winChance * data.target * 10000) / 10000);
      fly(data); // balance is staged in balanceStore until finish() releases
      flew = true;
    } finally {
      // any path that never reaches finish() must give the hold back
      if (!flew) releaseCredits();
    }
  }

  // ── derived render values ─────────────────────────────────────────────────
  const lock = phase === "flying";
  const over = phase === "over";

  // altitude mapping (bottom %): pad at 8%, top of the scale at 66%
  const yPct = (frac) => 8 + 58 * Math.min(1.05, Math.max(0, frac));
  // mid-flight React still renders occasionally (ring bursts, tone changes) —
  // read the live value so those renders never snap the number back
  const shownVal = phase === "flying" ? dispRef.current : disp;
  const rocketY = lnTop ? yPct(Math.log(Math.max(1, shownVal)) / lnTop) : yPct(0);
  const targetY = lnTop ? yPct(Math.log(target) / lnTop) : yPct(0.85);

  // big number tone — a win glows green, everything else stays neutral
  const numColor = tone === "win" ? T.win : tone === "lose" ? T.text2 : "#e9eef7";
  const numGlow = tone === "win" ? "rgba(58,224,161,.55)" : "rgba(141,160,190,.28)";

  // stats (display math — server remains the authority)
  const winChancePct = Math.min(1, payoutFactor / target) * 100;
  const profit = Math.floor((bet * target - bet) * 100) / 100;

  // readout line — server errors take it over, in red
  let readText = "", readColor = T.muted, readGlow = "rgba(0,0,0,0)", readOpacity = 1, readSize = 26;
  if (error) { readText = error.toUpperCase(); readColor = "#ff6a5a"; readGlow = "rgba(255,90,74,.55)"; }
  else if (phase === "idle") { readText = "PRESS LAUNCH TO FLY"; readOpacity = 0.8; }
  else if (lock) { readText = "TARGET ×" + target.toFixed(2); readColor = T.gold; readGlow = "rgba(240,217,154,.5)"; readSize = 30; }
  else if (over) {
    readSize = 34;
    if (outcome === "win") { readText = "WIN +" + fmtMKD(lastWin); readColor = T.win; readGlow = "rgba(46,230,166,.5)"; }
    else { readText = "NO WIN"; readColor = T.text2; readSize = 28; }
  }

  // header status chip — last win or the idle max label, mines-chip idiom
  const chip = lock
    ? { label: "FLYING", color: T.gold }
    : lastRound
      ? (lastRound.won ? { label: "WIN +" + fmtMKD(lastRound.payout), color: T.win } : { label: "×" + lastRound.result.toFixed(2), color: T.text2 })
      : { label: "LIMBO ×" + MAX_TARGET + " MAX", color: T.text2 };

  const canBet = balance >= 50;
  const sq = { flex: "none", width: "clamp(50px, 9vh, 76px)", minHeight: "clamp(50px, 9vh, 76px)", fontSize: "clamp(26px, 4.5vh, 38px)" };
  const statTile = { flex: 1, minWidth: 0, padding: "clamp(8px, 1.4vh, 12px) 6px", borderRadius: 16, border: `2px solid ${T.ctlBorder}`, background: "rgba(255,255,255,.03)", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 };

  return (
    <SpaceRoot>
      <SpaceBackground variant="game" fastDur={7} />

      <SpaceHeader title="LIMBO" chip={chip} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", gap: 0 }}>

        {/* ── left control panel ── */}
        <SpaceSidebar>
          <SoundButton />
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 2vh, 16px)", opacity: lock ? 0.4 : 1, pointerEvents: lock ? "none" : "auto", transition: "opacity .2s ease" }}>
            <BetStepper bet={bet} setBet={setBet} disabled={lock} maxBet={MAX_BET} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SectionLabel>TARGET MULTIPLIER</SectionLabel>
              <div style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
                <button onClick={() => stepTarget(-1)} className="sp-hover-gold" style={tileStyle(sq)}>−</button>
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "clamp(50px, 9vh, 76px)", border: `2px solid ${T.ctlBorder}`, borderRadius: 16, background: "rgba(255,255,255,.03)", fontSize: "clamp(17px, 3vh, 25px)", fontWeight: 700, color: T.gold, whiteSpace: "nowrap" }}>
                  {target.toFixed(2)}×
                </div>
                <button onClick={() => stepTarget(1)} className="sp-hover-gold" style={tileStyle({ ...sq, fontSize: "clamp(24px, 4.2vh, 36px)" })}>+</button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {QUICK.map((v) => (
                  <button key={v} onClick={() => quickTarget(v)} className="sp-hover-gold"
                    style={pillStyle(Math.abs(target - v) < 1e-9, { flex: 1, minHeight: "clamp(38px, 6.5vh, 54px)", fontSize: "clamp(13px, 2vh, 17px)", letterSpacing: 1 })}>{v}×</button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={statTile}>
                <span style={{ fontSize: 11, letterSpacing: 2, color: T.muted, whiteSpace: "nowrap" }}>WIN CHANCE</span>
                <span style={{ fontSize: "clamp(15px, 2.4vh, 20px)", fontWeight: 700, color: T.text }}>{winChancePct.toFixed(2)}%</span>
              </div>
              <div style={statTile}>
                <span style={{ fontSize: 11, letterSpacing: 2, color: T.muted, whiteSpace: "nowrap" }}>PROFIT ON WIN</span>
                <span style={{ fontSize: "clamp(15px, 2.4vh, 20px)", fontWeight: 700, color: T.win, whiteSpace: "nowrap" }}>{fmtMKD(profit)}</span>
              </div>
            </div>
          </div>
        </SpaceSidebar>

        {/* ── board column ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* readout */}
          <div style={{ position: "relative", zIndex: 4, height: 42, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ opacity: readOpacity, fontSize: readSize, fontWeight: 700, letterSpacing: 3, color: readColor, textShadow: `0 0 28px ${readGlow}`, transition: "opacity .25s ease" }}>{readText}</div>
          </div>

          {/* recent results — last 6, green/red pills, top-center */}
          <div style={{ position: "relative", zIndex: 4, height: 34, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {rolls.map((r) => (
              <span key={r.id} style={{ padding: "4px 13px", borderRadius: 20, border: `2px solid ${r.won ? "rgba(58,224,161,.55)" : "rgba(141,160,190,.35)"}`, background: r.won ? "rgba(58,224,161,.1)" : "rgba(141,160,190,.07)", color: r.won ? T.win : T.text2, fontSize: 14, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap", animation: "lbPillIn .3s ease both" }}>
                {r.n.toFixed(2)}×
              </span>
            ))}
          </div>

          {/* ── ROCKET ASCENT board ── */}
          <div style={{ position: "relative", zIndex: 4, flex: 1, minHeight: 140, margin: "4px 34px 10px" }}>

            {/* faint dotted altitude scale */}
            <div style={{ position: "absolute", left: "50%", top: "4%", bottom: "4%", width: 2, transform: "translateX(-50%)", zIndex: 1, backgroundImage: "repeating-linear-gradient(180deg, rgba(141,160,190,.4) 0 3px, transparent 3px 14px)", opacity: 0.45, pointerEvents: "none" }} />
            <div style={{ position: "absolute", left: "50%", top: "4%", bottom: "4%", width: 26, transform: "translateX(-50%)", zIndex: 1, backgroundImage: "repeating-linear-gradient(180deg, rgba(141,160,190,.3) 0 2px, transparent 2px 64px)", opacity: 0.45, pointerEvents: "none" }} />

            {/* TARGET line — gold, tagged with the target value */}
            <div style={{ position: "absolute", left: "50%", bottom: `${targetY}%`, transform: "translateX(-50%)", width: "clamp(240px, 30vw, 420px)", zIndex: 1, pointerEvents: "none", transition: "bottom .45s ease" }}>
              <div style={{ borderTop: "2px dashed rgba(240,217,154,.75)", boxShadow: "0 0 14px rgba(240,217,154,.25)", animation: "lbTargetPulse 2.6s ease-in-out infinite" }} />
              <span style={{ position: "absolute", right: -10, top: -13, transform: "translateX(100%)", padding: "3px 11px", borderRadius: 12, border: "1.5px solid rgba(240,217,154,.5)", background: "rgba(5,7,12,.8)", color: T.gold, fontSize: 13, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap" }}>{target.toFixed(2)}×</span>
            </div>

            {/* rocket on the thrust line */}
            <div ref={rocketRef} className={rocketMode === "exit" ? "lb-exit" : undefined}
              style={{
                position: "absolute", left: "50%", bottom: `${rocketY}%`, zIndex: 2,
                width: "clamp(30px, 6vh, 40px)", height: "clamp(46px, 9.4vh, 62px)",
                transform: "translateX(-50%)",
                transition: "none",
                animation: rocketMode === "exit" ? "lbExit .95s cubic-bezier(.45,0,.85,.4) forwards"
                  : rocketMode === "fall" ? "lbFall .82s cubic-bezier(.42,0,.9,.86) forwards" : "none",
                pointerEvents: "none",
              }}>
              <RocketSVG />
              {/* thruster flame — flickers in flight, snuffs out on a bust */}
              {(rocketMode === "flying" || rocketMode === "exit" || rocketMode === "fall") && (
                <div style={{
                  position: "absolute", left: "50%", top: "97%", width: "36%", height: "44%",
                  transform: "translateX(-50%)", transformOrigin: "50% 0",
                  borderRadius: "50% 50% 50% 50% / 28% 28% 72% 72%",
                  background: "linear-gradient(180deg, #fff6d8, #ffcf6b 38%, #ff8a3c 72%, rgba(255,110,50,0))",
                  filter: "blur(.5px)",
                  animation: rocketMode === "fall" ? "lbFlameOut .22s ease forwards" : "lbFlame .13s ease-in-out infinite alternate",
                }} />
              )}
              {/* gold trail while exiting off-screen */}
              {rocketMode === "exit" && (
                <div style={{ position: "absolute", left: "50%", top: "calc(100% + 4px)", transform: "translateX(-50%)", width: 5, borderRadius: 3, background: "linear-gradient(180deg, rgba(240,217,154,.95), rgba(240,217,154,0))", animation: "lbTrail .55s ease-out forwards" }} />
              )}
            </div>

            {/* the huge multiplier */}
            <div style={{ position: "absolute", inset: 0, zIndex: 3, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ position: "relative" }}>
                <div ref={numRef} style={{ fontSize: "clamp(80px, 18vh, 150px)", fontWeight: 700, letterSpacing: 2, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: numColor, textShadow: `0 0 44px ${numGlow}`, opacity: phase === "idle" && !lastRound ? 0.55 : 1, transition: "color .18s ease, opacity .3s ease" }}>
                  {`${shownVal.toFixed(2)}×`}
                </div>
                {/* target-cross ring bursts (mines ring idiom) */}
                {rings.map((b) => (
                  <div key={b.id} style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, pointerEvents: "none" }}>
                    <span style={{ position: "absolute", left: 0, top: 0, width: "clamp(180px, 30vh, 280px)", height: "clamp(180px, 30vh, 280px)", borderRadius: "50%", border: "3px solid #7ef0c0", animation: "lbRing .7s ease-out both" }} />
                    {b.sparks.map((sp, k) => (
                      <span key={k} style={{ position: "absolute", left: 0, top: 0, transform: `rotate(${sp.rot}) scale(${sp.sc})` }}>
                        <span style={{ position: "absolute", left: 0, top: -2, width: 16, height: 4, borderRadius: 2, background: "#8df0c8", animation: "lbSpark .6s ease-out both" }} />
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── bottom bar ── */}
          <div style={{ position: "relative", zIndex: 5, flex: "none", display: "flex", alignItems: "stretch", gap: "clamp(8px, 1vw, 14px)", margin: "0 clamp(10px, 1.6vw, 24px) 20px 10px" }}>
            <button onClick={() => { lbSfx.click(); navigate("/"); }} className="sp-hover-gold"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: "clamp(56px, 11vh, 88px)", padding: "0 clamp(14px, 2vw, 30px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(15px, 1.4vw, 21px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>LOBBY
            </button>
            <button onClick={() => { lbSfx.click(); setRules((r) => !r); }} className="sp-hover-gold"
              style={{ flex: "none", width: "clamp(56px, 11vh, 88px)", minHeight: "clamp(56px, 11vh, 88px)", borderRadius: 20, border: `2px solid ${T.ctlBorder}`, background: T.panelBg, color: T.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" /></svg>
            </button>
            <div style={{ flex: 1 }} />
            {lock
              ? <GoldButton label="FLYING…" disabled labelSize="clamp(21px, 2.2vw, 32px)" style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 }} />
              : <GoldButton label="LAUNCH" sub={fmtMKD(Math.min(bet, MAX_BET, Math.max(50, Math.floor(balance) || 50)))} onClick={launch} disabled={!canBet} labelSize="clamp(21px, 2.2vw, 32px)" style={{ flex: "none", minWidth: "clamp(210px, 26vw, 340px)", borderRadius: 22 }} />}
          </div>

        </div>
      </div>

      {rules && <RulesModal onClose={() => setRules(false)} />}
    </SpaceRoot>
  );
}
