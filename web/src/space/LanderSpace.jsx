// STAR LANDER — the auto-resolving flight game (Aviamasters family), on our
// space stage. One POST resolves the whole flight server-side; this screen
// replays the script: the shuttle crosses the field, collects energy cells
// (+1 +2 +5 +10) and warp crystals (x2..x5), takes meteor strikes (halve),
// and either DOCKS on the platform (the counter pays) or drifts into the
// black hole (bet lost). There is no cashout button, exactly like the
// original — the player only watches, at one of four speeds.
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost, apiGet } from "../api";
import { useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import { beep, sfx, whoosh, useVol, cycleVol, VOL_LABELS, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import { bnMusic } from "./bnMusic";
import { useMaxBet } from "./limits";
import "./space.css";
import "./lander.css";

const GEM = "/space/gems/";
const PICK_ICON = { 1: "citrine", 2: "sapphire", 5: "emerald", 10: "ruby" };

// x-distance between events on the field, in px of the field's own space
const SPACING = 190;
const X0 = 260;                 // where the first event sits (launch zone before it)

// four speeds, exactly like the original: the factor scales EVERY beat and
// every transition (via --lnfx), never the odds
const SPEEDS = [
  { key: "slow", label: "🐢", f: 1.5 },
  { key: "normal", label: "▶", f: 1 },
  { key: "fast", label: "🐇", f: 0.55 },
  { key: "ultra", label: "⚡", f: 0.28 },
];
const SEG_MS = 760;             // one segment at speed x1

const lnSfx = {
  takeoff() { whoosh(180, 760, 0.35, 0.7); },
  pick(v) { beep("triangle", 520 + v * 60, 900 + v * 90, 0.06, 0.16); },
  mult(v) { bnMusic.tumble(v); },
  rocket() { beep("sine", 220, 60, 0.2, 0.35); whoosh(500, 120, 0.3, 0.4); },
  dock() { sfx.cash(); bnMusic.fanfare(); },
  hole() { whoosh(600, 70, 0.35, 0.9); beep("sine", 160, 55, 0.25, 0.9); },
  click: sfx.click,
};

export default function LanderSpace() {
  const navigate = useNavigate();
  const balance = useBalance();
  const vol = useVol();
  const MAX_BET = useMaxBet("lander");

  const [bet, setBet] = useState(100);
  const [flight, setFlight] = useState(null);     // the server script being replayed
  const [taken, setTaken] = useState(new Set());  // event indices already passed
  const [boom, setBoom] = useState(new Set());    // rocket events that hit
  const [scroll, setScroll] = useState(0);        // field translateX
  const [shipY, setShipY] = useState(46);         // % of stage height
  const [shipState, setShipState] = useState("idle"); // idle|fly|dock|hole
  const [spinning, setSpinning] = useState(false);
  const [winShow, setWinShow] = useState(0);      // MKD, ticking
  const [multShow, setMultShow] = useState(1);
  const [plaques, setPlaques] = useState([]);
  const [result, setResult] = useState(null);     // { kind: 'dock'|'hole', payout }
  const [history, setHistory] = useState([]);
  const [speed, setSpeed] = useState(1);          // index into SPEEDS
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");
  const [table, setTable] = useState(null);

  const deadRef = useRef(false);
  const timers = useRef([]);
  const heldRef = useRef(false);
  const ffRef = useRef(false);
  const speedRef = useRef(1);
  speedRef.current = SPEEDS[speed].f;
  const winRef = useRef(0);
  const fxId = useRef(0);
  const runRef = useRef(null);
  const spinningRef = useRef(false);
  spinningRef.current = spinning;

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  // interruptible, like Bonanza's: the target is re-read every tick so the
  // skip collapses the CURRENT wait too
  const sleep = (ms) => new Promise((res) => {
    const t0 = performance.now();
    const tick = () => {
      if (deadRef.current) return res();
      const target = ms * speedRef.current * (ffRef.current ? 0.05 : 1);
      if (performance.now() - t0 >= target) return res();
      later(tick, 30);
    };
    tick();
  });
  const countTo = (target, ms) => new Promise((res) => {
    const from = winRef.current;
    if (Math.abs(target - from) < 0.005) { winRef.current = target; setWinShow(target); return res(); }
    const dur = Math.max(80, ms * (ffRef.current ? 0.1 : 1));
    const t0 = performance.now();
    const tick = () => {
      if (deadRef.current) return res();
      const k = Math.min(1, (performance.now() - t0) / dur);
      const v = from + (target - from) * k;
      winRef.current = v; setWinShow(v);
      if (k < 1) later(tick, 33); else res();
    };
    tick();
  });
  const hold = () => { if (!heldRef.current) { heldRef.current = true; holdBalance(); } };
  const release = () => { if (heldRef.current) { heldRef.current = false; releaseBalance(); } };

  useEffect(() => {
    deadRef.current = false;
    armAmbientOnGesture(); startAmbient();
    apiGet("/api/games/lander/table").then(({ ok, data }) => { if (ok) setTable(data); });
    const down = (e) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      if (!e.repeat && runRef.current) runRef.current();
    };
    window.addEventListener("keydown", down);
    return () => {
      deadRef.current = true;
      window.removeEventListener("keydown", down);
      timers.current.forEach(clearTimeout);
      release();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const plaqueAt = (text, tone) => {
    const id = ++fxId.current;
    setPlaques((p) => [...p, { id, text, tone }]);
    later(() => setPlaques((p) => p.filter((x) => x.id !== id)), 1100);
  };

  // altitude choreography: cells lift the shuttle, meteors knock it down;
  // it lives in [18, 72] so the dive and the dock read as real departures
  const bump = (dy) => setShipY((y) => Math.max(18, Math.min(72, y + dy)));

  const run = async () => {
    if (spinningRef.current) return;
    const lineBet = Math.max(50, Math.min(bet, MAX_BET));
    if (balance < lineBet) { setError("NOT ENOUGH CREDITS"); return; }
    setError(""); setSpinning(true); setResult(null);
    setTaken(new Set()); setBoom(new Set());
    winRef.current = lineBet; setWinShow(lineBet); setMultShow(1);
    ffRef.current = false;
    hold(); lnSfx.click();

    const { ok, data } = await apiPost("/api/games/lander/spin", { betAmount: lineBet });
    if (deadRef.current) return;
    if (!ok) { setError((data?.error || "Spin failed").toUpperCase()); setSpinning(false); release(); return; }

    try {
      const n = data.events.length;
      setFlight(data);
      setShipY(46); setShipState("fly"); setScroll(0);
      lnSfx.takeoff();
      await sleep(650);                    // climb-out before the first event
      if (deadRef.current) return;

      for (let k = 0; k < n; k++) {
        // the field advances one segment; the shuttle meets event k
        setScroll(-(k + 1) * SPACING);
        await sleep(SEG_MS);
        if (deadRef.current) return;
        const e = data.events[k];
        setTaken((t) => new Set(t).add(k));
        if (e.k === "p") {
          lnSfx.pick(e.v);
          plaqueAt("+" + e.v, "good");
          bump(-3);
          setMultShow(e.c);
          await countTo(e.c * lineBet, 420);
        } else if (e.k === "m") {
          lnSfx.mult(e.v);
          plaqueAt("×" + e.v, "warp");
          bump(-5);
          setMultShow(e.c);
          await countTo(e.c * lineBet, 560);
        } else {
          setBoom((b) => new Set(b).add(k));
          lnSfx.rocket();
          plaqueAt("÷2", "bad");
          bump(+11);
          setMultShow(e.c);
          await countTo(e.c * lineBet, 480);
        }
        if (deadRef.current) return;
      }

      // the terminal: one more segment to the platform or the void
      setScroll(-(n + 1) * SPACING);
      await sleep(SEG_MS);
      if (deadRef.current) return;

      if (data.terminal === "dock") {
        setShipState("dock");
        setShipY(58);                      // settle onto the pad
        lnSfx.dock();
        await countTo(data.payout, 500);
        setResult({ kind: "dock", payout: data.payout });
        await sleep(1400);
      } else {
        setShipState("hole");
        setShipY(88);                      // the dive
        lnSfx.hole();
        await countTo(0, 600);
        setMultShow(0);
        setResult({ kind: "hole", payout: 0 });
        await sleep(1300);
      }
      setHistory((h) => [{ m: data.multiplier }, ...h].slice(0, 9));
    } finally {
      if (!deadRef.current) { setSpinning(false); setShipState("idle"); setShipY(46); setScroll(0); setFlight(null); }
      release();
    }
  };

  runRef.current = () => {
    if (spinningRef.current) { ffRef.current = true; return; }   // second press = snap to the end
    if (rules) return;
    run();
  };

  const lineBet = Math.max(50, Math.min(bet, MAX_BET));
  const idle = !spinning;
  const stepBet = (d) => { lnSfx.click(); setBet((b) => Math.max(50, Math.min(MAX_BET, b + d * 50))); };

  // field geometry for the render
  const n = flight ? flight.events.length : 0;
  const fieldW = X0 + (n + 2) * SPACING + 400;

  return (
    <div className={"ln-root" + (ffRef.current && spinning ? " ln-snap" : "")}
      style={{ "--lnfx": SPEEDS[speed].f }}>

      {/* ── HUD ── */}
      <header className="ln-hud">
        <div className="ln-hud-l">
          <button type="button" className="ln-mini" onClick={() => { lnSfx.click(); navigate("/"); }} aria-label="Lobby">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <button type="button" className="ln-mini" onClick={() => { lnSfx.click(); setRules(true); }} aria-label="Info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.6" /></svg>
          </button>
          <button type="button" className="ln-mini" onClick={() => { cycleVol(); lnSfx.click(); }} aria-label={"Sound " + VOL_LABELS[vol]}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <path d="M4 9v6h3.5L12 19V5L7.5 9H4z" fill="currentColor" stroke="none" />
              <path d="M16 9.5a4 4 0 0 1 0 5" opacity={vol >= 2 ? 1 : 0.15} />
            </svg>
          </button>
        </div>
        <div className="ln-counter">
          <b className={result?.kind === "hole" ? "bad" : winShow > lineBet ? "good" : ""}>{fmtMKD(winShow)}</b>
          <span className="ln-counter-x">×{multShow.toFixed(2)}</span>
        </div>
        <div className="ln-history">
          {history.map((h, i) => (
            <span key={i} className={"ln-chip" + (h.m > 0 ? " good" : " bad")}>{h.m > 0 ? "×" + h.m.toFixed(2) : "✕"}</span>
          ))}
        </div>
      </header>

      {/* ── the flight ── */}
      <div className="ln-stage">
        <div className="ln-stars a" /><div className="ln-stars b" />

        <div className="ln-field" style={{
          width: fieldW,
          transform: `translate3d(${scroll}px, 0, 0)`,
          transition: spinning ? `transform calc(var(--lnfx) * ${SEG_MS}ms) linear` : "none",
        }}>
          <img src={GEM + "pad.png"} alt="" className="ln-launchpad" draggable={false} />
          {flight && flight.events.map((e, k) => {
            const x = X0 + (k + 1) * SPACING;
            const y = 24 + ((k * 37) % 40);
            const got = taken.has(k);
            if (e.k === "r") {
              return (
                <div key={k} className={"ln-item rocket" + (boom.has(k) ? " hit" : "")} style={{ left: x, top: y + "%" }}>
                  <img src={GEM + "meteor.png"} alt="" draggable={false} />
                </div>
              );
            }
            return (
              <div key={k} className={"ln-item " + (e.k === "m" ? "warp" : "cell") + (got ? " got" : "")}
                style={{ left: x, top: y + "%" }}>
                <img src={GEM + (e.k === "m" ? "lunar" : PICK_ICON[e.v]) + ".png"} alt="" draggable={false} />
                <b>{e.k === "m" ? "×" + e.v : "+" + e.v}</b>
              </div>
            );
          })}
          {flight && (
            flight.terminal === "dock"
              ? <img src={GEM + "pad.png"} alt="" className="ln-dockpad" draggable={false}
                  style={{ left: X0 + (n + 1) * SPACING }} />
              : <img src={GEM + "blackhole-2.png"} alt="" className="ln-void" draggable={false}
                  style={{ left: X0 + (n + 1) * SPACING }} />
          )}
        </div>

        <div className={"ln-ship " + shipState} style={{ top: shipY + "%" }}>
          <img src={GEM + "shuttle.png"} alt="" draggable={false} />
          <div className="ln-plaques">
            {plaques.map((p) => <span key={p.id} className={"ln-plaque " + p.tone}>{p.text}</span>)}
          </div>
        </div>

        {result && (
          <div className={"ln-result " + result.kind}>
            <b>{result.kind === "dock" ? "DOCKED" : "INTO THE VOID"}</b>
            <span>{result.kind === "dock" ? fmtMKD(result.payout) : "BET LOST"}</span>
          </div>
        )}
        {error && <div className="ln-error">{error}</div>}
      </div>

      {/* ── console ── */}
      <footer className="ln-console">
        <div className="ln-meters">
          <span>CREDIT</span><b>{fmtMKD(balance)}</b>
          <span>BET</span><b>{fmtMKD(lineBet)}</b>
        </div>
        <div className="ln-speeds">
          {SPEEDS.map((s, i) => (
            <button type="button" key={s.key}
              className={"ln-speed" + (speed === i ? " on" : "")}
              onClick={() => { lnSfx.click(); setSpeed(i); }} aria-label={s.key}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="ln-actions">
          <button type="button" className="ln-step" disabled={!idle || lineBet <= 50} onClick={() => stepBet(-1)}>−</button>
          <button type="button"
            className={"ln-spin" + (spinning ? " busy" : "")}
            disabled={!spinning && balance < lineBet}
            onClick={() => runRef.current && runRef.current()}
            aria-label={spinning ? "Skip" : "Launch"}>
            {spinning ? "" : "LAUNCH"}
          </button>
          <button type="button" className="ln-step" disabled={!idle || lineBet >= MAX_BET} onClick={() => stepBet(1)}>+</button>
        </div>
      </footer>

      {rules && (
        <div className="ln-modal" onClick={() => setRules(false)}>
          <div className="ln-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="ln-modal-title">STAR LANDER</div>
            <div className="ln-rule">THE SHUTTLE FLIES ON ITS OWN — THERE IS NOTHING TO PRESS AND NOTHING TO TIME. IT EITHER <b>DOCKS</b> AND THE COUNTER PAYS, OR DRIFTS INTO THE <b>BLACK HOLE</b>.</div>
            <div className="ln-rule">ENERGY CELLS <b>ADD</b> +1 +2 +5 +10 · WARP CRYSTALS <b>MULTIPLY</b> ×2 ×3 ×4 ×5 · A METEOR STRIKE <b>HALVES</b> THE COUNTER.</div>
            <div className="ln-rule">EVERY FLIGHT STARTS AT ×1.00. MAX WIN <b>×{table?.maxWinMultiplier ?? 250}</b>. DOCK CHANCE <b>{table ? Math.round(table.dockChance * 100) : 37}%</b> — SPEED CHANGES THE PICTURE, NEVER THE ODDS.</div>
            <div className="ln-rule dim">PRESS LAUNCH (OR SPACE) · PRESS AGAIN TO SKIP TO THE ENDING · PROVABLY FAIR, LIKE EVERY GAME ON THIS MACHINE.</div>
            <button type="button" className="ln-gotit" onClick={() => setRules(false)}>GOT IT</button>
          </div>
        </div>
      )}
    </div>
  );
}
