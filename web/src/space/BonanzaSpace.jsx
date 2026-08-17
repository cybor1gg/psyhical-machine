// STAR CLUSTER — pay-anywhere tumbling slot, built to the Nova Bonanza layout.
//
// Structure: a play row (left rail | cabinet) over a full-width console row.
// The left rail is height-matched to the cabinet — logo on top, then BUY,
// DOUBLE CHANCE and the win list sharing the rest of exactly its height.
//
// Everything inside it is ours: our gem symbols, our animated comet, our Lunar,
// the shared space scene behind, and our server-authoritative maths. The server
// resolves the whole round in one POST; this screen paces the reveal and
// decides nothing.
//
// Credits are held for the entire round and released when the last tumble
// settles, so a win lands WITH its animation. That is a deliberate departure
// from the prototype, which ticks the balance per spin.
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost, apiGet } from "../api";
import { useBalance, holdBalance, releaseBalance, refreshHold } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import { beep, sfx, whoosh, useVol, cycleVol, VOL_LABELS, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import { useMaxBet } from "./limits";
import { bnMusic } from "./bnMusic";
import { sample, music, preloadSamples } from "./bnAudio";
import "./space.css";
import "./bonanza.css";

const COLS = 6, ROWS = 5, CELLS = COLS * ROWS;
const GEM = "/space/gems/";
const LOW = ["citrine", "amethyst", "rose", "jade"];
const NAMES = {
  citrine: "CITRINE", amethyst: "AMETHYST", rose: "ROSE", jade: "SAUCER",
  sapphire: "SAPPHIRE", emerald: "EMERALD", lunar: "LUNAR", ruby: "RUBY", scatter: "COMET",
};
const src = (id) => GEM + (id === "scatter" ? "comet" : id) + ".png";
// shard colour per symbol — the debris should be the colour of the thing that broke
const SPARK = {
  citrine: "#ffc44a", amethyst: "#b074ff", rose: "#ff7eb2", jade: "#5fd9e8",
  sapphire: "#56a2ff", emerald: "#34e28c", lunar: "#dfe7f5", ruby: "#ff5260", scatter: "#ffd68a",
};
// cell index -> percentage centre inside the grid
const posOf = (i) => ({ l: ((i % COLS) + 0.5) * (100 / COLS), t: (Math.floor(i / COLS) + 0.5) * (100 / ROWS) });

// How far each cell FELL to reach its place, in cells.
//
// This is what makes a tumble read as a cascade instead of a fresh spin: a
// symbol that survived slides down only as far as the gap beneath it, while a
// genuinely new symbol comes in from above the grid. Re-dropping all thirty
// from the top every tumble is the thing that looked wrong.
//
// `cleared` is the previous board with the winners removed; walking each column
// from the bottom reproduces exactly the gravity the server applied.
function shiftsFor(nextGrid, cleared) {
  const shifts = new Array(CELLS).fill(0);
  if (!cleared) {
    // opening drop: one RIGID sheet. Every cell gets the SAME shift, so the
    // board keeps its shape while it slides in — per-row shifts compressed
    // the column into a blur mid-flight, which read as a skip.
    for (let i = 0; i < CELLS; i++) shifts[i] = ROWS + 1.4;
    return shifts;
  }
  for (let c = 0; c < COLS; c++) {
    const keep = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      const v = cleared[r * COLS + c];
      if (v !== null && v !== undefined) keep.push(r);
    }
    // survivors close their own gap; the NEW symbols of a column enter as
    // ONE CONNECTED STACK from just above the mask. Per-symbol "shortest
    // distance" starts (r + 1.35) put every newcomer at the SAME height -
    // three new symbols spawned overlapping and fanned out at different
    // speeds, which read as falling out of the sky wrong.
    const fresh = ROWS - keep.length;
    for (let r = ROWS - 1, k = 0; r >= 0; r--, k++) {
      const i = r * COLS + c;
      shifts[i] = k < keep.length ? r - keep[k] : fresh + 1.35;
    }
  }
  return shifts;
}

const BURST = ["ruby", "emerald", "sapphire", "lunar", "citrine", "amethyst", "rose",
  "jade", "ruby", "sapphire", "emerald", "lunar", "amethyst", "citrine", "rose"];

const MARQUEE = [
  "SYMBOLS PAY ANYWHERE ON THE FIELD",
  "8 OR MORE OF A KIND PAYS",
  "4 COMETS WIN FREE SPINS",
  "WINS TUMBLE — THEY KEEP PAYING",
  "PRESS SPACE TO SPIN — HOLD FOR TURBO",
];

// win size → ceremony, in multiples of the line bet
const BIG = 10, MEGA = 25, COSMIC = 60;
const tierOf = (m) => (m >= COSMIC ? "COSMIC WIN" : m >= MEGA ? "MEGA WIN" : m >= BIG ? "BIG WIN" : null);

const bnSfx = {
  drop(i) { beep("triangle", 300 + i * 26, 190 + i * 20, 0.035, 0.1); },
  tumble(i) { beep("triangle", 520 + i * 90, 900 + i * 90, 0.05, 0.2); },
  win() { sfx.cash(); },
  chime(i) { beep("sine", 620 + i * 130, 1500 + i * 200, 0.12, 0.3); },
  boom() { beep("sine", 120, 40, 0.5, 0.5); whoosh(300, 60, 0.5, 0.4); },
  orb(m = 2) {
    if (!sample("nova-orb", { v: 0.8, cut: 1.8 })) {
      beep("sawtooth", 210, 70, 0.13, 0.34); beep("sine", 700 + Math.min(m, 40) * 22, 1500, 0.1, 0.22, 0.05);
    }
  },
  fanfare() { sfx.cash(); beep("triangle", 520, 1200, 0.3, 0.3, 0.06); beep("triangle", 660, 1500, 0.32, 0.28, 0.14); },
  click() { if (!sample("click", { v: 0.55 })) sfx.click(); },
};

// The handoff's own sky, laid over the cabinet's shared scene. Every layer is
// translucent, so our drifting sun and starfields still read through — this
// ADDS the nebulae, the ringed world and the planet horizon that the prototype
// has and our shared backdrop does not. Scoped to this screen, so no other
// game changes. All transform/opacity, so it rides the compositor.
function NovaSky() {
  return (
    <div className="bn-sky" aria-hidden="true">
      <span className="bn-neb violet" />
      <span className="bn-neb teal" />
      <span className="bn-neb amber" />
      <span className="bn-swirl" />

      <div className="bn-world">
        <span className="bn-world-glow" />
        <span className="bn-world-body" />
        <span className="bn-world-bands"><span /></span>
        <span className="bn-world-ring" />
      </div>

      <span className="bn-moon" />
      <span className="bn-rock r1" />
      <span className="bn-rock r2" />
      <span className="bn-rock r3" />
      <span className="bn-haze" />

      <span className="bn-horizon" />
      <span className="bn-horizon-rim" />
      <span className="bn-lowfade" />
      <span className="bn-vignette" />
    </div>
  );
}

const IconBtn = ({ label, onClick, children }) => (
  <button type="button" onClick={onClick} className="bn-icon" aria-label={label} title={label}>{children}</button>
);



// The info screen is PAGES, not a scroll: this runs on a touchscreen cabinet,
// so everything is tap-sized, one idea per page, arrows and dots to move.
function RulesModal({ onClose, table }) {
  const [page, setPage] = useState(0);
  const pays = table ? Object.entries(table.pays) : [];
  const fs = table?.freeSpins ?? 10;
  const pages = [
    {
      title: "HOW IT PAYS",
      body: (
        <div className="bn-rp-lines">
          <div className="bn-rp-line">NO LINES. <b>8 OR MORE</b> OF A SYMBOL, ANYWHERE ON THE FIELD, PAYS.</div>
          <div className="bn-rp-line">WINNERS BURST. THE REST FALL AND NEW SYMBOLS FILL THE TOP — A <b>TUMBLE</b>.</div>
          <div className="bn-rp-line">TUMBLES REPEAT WHILE WINS KEEP LANDING, ALL INTO THE SAME ROUND.</div>
        </div>
      ),
    },
    {
      title: "THE SYMBOLS",
      body: (
        <div className="bn-rp-pays">
          {pays.map(([id, tiers]) => (
            <div className="bn-rp-pay" key={id}>
              <img src={src(id)} alt={NAMES[id] || id} />
              <div className="bn-rp-tiers">
                <span>8–9 <b>×{tiers[0]}</b></span>
                <span>10–11 <b>×{tiers[1]}</b></span>
                <span>12+ <b>×{tiers[2]}</b></span>
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "COMETS",
      body: (
        <div className="bn-rp-lines">
          <div className="bn-rp-hero"><span className="bn-sym scatter bn-rp-comet" role="img" aria-label="comet" /></div>
          <div className="bn-rp-line"><b>4 OR MORE COMETS</b> PAY A BONUS AND AWARD <b>{fs} FREE SPINS</b>.</div>
          <div className="bn-rp-line">3 MORE COMETS INSIDE THE FEATURE ADD <b>5 EXTRA SPINS</b>.</div>
        </div>
      ),
    },
    {
      title: "BLACK HOLES",
      body: (
        <div className="bn-rp-lines">
          <div className="bn-rp-hero"><img src={GEM + "blackhole.png"} alt="black hole" className="bn-rp-meteor" /></div>
          <div className="bn-rp-line">IN FREE SPINS, <b>BLACK HOLES</b> LAND CARRYING MULTIPLIERS. THEY NEVER PAY ALONE AND NEVER TUMBLE.</div>
          <div className="bn-rp-line">WHEN THE TUMBLING STOPS THEY <b>DRAW THE WIN IN</b>, ADD TOGETHER, AND MULTIPLY THE <b>WHOLE ROUND</b>:</div>
          <div className="bn-rp-example">500 <span>×5 +  ×3</span> → 500 × 8 = <b>4,000</b></div>
        </div>
      ),
    },
    {
      title: "DOUBLE CHANCE & BUY",
      body: (
        <div className="bn-rp-lines">
          <div className="bn-rp-line"><b>DOUBLE CHANCE</b> COSTS {Math.round(((table?.anteCost ?? 1.25) - 1) * 100)}% MORE AND <b>DOUBLES</b> HOW OFTEN THE FEATURE HITS. SAME PAYS.</div>
          <div className="bn-rp-line"><b>BUY FREE SPINS</b> GOES STRAIGHT TO THE FEATURE FOR {(table?.buyPrice ?? 100).toFixed(0)}× YOUR BET.</div>
          <div className="bn-rp-line dim">PRESS SPACE TO SPIN · HOLD FOR TURBO</div>
        </div>
      ),
    },
  ];
  return (
    <div onClick={onClose} className="bn-modal">
      <div onClick={(e) => e.stopPropagation()} className="bn-rules-box">
        <button type="button" className="bn-rules-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="bn-rp-title">{pages[page].title}</div>
        <div className="bn-rp-body">{pages[page].body}</div>
        <div className="bn-rules-nav">
          <button type="button" className="bn-rules-arrow" disabled={page === 0}
            onClick={() => { sfx.click(); setPage((p) => p - 1); }} aria-label="Previous">◀</button>
          <div className="bn-rules-dots">
            {pages.map((_, i) => (
              <button type="button" key={i} className={i === page ? "on" : ""}
                onClick={() => { sfx.click(); setPage(i); }} aria-label={`Page ${i + 1}`} />
            ))}
          </div>
          <button type="button" className="bn-rules-arrow" disabled={page === pages.length - 1}
            onClick={() => { sfx.click(); setPage((p) => p + 1); }} aria-label="Next">▶</button>
        </div>
      </div>
    </div>
  );
}

export default function BonanzaSpace() {
  const MAX_BET = useMaxBet("bonanza");
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;
  const vol = useVol();

  const [bet, setBet] = useState(100);
  const [grid, setGrid] = useState(() => Array(CELLS).fill(null));
  // Cells, not symbol ids: the ring, the shards and the rising amount all need
  // to know WHERE the win was, which an id alone cannot say.
  const [winCells, setWinCells] = useState(new Set());
  const [popCells, setPopCells] = useState(new Set());
  const [shards, setShards] = useState([]);
  const [phase, setPhase] = useState("idle");     // idle | drop | win | pop | scatter | intro
  const [spinning, setSpinning] = useState(false);
  const [roundWin, setRoundWin] = useState(0);    // multiples of the line bet — live during the replay
  // The settled figure, straight from the server. Accumulating multiplier x bet
  // in floats drifts a cent from the truncated payout, and showing two numbers
  // for one win is exactly the kind of thing that erodes trust in a machine.
  const [settledWin, setSettledWin] = useState(null);
  const [freeLeft, setFreeLeft] = useState(0);
  const [freeTotal, setFreeTotal] = useState(0);
  const [freeWin, setFreeWin] = useState(0);
  const [orbs, setOrbs] = useState([]);
  const [payRows, setPayRows] = useState([]);   // this round's paying symbols
  const [ante, setAnte] = useState(false);
  const [turbo, setTurbo] = useState(false);
  const [spaceTurbo, setSpaceTurbo] = useState(false); // armed by HOLDING space
  const [ff, setFf] = useState(false);             // second press = skip the reveal
  const [table, setTable] = useState(null);
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");
  const [shifts, setShifts] = useState(() => new Array(CELLS).fill(0));
  const [settled, setSettled] = useState(true);
  const [marquee, setMarquee] = useState(0);
  const [intro, setIntro] = useState(null);       // { count, bought }
  const [bigWin, setBigWin] = useState(null);
  const [shake, setShake] = useState(false);
  const [flash, setFlash] = useState(0);
  const [winDisplay, setWinDisplay] = useState(0); // MKD - the WIN line TICKS, it never snaps
  const [subline, setSubline] = useState(null);    // { count, id, amount } under the WIN line
  const [plaques, setPlaques] = useState([]);      // amounts stamped on the felt
  const [burst, setBurst] = useState(false);       // the screen-covering trigger transition
  const [stage, setStage] = useState(false);       // the feature backdrop veil
  const [introOut, setIntroOut] = useState(false); // the congrats plaque shrinking away
  const [dropMode, setDropMode] = useState("open"); // open = staggered rain, tumble = one fast drop
  const [buyAsk, setBuyAsk] = useState(false);     // ARE YOU SURE before money leaves
  const [devour, setDevour] = useState(null);      // cell -> vector into its black hole
  const [converge, setConverge] = useState(null);  // trigger comets streaking to the centre
  const [bigComet, setBigComet] = useState(false); // the merged giant
  const [retrig, setRetrig] = useState(false);     // the +5 celebration
  const [burstO, setBurstO] = useState(null);      // the detonation origin, on the reels
  const panelRef = useRef(null);
  const [multBadge, setMultBadge] = useState(null); // the combined multiplier slam

  const deadRef = useRef(false);
  const heldRef = useRef(false);
  const timers = useRef([]);
  const armRef = useRef(null);                     // the hold-to-turbo timer
  const ffRef = useRef(false);
  const droppingRef = useRef(false);              // ff may only arm mid-drop
  const turboRef = useRef(false);
  turboRef.current = turbo || spaceTurbo;
  const startedRef = useRef(null);                // resolved when START is pressed
  const lineBetRef = useRef(50);                  // the popups need the stake mid-replay
  const winDisplayRef = useRef(0);
  const orbsRef = useRef([]);
  const runRef = useRef(null);                    // Space needs the latest run()
  const bigRef = useRef(false);                   // a big-win count is on screen
  const skipRef = useRef(false);                  // the player asked to skip it
  const payRowsRef = useRef([]);

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  // The remaining wait is re-evaluated every tick: the moment the skip or
  // turbo engages, the CURRENT sleep collapses too. A one-shot setTimeout
  // kept its full original duration, which is why the double-press never
  // felt instant - the 1s sweep it was pressed during still ran to the end.
  const sleep = (ms) => new Promise((res) => {
    const t0 = performance.now();
    const tick = () => {
      if (deadRef.current) return res();
      const target = ms * (turboRef.current ? 0.35 : 1) * (ffRef.current ? 0.05 : 1);
      if (performance.now() - t0 >= target) return res();
      later(tick, 40);
    };
    tick();
  });
  // The reference ticks its WIN line linearly at ~30 steps a second and never
  // snaps; this drives ours the same way. Amounts are MKD.
  const countTo = (target, ms) => new Promise((res) => {
    const from = winDisplayRef.current;
    if (Math.abs(target - from) < 0.005) { winDisplayRef.current = target; setWinDisplay(target); return res(); }
    const dur = Math.max(80, Math.round(ms * (turboRef.current ? 0.35 : 1)));
    const t0 = performance.now();
    const tick = () => {
      if (deadRef.current) return res();
      const k = Math.min(1, (performance.now() - t0) / dur);
      const v = from + (target - from) * k;
      winDisplayRef.current = v; setWinDisplay(v);
      if (k < 1) later(tick, 33); else res();
    };
    tick();
  });

  const hold = () => { if (!heldRef.current) { heldRef.current = true; holdBalance(); } };
  const release = () => { if (heldRef.current) { heldRef.current = false; releaseBalance(); } };

  useEffect(() => {
    // StrictMode dev-mounts run mount -> cleanup -> mount; without this reset
    // the cleanup's kill-flag survives into the second mount and every spin
    // bails at its first deadRef check, spinning forever on GOOD LUCK
    deadRef.current = false;
    armAmbientOnGesture(); startAmbient();
    preloadSamples(); music("base");
    // the reels greet the player FULL, raining in like the original's idle
    // board - a presentation deal only, nothing evaluable: no comets, and the
    // first real spin sweeps it away like any other board
    if (!gridRef.current.some(Boolean)) {
      const pool = [...LOW, "sapphire", "emerald", "lunar", "ruby"];
      const board = Array.from({ length: CELLS }, () => pool[Math.floor(Math.random() * pool.length)]);
      setDropMode("open");
      place(board, null);
    }
    apiGet("/api/games/bonanza/table").then(({ ok, data }) => { if (ok) setTable(data); });
    const down = (e) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      if (e.repeat) return;
      // one press SPINS (or continues, or skips a count). Turbo only ARMS
      // once the key has been HELD a beat - the press that starts a spin
      // must not fast-forward it, which is exactly what made spins look
      // like a skipping turbo: the timers ran at 0.35x while the CSS could
      // not follow, and symbols vanished mid-flight.
      if (runRef.current) runRef.current();
      if (!armRef.current) armRef.current = setTimeout(() => { armRef.current = null; setSpaceTurbo(true); }, 650);
    };
    const up = (e) => {
      if (e.code !== "Space") return;
      if (armRef.current) { clearTimeout(armRef.current); armRef.current = null; }
      setSpaceTurbo(false);
    };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => {
      deadRef.current = true;
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up);
      timers.current.forEach(clearTimeout); if (armRef.current) clearTimeout(armRef.current); bnMusic.loopStop(); music(null); release();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const quake = (ms = 420) => { setShake(true); later(() => setShake(false), ms); };

  // Two-phase handshake: paint the board displaced, then release it on the
  // NEXT frame so the browser has something to transition from. A hidden tab
  // never delivers those frames, hence the bail-out and the 70ms fallback.
  const settledRef = useRef(true);
  const gridRef = useRef([]);
  const [exiting, setExiting] = useState(false);

  // The old board has to GO somewhere. Previously a new spin simply swapped the
  // grid and the previous symbols blinked out of existence; now they fall out
  // of the bottom first, and only then does the new board drop in from above.
  const sweepOut = async () => {
    // reads a REF, not state: playSpin is a useCallback([]) and would otherwise
    // close over the first render's empty board and never sweep anything
    // a fed board holds only black holes; they still deserve their exit
    if (!gridRef.current.some(Boolean) && orbsRef.current.length === 0) return;
    setExiting(true);
    // .45s of travel + the bottom-first row cascade (240ms) + the column wave
    // (275ms): the last symbol to leave is the top-right one, at ~965ms.
    // A fed board holds only black holes - a shorter goodbye.
    await sleep(gridRef.current.some(Boolean) ? 1000 : 600);
    setExiting(false);
  };

  const place = (nextGrid, cleared) => {
    gridRef.current = nextGrid;
    setGrid(nextGrid);
    setShifts(shiftsFor(nextGrid, cleared));
    setSettled(false); settledRef.current = false;
    const release = () => { if (!deadRef.current) { setSettled(true); settledRef.current = true; } };
    if (document.hidden) { release(); return; }
    requestAnimationFrame(() => requestAnimationFrame(release));
    later(() => { if (!settledRef.current) release(); }, 70);
  };

  // ── the three win effects, straight from the prototype's burstAt /
  //    shardsAt / popAt, including how long each lives ──────────────────
  const fxId = useRef(0);
  const [pulls, setPulls] = useState([]);          // sparks spiralling into a black hole
  const feedAt = (cell) => {
    const pnt = posOf(cell);
    const spawned = [];
    for (let k = 0; k < 9; k++) {
      spawned.push({ id: ++fxId.current, l: pnt.l, t: pnt.t, a: k * 40 + (k % 3) * 13, d: k * 70 + (k % 4) * 35 });
    }
    setPulls((ps) => [...ps, ...spawned]);
    later(() => setPulls((ps) => ps.filter((x) => !spawned.some((sp) => sp.id === x.id))), 1500);
  };
  // the amount stamped at the cluster's centroid - it leads the burst by a
  // breath and survives the refill, just over a second in all
  const plaqueAt = (cells, text) => {
    const id = ++fxId.current;
    const l = cells.reduce((a, c) => a + posOf(c).l, 0) / cells.length;
    const t = cells.reduce((a, c) => a + posOf(c).t, 0) / cells.length;
    setPlaques((ps) => [...ps, { id, l, t, text }]);
    later(() => setPlaques((ps) => ps.filter((x) => x.id !== id)), 1250);
  };
  const shardsAt = (i, colour) => {
    const p = posOf(i), id = ++fxId.current;
    // six shards, each thrown 60 degrees apart with a little scatter
    const items = Array.from({ length: 6 }, (_, k) => ({
      id: id + "_" + k, l: p.l, t: p.t, colour,
      a: Math.round(k * 60 + Math.random() * 30),
    }));
    setShards((sh) => [...sh, ...items]);
    later(() => setShards((sh) => sh.filter((x) => String(x.id).indexOf(id + "_") !== 0)), 600);
  };


  // One replay step, on the reference's measured beats: settle, a 250ms
  // breath, then sub-line + win rows + wiggle + the counter all at once
  // (600ms), a rest, the plaque, the burst, a hold with the holes open,
  // and only then the fast refill.
  const playSpin = useCallback(async (sp, isFree) => {
    for (let i = 0; i < sp.steps.length; i++) {
      if (deadRef.current) return;
      const step = sp.steps[i];
      if (i === 0) { ffRef.current = false; setFf(false); }  // each round earns its own skip
      droppingRef.current = true;
      setPhase("drop");
      setWinCells(new Set()); setPopCells(new Set()); setDevour(null); setConverge(null);
      if (i === 0) {
        // the previous board falls away first, ITS METEORS WITH IT — clearing
        // them any earlier let the symbol hidden beneath an orb pop into view
        // for a beat, which read as "an orb AND an element"
        await sweepOut();
        if (deadRef.current) return;
        setOrbs([]);
      }
      if (deadRef.current) return;
      setDropMode(i === 0 ? "open" : "tumble");
      place(step.grid, i === 0 ? null : sp.steps[i - 1].cleared);
      bnSfx.drop(i);
      {
        const fxMs = (ms) => Math.round(ms * (turboRef.current ? 0.38 : 1));
        if (i === 0) {
          for (let lc = 0; lc < COLS; lc++) {
            later(() => sample(`reel-land-${lc + 1}`, { v: 0.7 }), fxMs(lc * 70 + 430));
          }
          const scat = [];
          step.grid.forEach((id, sc) => { if (id === "scatter") scat.push(sc); });
          scat.sort((a, b) => (a % COLS) - (b % COLS));
          scat.slice(0, 5).forEach((cell, k) => {
            later(() => sample(`scatter-rise-${k + 1}`, { v: 0.9 }),
              fxMs((cell % COLS) * 70 + (ROWS - 1 - Math.floor(cell / COLS)) * 75 + 420));
          });
        } else {
          later(() => sample("tumble", { v: 0.7 }), fxMs(200));
        }
      }
      // opening rain: .45s fall + column and row stagger (~1.1s to the last
      // landing); a tumble refill is one fast 300ms drop, no stagger
      // the black hole rides the drop itself - it must already exist while
      // the board is falling, the cell it takes shows ONLY it, and it falls
      // on ITS COLUMN's beat, frozen into the orb so re-renders never
      // restart the entrance
      if (step.bomb) {
        const bc = step.bomb.cell % COLS, br = Math.floor(step.bomb.cell / COLS);
        // x2-x5 gold, x6-x15 cyan, x20-x50 violet, x100 white-red - the tier
        // decides the art, the size, the spin speed and the plaque
        const tier = step.bomb.mult >= 100 ? 4 : step.bomb.mult >= 20 ? 3 : step.bomb.mult >= 6 ? 2 : 1;
        const anim = i === 0
          ? `bnOrbIn calc(var(--fx,1) * .45s) cubic-bezier(.37,.12,.63,.88) calc(var(--fx,1) * ${bc * 70 + (ROWS - 1 - br) * 75}ms) both`
          : `bnOrbIn calc(var(--fx,1) * .3s) cubic-bezier(.5,0,.65,1.12) both`;
        setOrbs((o) => [...o, { ...step.bomb, anim, tier }]);
        bnSfx.orb(step.bomb.mult);
      }
      await sleep(i === 0 ? 1250 : 380);
      if (deadRef.current) return;
      // the skip covers the SPIN, not the round: once this board has landed,
      // the tumble choreography plays at its own pace again
      droppingRef.current = false;
      if (ffRef.current) { ffRef.current = false; setFf(false); }

      if (step.wins && step.wins.length) {
        await sleep(250);                  // the beat before anything reacts
        if (deadRef.current) return;
        const winning = new Set(step.wins.map((w) => w.id));
        const cells = [];
        step.grid.forEach((id, k) => { if (winning.has(id)) cells.push(k); });
        const top = [...step.wins].sort((a, b) => b.mult - a.mult)[0];
        setSubline({ count: top.count, id: top.id, amount: top.mult * lineBetRef.current });
        setPhase("win");
        setWinCells(new Set(cells));
        if (!sample(i === 0 ? "win-chain-1" : i < 3 ? "win-chain-3" : "win-chain-6", { v: 0.9 })) {
          bnSfx.tumble(Math.min(i, 6)); bnMusic.tumble(i);
        }
        // win rows dock at the top of the rail panel, newest first
        step.wins.forEach((w, wi) => {
          later(() => {
            if (deadRef.current) return;
            setPayRows((rows) => {
              const next = [...rows];
              const at = next.findIndex((x) => x.id === w.id);
              if (at >= 0) next[at] = { ...next[at], count: w.count, amount: next[at].amount + w.mult * lineBetRef.current };
              else next.unshift({ id: w.id, count: w.count, amount: w.mult * lineBetRef.current });
              return next.slice(0, 5);
            });
          }, 60 + wi * 130);
        });
        setRoundWin((w) => w + step.win);
        if (isFree) setFreeWin((w) => w + step.win);
        bnMusic.shimmer(600);
        await countTo(winDisplayRef.current + step.win * lineBetRef.current, 600);
        if (deadRef.current) return;
        await sleep(220);                  // the sub-line lingers, then a rest
        setSubline(null);
        if (deadRef.current) return;

        plaqueAt(cells, "+" + fmtMKD(step.win * lineBetRef.current));
        await sleep(70);                   // the plaque leads the burst
        const holes = isFree ? orbsRef.current : [];
        if (holes.length) {
          // IN THE FEATURE the winners do not burst - the nearest black hole
          // DRAGS THEM IN, spiralling, while sparks stream into every hole
          const hp = holes.map((o) => ({ c: o.cell % COLS, r: Math.floor(o.cell / COLS) }));
          const map = {};
          cells.forEach((k) => {
            const c = k % COLS, r = Math.floor(k / COLS);
            let best = hp[0], bd = 1e9;
            hp.forEach((h) => { const dd = (h.c - c) ** 2 + (h.r - r) ** 2; if (dd < bd) { bd = dd; best = h; } });
            map[k] = { dx: (best.c - c) * 105, dy: (best.r - r) * 105, dist: Math.sqrt(bd) };
          });
          setPhase("pop"); bnMusic.pop();
          setDevour(map);
          holes.forEach((o) => feedAt(o.cell));
          whoosh(700, 90, 0.3, 0.5);
          await sleep(700);
        } else {
          cells.slice(0, 12).forEach((k) => shardsAt(k, SPARK[step.grid[k]] || "#fff"));
          setPhase("pop");
          setPopCells(new Set(cells));
          await sleep(400);
        }
        if (deadRef.current) return;
        // the pop classes are NOT cleared here: clearing them snapped the
        // burst symbols back to full size for a beat before the refill -
        // "they don't pop to disappear". The next iteration clears them in
        // the same render that places the new grid.
        await sleep(170);                  // the holes sit open for a beat
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The trigger, staged like the reference: the comets coin-flip TOGETHER
  // while the win line finishes counting; two giant comets then collide into
  // a screen-covering wall of gems, the feature stage is swapped in behind
  // the cover, and the CONGRATULATIONS plaque grows in - empty first, text
  // after. The whole screen is the continue button, with a timeout so an
  // unattended cabinet is never stranded.
  const ceremony = async (count, bought, cometCells, roundTotal) => {
    if (cometCells.length) {
      setPhase("scatter");
      setWinCells(new Set(cometCells));
      sample("win-chain-6", { v: 0.95 });   // "you just won something" - the sting
      if (!sample("scatter", { v: 1 })) { bnSfx.chime(0); bnMusic.riser(1.5); }
      cometCells.forEach((c, k) => later(() => { if (!deadRef.current) shardsAt(c, "#ffd68a"); }, 250 + k * 180));
      await sleep(1100);
      if (deadRef.current) return;
      await countTo(roundTotal, 1000);     // the scatter pay ticks in while they pulse
      await sleep(250);
      if (deadRef.current) return;
      // THE MERGE: the comets leave their cells as streaks of energy, meet
      // at the centre, and become ONE great comet - and THAT is what
      // detonates into the feature
      setWinCells(new Set());
      setConverge(cometCells);             // their cells empty; the streaks fly
      whoosh(260, 950, 0.4, 0.65);
      await sleep(680);
      if (deadRef.current) return;
      setBigComet(true);
      bnSfx.orb(12);
      await sleep(850);                    // it swells, burning
      if (deadRef.current) return;
      setBigComet(false);
    }
    if (deadRef.current) return;
    {
      const r = panelRef.current && panelRef.current.getBoundingClientRect();
      setBurstO(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
    }
    setBurst(true); if (!sample("freespins-hit", { v: 1 })) bnSfx.boom();
    setFlash(1); later(() => setFlash(0), 500);
    later(() => {
      setStage(true);
      setFreeLeft(count); setFreeTotal(count);
    }, 240);
    await sleep(1250);                     // covered, then dispersing
    setBurst(false);
    if (deadRef.current) return;
    setPhase("intro"); setIntroOut(false);   // freespins-hit is still ringing
    setIntro({ count, bought });
    await new Promise((res) => { startedRef.current = res; later(res, 5200); });
    startedRef.current = null;
    setIntroOut(true);                     // fade + shrink to centre
    await sleep(380);
    setIntro(null); setIntroOut(false);
    await sleep(150);                      // a beat before the counter moves
  };



  // When a free-spin round stops tumbling, the meteors on screen add up and
  // multiply the ROUND's win: 500 with x5 and x3 on the field is 500 x 8 =
  // 4,000, and THAT is what the round pays. The equation is shown over the
  // reels and the WIN line climbs by the multiplied round right there - the
  // total is honest after every round instead of leaping at the very end.
  const meteorMath = async (sp) => {
    const gap = (sp.win - (sp.baseWin ?? 0)) * lineBetRef.current;
    if (gap <= 0.004) return;
    const feed = (sp.multiplier ?? 1) > 1 && (sp.baseWin ?? 0) > 0 && orbsRef.current.length > 0;
    if (feed) {
      // the winners were eaten tumble by tumble; the settlement is the
      // combined multiplier slamming in over the open board while every
      // hole pulses and feeds one last time
      orbsRef.current.forEach((o) => feedAt(o.cell));
      bnSfx.orb(sp.multiplier);
      setMultBadge({ mult: sp.multiplier, raw: fmtMKD((sp.baseWin ?? 0) * lineBetRef.current), total: fmtMKD(sp.win * lineBetRef.current) });
      bnMusic.bigWin();
      await sleep(350);
      if (deadRef.current) return;
    }
    await countTo(winDisplayRef.current + gap, feed ? 950 : 400);
    setFreeWin((w) => w + (sp.win - (sp.baseWin ?? 0)));
    if (feed) { await sleep(700); setMultBadge(null); }
  };

  const run = async (mode) => {
    if (spinning) return;
    const lineBet = Math.max(50, Math.min(bet, MAX_BET));
    const cost = mode === "buy" ? (table?.buyPrice ?? 100) : mode === "ante" ? (table?.anteCost ?? 1.25) : 1;
    if (balance < lineBet * cost) { setError("NOT ENOUGH CREDITS"); return; }
    ffRef.current = false; setFf(false);
    setError(""); setSpinning(true); setRoundWin(0); setSettledWin(null);
    winDisplayRef.current = 0; setWinDisplay(0); setSubline(null);
    // the win rows tear down one at a time, bottom-up, like the reference
    const rows = payRowsRef.current.length;
    for (let k = 0; k < rows; k++) later(() => setPayRows((r) => r.slice(0, -1)), 60 + k * 70);
    setFreeLeft(0); setFreeTotal(0); setFreeWin(0); setBigWin(null);
    hold(); if (!sample("spin", { v: 0.85 })) bnMusic.spin();

    const { ok, data } = await apiPost("/api/games/bonanza/spin",
      { betAmount: lineBet, ante: mode === "ante", buy: mode === "buy" });
    if (deadRef.current) return;
    if (!ok) { setError((data?.error || "Spin failed").toUpperCase()); setSpinning(false); setPhase("idle"); release(); return; }

    try {
      let first = 0;
      let comets = [];
      if (!data.buy) {
        await playSpin(data.rounds[0], false);
        first = 1;
        // comets survive every tumble and FALL with the gravity, so the
        // celebration must use the FINAL board's positions - spinning the
        // opening positions hit the wrong cells whenever a win tumbled first
        const steps0 = data.rounds[0] ? data.rounds[0].steps : [];
        const finalBoard = steps0.length ? steps0[steps0.length - 1].grid : [];
        comets = finalBoard.reduce((a, id, i) => (id === "scatter" ? [...a, i] : a), []);
      } else if (data.freeSpinsAwarded > 0) {
        // A purchase LANDS its trigger: a board with four comets rains in
        // exactly like a spin, and they celebrate before the feature opens.
        // Pure choreography - it pays nothing and decides nothing; every
        // payout in `data` is the server's.
        const cells = new Set();
        while (cells.size < 4) cells.add(Math.floor(Math.random() * CELLS));
        const pool = [...LOW, "sapphire", "emerald", "lunar", "ruby"];
        const board = Array.from({ length: CELLS }, (_, i) =>
          cells.has(i) ? "scatter" : pool[Math.floor(Math.random() * pool.length)]);
        comets = [...cells];
        setPhase("drop");
        await sweepOut();
        if (deadRef.current) return;
        setDropMode("open");
        place(board, null);
        bnSfx.drop(0);
        await sleep(1250);
        if (deadRef.current) return;
      }
      if (data.freeSpinsAwarded > 0) {
        // the intro and the counter announce the INITIAL award; retriggers
        // are celebrated when they actually land, +5 at a time - showing 20
        // up front spoiled the surprise and read as a bug
        const fs0 = table?.freeSpins ?? 10;
        await ceremony(fs0, !!data.buy, comets,
          data.buy ? winDisplayRef.current : data.rounds[0].win * lineBet);
        if (deadRef.current) return;
        let fsLeft = fs0;
        setFreeTotal(fs0);
        music("feature");                  // the feature has its own music
        for (let i = first; i < data.rounds.length; i++) {
          if (deadRef.current) return;
          setFreeLeft(fsLeft);                  // decrements BEFORE the reels move
          refreshHold();                        // the watchdog must outlive the feature
          await sleep(170);
          await playSpin(data.rounds[i], true);
          if (deadRef.current) return;
          await meteorMath(data.rounds[i]);
          if (deadRef.current) return;
          fsLeft--;
          if ((data.rounds[i].scatters ?? 0) >= 3) {
            // 3+ comets inside the feature: +5, flat, celebrated NOW
            fsLeft += 5;
            setFreeTotal((t) => t + 5);
            setRetrig(true);
            if (!sample("freespins-hit", { v: 0.85, cut: 2.2 })) bnSfx.fanfare();
            await sleep(1500);
            setRetrig(false);
          }
        }
        music("base");
        setFreeLeft(0);
      }

      // the authoritative total: reconciles float drift, and for multiplied
      // feature rounds the jump to the real payout counts up - it never snaps
      await countTo(data.payout, Math.abs(data.payout - winDisplayRef.current) > lineBet ? 900 : 150);
      const tier = tierOf(data.multiplier);
      if (tier) {
        // the amount COUNTS from zero - the tap (or space) skips to the total
        const dur = data.multiplier >= COSMIC ? 3600 : data.multiplier >= MEGA ? 2800 : 2000;
        skipRef.current = false;
        setBigWin({ label: tier, amount: fmtMKD(0) });
        const stung = sample(tier === "COSMIC WIN" ? "cosmicwin" : "megawin", { v: 1 });
        if (tier === "COSMIC WIN" || !stung) { bnSfx.fanfare(); bnMusic.bigWin(); }
        bnMusic.tally(dur / 1000);
        const t0 = performance.now();
        for (;;) {
          if (deadRef.current) return;
          const k = Math.min(1, (performance.now() - t0) / dur);
          const eased = k * k * (3 - 2 * k);
          setBigWin({ label: tier, amount: fmtMKD(skipRef.current ? data.payout : data.payout * eased) });
          if (k >= 1 || skipRef.current) break;
          await sleep(45);
        }
        setBigWin({ label: tier, amount: fmtMKD(data.payout), done: true });
        bnSfx.win();
        await sleep(1300);
        setBigWin(null);
      } else if (data.payout > 0) {
        bnSfx.win();         // the WIN line keeps showing it - no dead air
      }
      setSettledWin(data.payout);
    } finally {
      if (!deadRef.current) {
        setSpinning(false); setPhase("idle"); setWinCells(new Set()); setPopCells(new Set());
        setSubline(null); setBurst(false); setStage(false); music("base");
      }
      release();
    }
  };

  // ── derived ─────────────────────────────────────────────────────────────
  const lineBet = Math.max(50, Math.min(bet, MAX_BET));
  lineBetRef.current = lineBet;
  payRowsRef.current = payRows;
  orbsRef.current = orbs;
  const anteCost = table?.anteCost ?? 1.25;
  const buyPrice = table?.buyPrice ?? 100;
  const stake = lineBet * (ante ? anteCost : 1);
  const idle = !spinning;
  const canSpin = idle && balance >= stake;
  const canBuy = idle && balance >= lineBet * buyPrice;
  const stepBet = (d) => { bnSfx.click(); setBet((b) => Math.max(50, Math.min(MAX_BET, b + d * 50))); };
  const inFeature = freeLeft > 0 || !!intro;
  const orbTotal = orbs.reduce((a, o) => a + o.mult, 0);

  const centre = error ? { text: error, tone: "err" }
    : spinning ? { text: "GOOD LUCK", tone: "" }
      : { text: "SPIN TO WIN", tone: "" };

  bigRef.current = !!bigWin;
  runRef.current = () => {
    if (bigRef.current) { skipRef.current = true; return; }
    if (startedRef.current) { const go = startedRef.current; startedRef.current = null; go(); return; }
    if (spinning) { if (droppingRef.current) { ffRef.current = true; setFf(true); } return; }  // skip covers the spin only
    if (rules || buyAsk) return;
    run(ante ? "ante" : "base");
  };

  // The board subtree is ~200 elements; memoising it means the 33ms counter
  // ticks and the staggered pay-row updates re-render the console without
  // rebuilding thirty movers each time. Everything the cells read is a dep.
  const orbCells = useMemo(() => new Set(orbs.map((o) => o.cell)), [orbs]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cellNodes = useMemo(() => grid.map((id, i) => {
                  const col = i % COLS, row = Math.floor(i / COLS);
                  // a meteor OWNS its cell - nothing else is drawn there
                  if (!id || orbCells.has(i) || (converge && converge.includes(i))) return <div className="bn-cell" key={i} />;
                  const isWin = winCells.has(i), isPop = popCells.has(i);
                  const sh = shifts[i] || 0;
                  const displaced = !settled && sh > 0;
                  // the MOVER carries the fall; the ART carries the win/pop.
                  // Keeping them apart is what lets a symbol pulse while the
                  // board is still settling.
                  // NOTHING FADES. Symbols are solid at all times; the reel
                  // mask is what hides them before they arrive and after they
                  // leave, exactly like a real reel. Fading was only ever a
                  // workaround for not having the mask.
                  // Three falls, all measured off the reference:
                  // EXIT - bottom-first within a column, columns left to
                  // right, each symbol accelerating off the bottom edge.
                  // OPENING - a rain: bottom row lands first, each row 75ms
                  // later, columns 70ms apart, near-constant speed.
                  // TUMBLE - one fast 300ms drop, no stagger, a whisper of
                  // bounce at the end.
                  // the stagger delay lives INSIDE the transition shorthand:
                  // React (rightly) refuses to mix the shorthand with a
                  // separate transitionDelay across re-renders
                  // every duration and delay is scaled by --fx, which the
                  // bn-fast root class drops to .38 - turbo now speeds the
                  // PICTURE, not just the timers, so the fall always finishes
                  const dv = devour && devour[i];
                  const move = dv ? {
                    transform: `translate3d(${dv.dx}%, ${dv.dy}%, 0) scale(.04) rotate(220deg)`,
                    // stagger capped so even the farthest symbol finishes
                    // inside the feed window - the far ones used to still be
                    // mid-flight (or unmoved) when the next board landed
                    transition: `transform calc(var(--fx,1) * .45s) cubic-bezier(.6,-.1,.9,.5) calc(var(--fx,1) * ${Math.min(Math.round(dv.dist * 45), 180)}ms)`,
                    willChange: "transform",
                  } : exiting ? {
                    transform: "translate3d(0, 672%, 0)",
                    transition: `transform calc(var(--fx,1) * .45s) cubic-bezier(.55,0,.85,.4) calc(var(--fx,1) * ${col * 55 + (ROWS - 1 - row) * 60}ms)`,
                    willChange: "transform",
                  } : {
                    // 105% per row ≈ cell + grid gap, so a survivor's start
                    // position is exactly where it stood before the tumble
                    transform: displaced ? `translate3d(0, ${-sh * 105}%, 0)` : "translate3d(0,0,0)",
                    transition: displaced ? "none"
                      : dropMode === "open"
                        ? `transform calc(var(--fx,1) * .45s) cubic-bezier(.37,.12,.63,.88) calc(var(--fx,1) * ${col * 70 + (ROWS - 1 - row) * 75}ms)`
                        : "transform calc(var(--fx,1) * .3s) cubic-bezier(.5,0,.65,1.12)",
                    // promoted only while it is actually moving — thirty
                    // permanently-promoted layers is real memory on a weak GPU
                    willChange: settled ? "auto" : "transform",
                  };
                  const cls = "bn-sym"
                    + (isWin ? " bn-win" : "")
                    + (isPop ? " bn-pop" : "")
                    + (id === "scatter" ? " scatter" : LOW.includes(id) ? " low" : " high");
                  return (
                    <div className={"bn-cell" + (isWin || isPop ? " lifted" : "")} key={i}>
                      <div className="bn-mover" style={move}>
                        {id === "scatter"
                          ? <span className={cls} style={{ animationDelay: `${-(i % 12) * 96}ms` }} role="img" aria-label="comet" />
                          : <img src={src(id)} alt={NAMES[id]} draggable={false} className={cls} />}
                        {isWin && phase !== "scatter" && <span className="bn-coreflash" />}
                      </div>
                    </div>
                  );
                }),
    [grid, shifts, settled, exiting, winCells, popCells, dropMode, phase, orbCells, devour, converge]);

  return (
    <div className={"bn-root" + (shake ? " bn-shake" : "") + (ff ? " bn-snap" : turbo || spaceTurbo ? " bn-fast" : "")}>
      <NovaSky />
      <div className={"bn-stage" + (stage ? " on" : "")} aria-hidden="true" />
      <div className="bn-flash" style={{ opacity: flash }} />

      <div className="bn-play">
        {/* ── left rail ── */}
        <div className="bn-rail-l">
          {inFeature ? (
          <div className="bn-fspanel">
            <span className="bn-fspanel-kicker">FREE SPINS</span>
            {/* while the congrats plaque is up the loop has not started yet,
                so the award count stands in for the live counter */}
            <b className="bn-fspanel-count">{freeLeft || intro?.count || 0}</b>
            <span className="bn-fspanel-sub">LEFT{freeTotal ? ` OF ${freeTotal}` : ""}</span>
            {freeWin > 0 && <span className="bn-fspanel-win">{fmtMKD(freeWin * lineBet)}</span>}
          </div>
          ) : (<>
          <button type="button" onClick={() => { bnSfx.click(); setBuyAsk(true); }} disabled={!canBuy} className="bn-buy">
            <span className="bn-sheen" />
            <span className="bn-buy-kicker">
              <svg viewBox="0 0 24 24" fill="#ffd76b"><path d="M12 1.6l2.4 6.3 6.6.4-5.1 4.3 1.7 6.5L12 15.5l-5.6 3.6 1.7-6.5L3 8.3l6.6-.4z" /></svg>BUY
            </span>
            <span className="bn-buy-title">FREE SPINS</span>
            <span className="bn-buy-price">{fmtMKD(lineBet * buyPrice)}</span>
          </button>

          <div className={"bn-ante" + (ante ? " on" : "")}>
            <span className="bn-ante-gloss" />
            <span className="bn-ante-label">BET</span>
            <span className="bn-ante-bet">{fmtMKD(stake)}</span>
            <span className="bn-ante-rule" />
            <span className="bn-ante-title">DOUBLE<br />CHANCE TO<br />WIN FEATURE</span>
            <button type="button" onClick={() => { if (idle) { if (!sample("toggle", { v: 0.8 })) bnSfx.click(); setAnte((a) => !a); } }}
              className="bn-ante-toggle" disabled={!idle} aria-pressed={ante}>
              <span className="bn-track"><span className="bn-knob" /></span>
              <span className="bn-ante-state">{ante ? "ON" : "OFF"}</span>
            </button>
          </div>
          </>)}
          {/* what paid this round — the reference keeps a panel like this
              under its two buttons, and without it the rail reads empty */}
          <div className="bn-paid">
            {payRows.length === 0 ? (
              <div className="bn-paid-empty">NO WIN YET</div>
            ) : payRows.map((row) => (
              <div className="bn-paid-row" key={row.id}>
                <b>{row.count}</b>
                <img src={src(row.id)} alt="" />
                <span>{fmtMKD(row.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── centre ── */}
        <div className="bn-centre">
          <div className="bn-cabinet">
            {/* base game: the text changes on the animation's own loop point,
                where opacity is 0. The feature holds ONE static message, the
                way the reference's marquee goes still. */}
            {inFeature ? (
              <div className="bn-marquee static">
                <span className="bn-lamp l" /><span className="bn-lamp r" />
                BLACK HOLES MULTIPLY THE FINAL TUMBLE WIN
              </div>
            ) : (
              <div className="bn-marquee"
                onAnimationIteration={() => setMarquee((n) => (n + 1) % MARQUEE.length)}>
                <span className="bn-lamp l" /><span className="bn-lamp r" />
                {MARQUEE[marquee]}
              </div>
            )}
            <span className="bn-dia tl" /><span className="bn-dia tr" /><span className="bn-dia bl" /><span className="bn-dia br" />

            <div ref={panelRef} className={"bn-panel" + (inFeature ? " feature" : phase === "win" || phase === "pop" ? " winning" : "") + (devour || multBadge ? " mathing" : "")}>
              {/* effect layers are clipped; the grid is NOT, or the drop would
                  be guillotined at the panel edge */}
              <div className="bn-fx">
                <span className="bn-dividers" />
                <span className="bn-tint" />
                <span className="bn-panel-sheen" />
              </div>

              <div className="bn-grid">
                {cellNodes}
                {/* plaques and shards sit over the grid */}
                {plaques.map((pq) => (
                  <span className="bn-plaque" key={pq.id} style={{ left: `${pq.l}%`, top: `${pq.t}%` }}>{pq.text}</span>
                ))}
                {converge && converge.map((cell, k) => {
                  const cp = posOf(cell);
                  return (
                    <span key={"fly" + k} className="bn-fly" style={{
                      "--l0": `${cp.l}%`, "--t0": `${cp.t}%`,
                      animation: `bnComet .5s steps(12, jump-none) infinite, bnFly .62s cubic-bezier(.55,0,.85,.5) ${k * 90}ms both`,
                    }} />
                  );
                })}
                {converge && <span className="bn-flycore" aria-hidden="true" />}
                {bigComet && <span className="bn-bigcomet" aria-hidden="true" />}
                {pulls.map((u) => (
                  <span className="bn-pull" key={u.id}
                    style={{ left: `${u.l}%`, top: `${u.t}%`, "--a": `${u.a}deg`, animationDelay: `${u.d}ms` }} />
                ))}
                {shards.map((sh) => (
                  <span className="bn-shard-origin" key={sh.id} style={{ left: `${sh.l}%`, top: `${sh.t}%` }}>
                    <span className="bn-shard" style={{ background: sh.colour, "--a": `${sh.a}deg` }} />
                  </span>
                ))}
                {/* ABSOLUTE, not a grid child: an explicitly-placed grid item
                    makes the 30 auto-placed cells flow AROUND it - the board
                    grew a sixth row every time a meteor landed */}
                {orbs.map((o, i) => {
                  const p = posOf(o.cell);
                  const oc = o.cell % COLS, orw = Math.floor(o.cell / COLS);
                  // leaving: the hole rides the SAME bottom-first column wave
                  // as the symbols - it left way ahead of its board before
                  return (
                    <span className={"bn-orb t" + (o.tier || 1)} key={i}
                      style={exiting ? {
                        // an ANIMATION, not a transition: Chrome will not
                        // transition away from an animation-held transform,
                        // which made the hole vanish the instant the sweep
                        // began instead of riding its column out
                        left: `${p.l}%`, top: `${p.t}%`,
                        animation: `bnOrbOut calc(var(--fx,1) * .45s) cubic-bezier(.55,0,.85,.4) calc(var(--fx,1) * ${oc * 55 + (ROWS - 1 - orw) * 60}ms) both`,
                      } : { left: `${p.l}%`, top: `${p.t}%`, animation: o.anim }}>
                      <img src={GEM + "blackhole-" + (o.tier || 1) + ".png"} alt="" />
                      <b>×{o.mult}</b>
                    </span>
                  );
                })}
              </div>

              {retrig && (
                <div className="bn-retrig">
                  <span className="bn-retrig-plus">+5</span>
                  <span className="bn-retrig-label">FREE SPINS</span>
                </div>
              )}
              {multBadge && (
                <div className="bn-multbadge">
                  <span className="bn-multbadge-raw">{multBadge.raw}</span>
                  <span className="bn-multbadge-x">×{multBadge.mult}</span>
                  <span className="bn-multbadge-eq">=</span>
                  <span className="bn-multbadge-total">{multBadge.total}</span>
                </div>
              )}
              {bigWin && (
                <div className="bn-bigwin" onClick={() => { skipRef.current = true; }}>
                  <span className="bn-bigwin-halo" />
                  <div className="bn-intro-drift" aria-hidden="true">
                    {BURST.slice(0, 6).map((g, k) => (
                      <img key={k} src={src(g)} alt="" style={{
                        left: `${k * 16 + 6}%`,
                        animationDelay: `${k * 0.5}s`,
                        animationDuration: `${4.5 + (k % 3)}s`,
                      }} />
                    ))}
                  </div>
                  <div className="bn-bigwin-label">{bigWin.label}</div>
                  <div className={"bn-bigwin-amount" + (bigWin.done ? " slam" : "")}>{bigWin.amount}</div>
                  <div className="bn-bigwin-skip">TAP TO SKIP</div>
                </div>
              )}
              {intro && (
                <div className={"bn-intro" + (introOut ? " out" : "")}
          onClick={() => { bnSfx.click(); if (startedRef.current) startedRef.current(); }}>
          <div className="bn-intro-drift" aria-hidden="true">
            {BURST.slice(0, 8).map((g, k) => (
              <img key={k} src={src(g)} alt="" style={{
                left: `${k * 12.5 + 4}%`,
                animationDelay: `${k * 0.65}s`,
                animationDuration: `${5.5 + (k % 3) * 1.3}s`,
              }} />
            ))}
          </div>
          <div className="bn-intro-plaque">
            <span className="bn-intro-sheen" />
            <div className="bn-intro-text">
              <div className="bn-intro-kicker">{intro.bought ? "FEATURE PURCHASED" : "CONGRATULATIONS"}</div>
              <div className="bn-intro-sub">YOU HAVE WON</div>
              <div className="bn-intro-count">{intro.count}</div>
              <div className="bn-intro-title">FREE SPINS</div>
              <div className="bn-intro-press">PRESS ANYWHERE TO CONTINUE</div>
            </div>
          </div>
        </div>
      )}
            </div>

            <div className="bn-pills">
              {orbTotal > 0 && (
                <div className="bn-pill mx"><span className="k">BLACK HOLES</span><span className="v">×{orbTotal}</span></div>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* ── console ── */}
      <div className="bn-console">
        <div className="bn-console-content">
          <div className="bn-icons">
            <IconBtn label="Lobby" onClick={() => { bnSfx.click(); navigate("/"); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            </IconBtn>
            {/* INFO leads the cluster; turbo and sound stack beside it, small */}
            <button type="button" onClick={() => { bnSfx.click(); setRules(true); }}
              className="bn-info" aria-label="Info" title="Info">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.6" /></svg>
            </button>
            <div className="bn-minicol">
              <button type="button" onClick={() => { bnSfx.click(); setTurbo((t) => !t); }}
                className={"bn-mini" + (turbo ? " on" : "")} aria-pressed={turbo} aria-label="Turbo" title="Turbo">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z" /></svg>
              </button>
              <button type="button" onClick={() => { cycleVol(); bnSfx.click(); }}
                className="bn-mini" aria-label={"Sound " + VOL_LABELS[vol]} title={"Sound " + VOL_LABELS[vol]}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                  <path d="M4 9v6h3.5L12 19V5L7.5 9H4z" fill="currentColor" stroke="none" />
                  <path d="M16 9.5a4 4 0 0 1 0 5" opacity={vol >= 2 ? 1 : 0.15} />
                  <path d="M18.6 7a7.5 7.5 0 0 1 0 10" opacity={vol >= 3 ? 1 : 0.15} />
                </svg>
              </button>
            </div>
          </div>

          <div className="bn-meters">
            <div><span>CREDIT</span><b className="cr">{fmtMKD(balance)}</b></div>
            <div><span>BET</span><b className="be">{fmtMKD(stake)}</b></div>
          </div>

          {/* the win lives here in the console, ticking upward; beneath it the
              "N× symbol PAYS" sub-line, exactly as the reference stages it */}
          {winDisplay > 0.004 ? (
            <div className="bn-winwrap">
              <div className="bn-winline">
                <span className="bn-winline-label">WIN</span>
                <span className="bn-winline-amount">{fmtMKD(winDisplay)}</span>
              </div>
              {subline && (
                <div className="bn-subline">
                  <b>{subline.count}×</b>
                  <img src={src(subline.id)} alt="" />
                  <span>PAYS {fmtMKD(subline.amount)}</span>
                </div>
              )}
              {!subline && freeLeft > 0 && <div className="bn-subline fs">FREE SPINS LEFT {freeLeft}</div>}
            </div>
          ) : (
            <div className={"bn-centreline " + centre.tone}>{centre.text}</div>
          )}

          <div className="bn-spin-cluster">
            <button type="button" onClick={() => stepBet(-1)} disabled={!idle || lineBet <= 50} className="bn-step minus" aria-label="Lower bet">−</button>
            <button type="button"
              onClick={() => { if (spinning) { if (droppingRef.current) { ffRef.current = true; setFf(true); } } else run(ante ? "ante" : "base"); }}
              disabled={!canSpin && !spinning}
              className={"bn-spin" + (spinning ? " busy" : "")} aria-label={spinning ? "Skip" : "Spin"}>
              <span className="bn-spin-ring" />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-3.2-6.9" /><path d="M21 3v6h-6" />
              </svg>
              {freeLeft > 0 && <span className="bn-fs-badge">{freeLeft} FREE</span>}
            </button>
            <button type="button" onClick={() => stepBet(1)} disabled={!idle || lineBet >= MAX_BET} className="bn-step plus" aria-label="Raise bet">+</button>
          </div>
        </div>
      </div>

      {burst && (
        <div className="bn-burst" aria-hidden="true"
          style={burstO ? { "--ox": `${burstO.x}px`, "--oy": `${burstO.y}px` } : undefined}>
          {BURST.map((g, k) => (
            <img key={k} src={src(g)} alt="" className="bn-burst-gem"
              style={{ "--a": `${k * 24 + 7}deg`, animationDelay: `${60 + (k % 5) * 40}ms` }} />
          ))}
          <span className="bn-burst-flash" />
        </div>
      )}


      {buyAsk && (
        <div className="bn-modal" onClick={() => setBuyAsk(false)}>
          <div className="bn-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="bn-confirm-title">BUY FREE SPINS</div>
            <div className="bn-confirm-price">{fmtMKD(lineBet * buyPrice)}</div>
            <div className="bn-confirm-sub">{table?.freeSpins ?? 10} FREE SPINS · BLACK HOLE MULTIPLIERS</div>
            <div className="bn-confirm-ask">ARE YOU SURE?</div>
            <div className="bn-confirm-row">
              <button type="button" className="bn-confirm-no"
                onClick={() => { bnSfx.click(); setBuyAsk(false); }}>CANCEL</button>
              <button type="button" className="bn-confirm-yes"
                onClick={() => { if (!sample("buy-freespins", { v: 1 })) bnSfx.click(); setBuyAsk(false); run("buy"); }}>YES</button>
            </div>
          </div>
        </div>
      )}

      {rules && <RulesModal onClose={() => setRules(false)} table={table} />}
    </div>
  );
}
