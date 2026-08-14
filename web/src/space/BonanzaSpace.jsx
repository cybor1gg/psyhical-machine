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
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost, apiGet } from "../api";
import { useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import { beep, sfx, whoosh, useVol, cycleVol, VOL_LABELS, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import { useMaxBet } from "./limits";
import "./space.css";
import "./bonanza.css";

const COLS = 6, ROWS = 5, CELLS = COLS * ROWS;
const GEM = "/space/gems/";
const LOW = ["citrine", "amethyst", "rose", "jade"];
const NAMES = {
  citrine: "CITRINE", amethyst: "AMETHYST", rose: "ROSE", jade: "JADE",
  sapphire: "SAPPHIRE", emerald: "EMERALD", lunar: "LUNAR", ruby: "RUBY", scatter: "COMET",
};
const src = (id) => GEM + (id === "scatter" ? "comet" : id) + ".png";
// shard colour per symbol — the debris should be the colour of the thing that broke
const SPARK = {
  citrine: "#ffc44a", amethyst: "#b074ff", rose: "#ff7eb2", jade: "#56e0a0",
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
    // one connected block from just above the mask
    const fresh = ROWS - keep.length;
    for (let r = ROWS - 1, k = 0; r >= 0; r--, k++) {
      const i = r * COLS + c;
      shifts[i] = k < keep.length ? r - keep[k] : fresh + 1.4;
    }
  }
  return shifts;
}

const MARQUEE = [
  "SYMBOLS PAY ANYWHERE ON THE FIELD",
  "8 OR MORE OF A KIND PAYS",
  "4 COMETS WIN FREE SPINS",
  "WINS TUMBLE — THEY KEEP PAYING",
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
  orb(m = 2) { beep("sawtooth", 210, 70, 0.13, 0.34); beep("sine", 700 + Math.min(m, 40) * 22, 1500, 0.1, 0.22, 0.05); },
  fanfare() { sfx.cash(); beep("triangle", 520, 1200, 0.3, 0.3, 0.06); beep("triangle", 660, 1500, 0.32, 0.28, 0.14); },
  click: sfx.click,
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



function RulesModal({ onClose, table }) {
  const rows = table ? Object.entries(table.pays) : [];
  return (
    <div onClick={onClose} className="bn-modal">
      <div onClick={(e) => e.stopPropagation()} className="bn-modal-box">
        <div className="bn-modal-title">HOW TO PLAY</div>
        <div className="bn-rules">
          <div>◆ No lines. A symbol pays when <b>8 or more</b> of it land anywhere on the field.</div>
          <div>◆ Winners burst, the rest fall into the gaps and new symbols fill the top — a <b>tumble</b>. It repeats while wins keep landing, and every tumble adds to the same round.</div>
          <div>◆ <b>4+ comets</b> pay a bonus and award {table?.freeSpins ?? 10} free spins. 3 more inside the feature add 5.</div>
          <div>◆ In free spins, <b>meteors</b> land on the field carrying multipliers. They never pay on their own and never tumble — when the tumbling stops, every meteor is <b>added together</b> and that one total multiplies the <b>whole spin&apos;s win</b>.</div>
          <div className="bn-eg">e.g. a spin tumbles to 6× with meteors of ×15 and ×2 → 15 + 2 = ×17, so it pays 6 × 17 = <b>102×</b>.</div>
          <div>◆ <b>DOUBLE CHANCE</b> costs {Math.round(((table?.anteCost ?? 1.25) - 1) * 100)}% more and doubles how often comets appear.</div>
          <div>◆ <b>BUY FREE SPINS</b> goes straight to the feature for {(table?.buyPrice ?? 68).toFixed(0)}× your bet.</div>
        </div>
        {rows.length > 0 && (
          <div className="bn-paytable">
            <div className="bn-th">SYMBOL</div><div className="bn-th r">8–9</div><div className="bn-th r">10–11</div><div className="bn-th r">12+</div>
            {rows.map(([id, tiers]) => (
              <div key={id} style={{ display: "contents" }}>
                <div className="bn-payrow"><img src={src(id)} alt="" width={26} height={26} />{NAMES[id] || id}</div>
                {tiers.map((v, i) => <div key={i} className="bn-payval">{v.toFixed(2)}×</div>)}
              </div>
            ))}
          </div>
        )}
        {table?.bombs && (
          <>
            <div className="bn-sub">METEOR MULTIPLIERS · {Math.round((table.bombChance ?? 0) * 100)}% OF FREE-SPIN DROPS CARRY ONE</div>
            <div className="bn-bombtable">
              {table.bombs.map((b) => (
                <div key={b.mult} className="bn-bombcell"><b>×{b.mult}</b><span>{(b.chance * 100).toFixed(1)}%</span></div>
              ))}
            </div>
          </>
        )}
        <button type="button" onClick={onClose} className="bn-gotit">GOT IT</button>
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
  const [rings, setRings] = useState([]);
  const [shards, setShards] = useState([]);
  const [phase, setPhase] = useState("idle");     // idle | drop | win | pop | intro
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

  const deadRef = useRef(false);
  const heldRef = useRef(false);
  const timers = useRef([]);
  const spaceRef = useRef(false);
  const turboRef = useRef(false);
  turboRef.current = turbo || spaceRef.current;
  const startedRef = useRef(null);                // resolved when START is pressed
  const lineBetRef = useRef(50);                  // the popups need the stake mid-replay

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  const sleep = (ms) => new Promise((res) => later(res, Math.round(ms * (turboRef.current ? 0.35 : 1))));
  const hold = () => { if (!heldRef.current) { heldRef.current = true; holdBalance(); } };
  const release = () => { if (heldRef.current) { heldRef.current = false; releaseBalance(); } };

  useEffect(() => {
    armAmbientOnGesture(); startAmbient();
    apiGet("/api/games/bonanza/table").then(({ ok, data }) => { if (ok) setTable(data); });
    const down = (e) => { if (e.code === "Space") { e.preventDefault(); spaceRef.current = true; } };
    const up = (e) => { if (e.code === "Space") spaceRef.current = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => {
      deadRef.current = true;
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up);
      timers.current.forEach(clearTimeout); release();
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
    if (!gridRef.current.some(Boolean)) return;
    setExiting(true);
    // .52s of travel plus five columns of 70ms — anything shorter cuts the
    // exit off part-way, which is what made a spin look like turbo
    await sleep(940);
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
  const ringAt = (i, colour, size = 104) => {
    const p = posOf(i), id = ++fxId.current;
    setRings((r) => [...r, { id, l: p.l, t: p.t, size, colour }]);
    later(() => setRings((r) => r.filter((x) => x.id !== id)), 620);
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


  const playSpin = useCallback(async (sp, isFree) => {
    for (let i = 0; i < sp.steps.length; i++) {
      if (deadRef.current) return;
      const step = sp.steps[i];
      setPhase("drop");
      setWinCells(new Set()); setPopCells(new Set());
      if (i === 0) await sweepOut();       // the previous board falls away first
      if (deadRef.current) return;
      // survivors slide into the gaps; only new symbols come from above
      place(step.grid, i === 0 ? null : sp.steps[i - 1].cleared);
      bnSfx.drop(i);
      await sleep(i === 0 ? 1300 : 1000);  // .62s fall + column stagger + a beat
      if (deadRef.current) return;

      if (step.bomb) { setOrbs((o) => [...o, step.bomb]); bnSfx.orb(step.bomb.mult); }
      if (step.wins && step.wins.length) {
        // WIN: every cell of every winning symbol pulse-shakes with a white
        // core flash, a rising +amount leaves the first cell of each symbol,
        // and the two biggest throw a shockwave ring.
        const winning = new Set(step.wins.map((w) => w.id));
        const cells = [];
        step.grid.forEach((id, k) => { if (winning.has(id)) cells.push(k); });
        setPhase("win");
        setWinCells(new Set(cells));
        bnSfx.tumble(Math.min(i, 6));
        // a ring on the first cell of each winning symbol — no scattered
        // "+amount" labels any more, the board shows ONE big number instead
        step.wins.forEach((w, wi) => {
          const idx = step.grid.findIndex((id) => id === w.id);
          if (idx >= 0 && wi < 2) ringAt(idx, "rgba(140,255,205,.85)", 104);
        });
        // the running total, big, over the board
        setRoundWin((w) => w + step.win);
        if (isFree) setFreeWin((w) => w + step.win);
        // the rail lists what paid — one row at a time, as each lands,
        // not the whole step at once
        step.wins.forEach((w, wi) => {
          later(() => {
            if (deadRef.current) return;
            setPayRows((rows) => {
              const next = [...rows];
              const at = next.findIndex((x) => x.id === w.id);
              if (at >= 0) next[at] = { ...next[at], count: w.count, amount: next[at].amount + w.mult * lineBetRef.current };
              else next.push({ id: w.id, count: w.count, amount: w.mult * lineBetRef.current });
              return next.slice(0, 5);
            });
          }, 200 + wi * 300);
        });
        await sleep(1050);                 // hold it long enough to read
        if (deadRef.current) return;

        // EXPLODE, then the next board comes — never both at once
        cells.slice(0, 12).forEach((k) => shardsAt(k, SPARK[step.grid[k]] || "#fff"));
        setPhase("pop");
        setPopCells(new Set(cells));
        await sleep(420);
        if (deadRef.current) return;
        setWinCells(new Set()); setPopCells(new Set());
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Comets burst one at a time, then a boom, a flash and the modal.
  // START skips ahead rather than gating: the round is already settled on the
  // server, so an unattended cabinet must never be able to strand it.
  const ceremony = async (count, bought, cometCells) => {
    if (!bought && cometCells.length) {
      for (let i = 0; i < cometCells.length; i++) {
        if (deadRef.current) return;
        setWinCells(new Set(cometCells));
        bnSfx.chime(i); quake(240);
        await sleep(260);
        setWinCells(new Set());
        await sleep(90);
      }
    }
    bnSfx.boom(); quake(620);
    setFlash(1); later(() => setFlash(0), 460);
    await sleep(360);
    if (deadRef.current) return;
    setPhase("intro");
    setIntro({ count, bought });
    await new Promise((res) => { startedRef.current = res; later(res, 2600); });
    startedRef.current = null;
    setIntro(null);
  };



  const run = async (mode) => {
    if (spinning) return;
    const lineBet = Math.max(50, Math.min(bet, MAX_BET));
    const cost = mode === "buy" ? (table?.buyPrice ?? 68.15) : mode === "ante" ? (table?.anteCost ?? 1.25) : 1;
    if (balance < lineBet * cost) { setError("NOT ENOUGH CREDITS"); return; }
    setError(""); setSpinning(true); setRoundWin(0); setSettledWin(null); setOrbs([]); setPayRows([]);
    setFreeLeft(0); setFreeTotal(0); setFreeWin(0); setBigWin(null);
    hold(); bnSfx.click();

    const { ok, data } = await apiPost("/api/games/bonanza/spin",
      { betAmount: lineBet, ante: mode === "ante", buy: mode === "buy" });
    if (deadRef.current) return;
    if (!ok) { setError((data?.error || "Spin failed").toUpperCase()); setSpinning(false); setPhase("idle"); release(); return; }

    try {
      let first = 0;
      if (!data.buy) {
        await playSpin(data.rounds[0], false);
        first = 1;
      }
      if (data.freeSpinsAwarded > 0) {
        const opening = data.rounds[0] && data.rounds[0].steps[0] ? data.rounds[0].steps[0].grid : [];
        const comets = data.buy ? [] : opening.reduce((a, id, i) => (id === "scatter" ? [...a, i] : a), []);
        await ceremony(data.freeSpinsAwarded, !!data.buy, comets);
        if (deadRef.current) return;
        setFreeTotal(data.rounds.length - first);
        for (let i = first; i < data.rounds.length; i++) {
          if (deadRef.current) return;
          setFreeLeft(data.rounds.length - i);
          setOrbs([]);
          await playSpin(data.rounds[i], true);
        }
        setFreeLeft(0);
      }

      const tier = tierOf(data.multiplier);
      if (tier) {
        setBigWin({ label: tier, amount: fmtMKD(data.payout) });
        bnSfx.fanfare(); quake(900);
        await sleep(2400);
        setBigWin(null);
      } else if (data.payout > 0) {
        bnSfx.win();
        await sleep(1500);   // let the number sit before it clears
      }
      setSettledWin(data.payout);
    } finally {
      if (!deadRef.current) { setSpinning(false); setPhase("idle"); setWinCells(new Set()); setPopCells(new Set()); }
      release();
    }
  };

  // ── derived ─────────────────────────────────────────────────────────────
  const lineBet = Math.max(50, Math.min(bet, MAX_BET));
  lineBetRef.current = lineBet;
  const anteCost = table?.anteCost ?? 1.25;
  const buyPrice = table?.buyPrice ?? 68.15;
  const stake = lineBet * (ante ? anteCost : 1);
  const idle = !spinning;
  const canSpin = idle && balance >= stake;
  const canBuy = idle && balance >= lineBet * buyPrice;
  const stepBet = (d) => { bnSfx.click(); setBet((b) => Math.max(50, Math.min(MAX_BET, b + d * 50))); };
  const inFeature = freeLeft > 0 || !!intro;
  const orbTotal = orbs.reduce((a, o) => a + o.mult, 0);

  const centre = error ? { text: error, tone: "err" }
    : settledWin != null && settledWin > 0 ? { text: `WIN ${fmtMKD(settledWin)}`, tone: "win" }
      : roundWin > 0 ? { text: `WIN ${fmtMKD(roundWin * lineBet)}`, tone: "win" }
      : spinning ? { text: "GOOD LUCK", tone: "" }
        : { text: "SPIN TO WIN", tone: "" };

  return (
    <div className={"bn-root" + (shake ? " bn-shake" : "")}>
      <NovaSky />
      <div className="bn-flash" style={{ opacity: flash }} />

      <div className="bn-play">
        {/* ── left rail ── */}
        <div className="bn-rail-l">
          <div className="bn-logo">
            <div className="bn-plate gold">STAR</div>
            <div className="bn-plate violet">CLUSTER</div>
            <div className="bn-logo-sub">M-TECH ORIGINALS</div>
          </div>

          <button type="button" onClick={() => { bnSfx.click(); run("buy"); }} disabled={!canBuy} className="bn-buy">
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
            <button type="button" onClick={() => { if (idle) { bnSfx.click(); setAnte((a) => !a); } }}
              className="bn-ante-toggle" disabled={!idle} aria-pressed={ante}>
              <span className="bn-track"><span className="bn-knob" /></span>
              <span className="bn-ante-state">{ante ? "ON" : "OFF"}</span>
            </button>
          </div>
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
            {/* the text changes on the animation's own loop point, where
                opacity is 0 — a timer drifts against the animation and snaps
                the swap into the visible phase */}
            <div className="bn-marquee"
              onAnimationIteration={() => setMarquee((n) => (n + 1) % MARQUEE.length)}>
              <span className="bn-lamp l" /><span className="bn-lamp r" />
              {MARQUEE[marquee]}
            </div>
            <span className="bn-dia tl" /><span className="bn-dia tr" /><span className="bn-dia bl" /><span className="bn-dia br" />

            <div className={"bn-panel" + (inFeature ? " feature" : phase === "win" || phase === "pop" ? " winning" : "")}>
              {/* effect layers are clipped; the grid is NOT, or the drop would
                  be guillotined at the panel edge */}
              <div className="bn-fx">
                <span className="bn-dividers" />
                <span className="bn-tint" />
                <span className="bn-panel-sheen" />
              </div>

              <div className="bn-grid">
                {grid.map((id, i) => {
                  const col = i % COLS;
                  if (!id) return <div className="bn-cell" key={i} />;
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
                  const move = exiting ? {
                    // 190% only ever moved a symbol two cells — the top rows
                    // never reached the mask, they just got swapped. 672% is
                    // (ROWS + 1.4) rows: the whole board, still connected,
                    // slides fully out through the bottom.
                    transform: "translate3d(0, 672%, 0)",
                    transition: "transform .52s cubic-bezier(.5,0,.78,.3)",
                    transitionDelay: `${col * 70}ms`,
                    willChange: "transform",
                  } : {
                    // 105% per row ≈ cell + grid gap, so a survivor's start
                    // position is exactly where it stood before the tumble
                    transform: displaced ? `translate3d(0, ${-sh * 105}%, 0)` : "translate3d(0,0,0)",
                    transition: displaced ? "none" : "transform .62s cubic-bezier(.22,1.18,.36,1)",
                    transitionDelay: displaced ? "0ms" : `${col * 70}ms`,
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
                        {isWin && <span className="bn-coreflash" />}
                      </div>
                    </div>
                  );
                })}
                {/* rings, shards and rising amounts sit over the grid */}
                {rings.map((b) => (
                  <span className="bn-ring" key={b.id}
                    style={{ left: `calc(${b.l}% - ${b.size / 2}px)`, top: `calc(${b.t}% - ${b.size / 2}px)`, width: b.size, height: b.size, borderColor: b.colour, boxShadow: `0 0 18px ${b.colour}` }} />
                ))}
                {shards.map((sh) => (
                  <span className="bn-shard-origin" key={sh.id} style={{ left: `${sh.l}%`, top: `${sh.t}%` }}>
                    <span className="bn-shard" style={{ background: sh.colour, "--a": `${sh.a}deg` }} />
                  </span>
                ))}
                {freeLeft > 0 && orbs.map((o, i) => (
                  <span className="bn-orb" key={i}
                    style={{ gridColumn: (o.cell % COLS) + 1, gridRow: Math.floor(o.cell / COLS) + 1 }}>
                    <img src={GEM + "meteor.png"} alt="" />
                    <b>×{o.mult}</b>
                  </span>
                ))}
              </div>

              {bigWin && (
                <div className="bn-bigwin">
                  <span className="bn-rays" />
                  <div className="bn-bigwin-label">{bigWin.label}</div>
                  <div className="bn-bigwin-amount">{bigWin.amount}</div>
                </div>
              )}
            </div>

            <div className="bn-pills">
              {spinning && !inFeature && (
                <div className={"bn-pill status" + (roundWin > 0 ? " win" : "")}>
                  {roundWin > 0 ? `${roundWin.toFixed(2)}×` : "TUMBLING"}
                </div>
              )}
              {freeLeft > 0 && (
                <div className="bn-pill fs">
                  <span className="k">FREE SPINS</span>
                  <span className="v">{freeLeft}{freeTotal ? ` / ${freeTotal}` : ""}</span>
                  <span className="sep" />
                  <span className="w">{fmtMKD(freeWin * lineBet)}</span>
                </div>
              )}
              {orbTotal > 0 && (
                <div className="bn-pill mx"><span className="k">METEOR TOTAL</span><span className="v">×{orbTotal}</span></div>
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
            <IconBtn label="Info" onClick={() => { bnSfx.click(); setRules(true); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.6" /></svg>
            </IconBtn>
            <IconBtn label={"Sound " + VOL_LABELS[vol]} onClick={() => { cycleVol(); bnSfx.click(); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <path d="M4 9v6h3.5L12 19V5L7.5 9H4z" fill="currentColor" stroke="none" />
                <path d="M16 9.5a4 4 0 0 1 0 5" opacity={vol >= 2 ? 1 : 0.15} />
                <path d="M18.6 7a7.5 7.5 0 0 1 0 10" opacity={vol >= 3 ? 1 : 0.15} />
              </svg>
            </IconBtn>
            <button type="button" onClick={() => { bnSfx.click(); setTurbo((t) => !t); }}
              className={"bn-turbo" + (turbo ? " on" : "")} aria-pressed={turbo}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z" /></svg>
              TURBO
            </button>
          </div>

          <div className="bn-meters">
            <div><span>CREDIT</span><b className="cr">{fmtMKD(balance)}</b></div>
            <div><span>BET</span><b className="be">{fmtMKD(stake)}</b></div>
          </div>

          {/* the reference puts the win here, in the console, big — not
              floating over the reels */}
          {roundWin > 0 || (settledWin != null && settledWin > 0) ? (
            <div className="bn-winline" key={Math.round((settledWin ?? roundWin * lineBet) * 100)}>
              <span className="bn-winline-label">WIN</span>
              <span className="bn-winline-amount">{fmtMKD(settledWin != null && settledWin > 0 ? settledWin : roundWin * lineBet)}</span>
            </div>
          ) : (
            <div className={"bn-centreline " + centre.tone}>{centre.text}</div>
          )}

          <div className="bn-spin-cluster">
            <button type="button" onClick={() => stepBet(-1)} disabled={!idle || lineBet <= 50} className="bn-step minus" aria-label="Lower bet">−</button>
            <button type="button" onClick={() => run(ante ? "ante" : "base")} disabled={!canSpin}
              className={"bn-spin" + (spinning ? " busy" : "")} aria-label="Spin">
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

      {intro && (
        <div className="bn-intro">
          <span className="bn-rays" />
          <div className="bn-intro-kicker">{intro.bought ? "FEATURE PURCHASED" : "CONGRATULATIONS"}</div>
          <div className="bn-intro-title">FREE SPINS</div>
          <div className="bn-intro-count">{intro.count}</div>
          <button type="button" className="bn-start"
            onClick={() => { bnSfx.click(); if (startedRef.current) startedRef.current(); }}>START</button>
        </div>
      )}

      {rules && <RulesModal onClose={() => setRules(false)} table={table} />}
    </div>
  );
}
