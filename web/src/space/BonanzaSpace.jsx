// STAR CLUSTER — our own pay-anywhere tumbling slot.
//
// The server resolves the WHOLE round in one POST: the paid spin, every tumble
// it causes, and any free spins it won. What happens here is replay. Nothing on
// this screen decides anything; it only paces the reveal.
//
// The drop is the thing that has to feel right. Symbols do not spin in on a
// reel — the board EMPTIES and stones fall in individually, each with its own
// small delay and a slight tilt, so the grid fills like poured gravel rather
// than snapping into place. That per-cell delay is the whole trick.
//
// Credits are held for the whole round and released when the last tumble
// settles, so the win lands with the animation rather than ahead of it.
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost, apiGet } from "../api";
import { useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import { SpaceRoot, SpaceHeader, SpaceSidebar, SectionLabel, SoundButton, BetStepper, T } from "./Shell";
import { beep, sfx, whoosh, startAmbient, armAmbientOnGesture } from "./spaceAudio";
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

// The marquee above the board, the way an arcade cabinet talks to the room.
const MARQUEE = [
  "SYMBOLS PAY ANYWHERE ON THE SCREEN",
  "8 OR MORE OF A KIND PAYS",
  "4 COMETS WIN FREE SPINS",
  "WINS TUMBLE — THEY KEEP PAYING",
];

const bnSfx = {
  drop(i) { beep("triangle", 300 + i * 26, 190 + i * 20, 0.035, 0.1); },
  tumble(i) { beep("triangle", 520 + i * 90, 900 + i * 90, 0.05, 0.2); },
  win() { sfx.cash(); },
  scatter() { whoosh(200, 1600, 0.22, 0.55); beep("sine", 520, 1400, 0.18, 0.34); },
  bomb(m = 2) { beep("sawtooth", 210, 70, 0.13, 0.34); beep("sine", 700 + Math.min(m, 40) * 22, 1500, 0.1, 0.22, 0.05); },
  click: sfx.click,
};

function RulesModal({ onClose, table }) {
  const rows = table ? Object.entries(table.pays) : [];
  return (
    <div onClick={onClose} className="bn-modal">
      <div onClick={(e) => e.stopPropagation()} className="bn-modal-box">
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>HOW TO PLAY</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 11, margin: "20px 0", fontSize: 15.5, lineHeight: 1.5, color: "#b7c0d1" }}>
          <div>◆ No lines. A stone pays when <b>8 or more</b> of it land anywhere on the grid.</div>
          <div>◆ Winners are removed, the rest fall and new stones fill the gaps — a <b>tumble</b>. It repeats until a drop makes no win, and every tumble adds to the same round.</div>
          <div>◆ <b>4+ comets</b> pay a bonus and award {table?.freeSpins ?? 10} free spins.</div>
          <div>◆ In free spins, <b>meteors</b> land carrying multipliers. They do not pay on their own and they do not multiply each other — when the tumbling stops, every meteor on screen is <b>added together</b> and that one total multiplies the <b>whole spin&apos;s win</b>.</div>
          <div style={{ paddingLeft: 18, color: "#8a94a8", fontSize: 14 }}>
            e.g. a spin tumbles to 6× and meteors of ×15 and ×2 landed → 15 + 2 = ×17, so the spin pays 6 × 17 = <b style={{ color: T.gold }}>102×</b>.
          </div>
          <div>◆ 3 comets during a free spin add 5 more.</div>
          <div>◆ <b>DOUBLE CHANCE</b> costs {((table?.anteCost ?? 1.25) * 100 - 100).toFixed(0)}% more and doubles how often comets appear.</div>
          <div>◆ <b>BUY FREE SPINS</b> goes straight to the feature for {(table?.buyPrice ?? 68).toFixed(0)}× your bet.</div>
        </div>
        {rows.length > 0 && (
          <div className="bn-paytable">
            <div className="bn-th">STONE</div><div className="bn-th r">8–9</div><div className="bn-th r">10–11</div><div className="bn-th r">12+</div>
            {rows.map(([id, tiers]) => (
              <div key={id} style={{ display: "contents" }}>
                <div className="bn-payrow"><img src={src(id)} alt="" width={26} height={26} />{NAMES[id] || id}</div>
                {tiers.map((v, i) => <div key={i} className="bn-payval">{v.toFixed(2)}×</div>)}
              </div>
            ))}
            <div className="bn-payrow"><img src={src("scatter")} alt="" width={26} height={26} />COMET (4/5/6+)</div>
            <div className="bn-payval" style={{ gridColumn: "span 3" }}>
              {table ? [4, 5, 6].map((n) => (table.scatter[n] ?? 0).toFixed(2) + "×").join("  ·  ") : ""}
            </div>
          </div>
        )}
        {table?.bombs && (
          <>
            <div style={{ margin: "20px 0 8px", fontSize: 13, letterSpacing: 3, color: T.gold }}>
              METEOR MULTIPLIERS · {Math.round((table.bombChance ?? 0) * 100)}% OF FREE-SPIN DROPS CARRY ONE
            </div>
            <div className="bn-bombtable">
              {table.bombs.map((b) => (
                <div key={b.mult} className="bn-bombcell">
                  <b>×{b.mult}</b>
                  <span>{(b.chance * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
        <button onClick={onClose} className="bn-gotit">GOT IT</button>
      </div>
    </div>
  );
}

export default function BonanzaSpace() {
  const MAX_BET = useMaxBet("bonanza");
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  const [bet, setBet] = useState(50);
  const [grid, setGrid] = useState(() => Array(CELLS).fill(null));
  const [winIds, setWinIds] = useState(new Set());
  const [clearing, setClearing] = useState(new Set());
  const [spinning, setSpinning] = useState(false);
  const [roundWin, setRoundWin] = useState(0);      // in bet multiples
  const [banner, setBanner] = useState(null);
  const [freeLeft, setFreeLeft] = useState(0);
  const [bombs, setBombs] = useState([]);
  const [ante, setAnte] = useState(false);
  const [turbo, setTurbo] = useState(false);
  const [table, setTable] = useState(null);
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");
  const [dropSeq, setDropSeq] = useState(0);
  const [marquee, setMarquee] = useState(0);

  const deadRef = useRef(false);
  const heldRef = useRef(false);
  const timers = useRef([]);
  const turboRef = useRef(false); turboRef.current = turbo;
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  const sleep = (ms) => new Promise((res) => later(res, Math.round(ms * (turboRef.current ? 0.35 : 1))));
  const hold = () => { if (!heldRef.current) { heldRef.current = true; holdBalance(); } };
  const release = () => { if (heldRef.current) { heldRef.current = false; releaseBalance(); } };

  useEffect(() => {
    armAmbientOnGesture(); startAmbient();
    apiGet("/api/games/bonanza/table").then(({ ok, data }) => { if (ok) setTable(data); });
    const m = setInterval(() => setMarquee((n) => (n + 1) % MARQUEE.length), 4200);
    // hold space for turbo, exactly like the cabinet hint says
    const down = (e) => { if (e.code === "Space") { e.preventDefault(); setTurbo(true); } };
    const up = (e) => { if (e.code === "Space") setTurbo(false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => {
      deadRef.current = true; clearInterval(m);
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up);
      timers.current.forEach(clearTimeout); release();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const playSpin = useCallback(async (sp, isFree) => {
    for (let i = 0; i < sp.steps.length; i++) {
      if (deadRef.current) return;
      const step = sp.steps[i];
      // empty the board first so the stones visibly fall INTO it
      if (i === 0) { setGrid(Array(CELLS).fill(null)); await sleep(150); if (deadRef.current) return; }
      setGrid(step.grid);
      setWinIds(new Set()); setClearing(new Set());
      setDropSeq((n) => n + 1);
      bnSfx.drop(i);
      await sleep(i === 0 ? 560 : 420);          // let the last column land
      if (deadRef.current) return;

      if (step.bomb) { setBombs((b) => [...b, step.bomb]); bnSfx.bomb(step.bomb.mult); }
      if (step.wins && step.wins.length) {
        setWinIds(new Set(step.wins.map((w) => w.id)));
        bnSfx.tumble(Math.min(i, 6));
        await sleep(460);
        if (deadRef.current) return;
        setRoundWin((w) => w + step.win);
        setClearing(new Set(step.wins.map((w) => w.id)));
        await sleep(280);
      }
    }
    if (isFree && sp.multiplier > 1) {
      setBanner({ kind: "mult", text: `×${sp.multiplier}` });
      bnSfx.win(); await sleep(950); setBanner(null);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (mode) => {
    if (spinning) return;
    const line = Math.max(50, Math.min(bet, MAX_BET));
    const cost = mode === "buy" ? (table?.buyPrice ?? 68.15) : mode === "ante" ? (table?.anteCost ?? 1.25) : 1;
    if (balance < line * cost) { setError("NOT ENOUGH CREDITS"); return; }
    setError(""); setSpinning(true); setRoundWin(0); setBombs([]); setBanner(null); setFreeLeft(0);
    hold(); bnSfx.click();

    const { ok, data } = await apiPost("/api/games/bonanza/spin",
      { betAmount: line, ante: mode === "ante", buy: mode === "buy" });
    if (deadRef.current) return;
    if (!ok) { setError((data?.error || "Spin failed").toUpperCase()); setSpinning(false); release(); return; }

    try {
      let first = 0;
      if (!data.buy) { await playSpin(data.rounds[0], false); first = 1; }
      if (data.freeSpinsAwarded > 0) {
        setBanner({ kind: "free", text: `${data.freeSpinsAwarded} FREE SPINS` });
        bnSfx.scatter(); await sleep(1400); setBanner(null);
        for (let i = first; i < data.rounds.length; i++) {
          if (deadRef.current) return;
          setFreeLeft(data.rounds.length - i);
          setBombs([]);
          await playSpin(data.rounds[i], true);
        }
        setFreeLeft(0);
      }
      if (data.payout > 0) {
        setBanner({ kind: "win", text: fmtMKD(data.payout) });
        bnSfx.win(); await sleep(1250); setBanner(null);
      }
    } finally {
      if (!deadRef.current) { setSpinning(false); setWinIds(new Set()); setClearing(new Set()); }
      release();
    }
  };

  const line = Math.max(50, Math.min(bet, MAX_BET));
  const anteCost = table?.anteCost ?? 1.25;
  const buyPrice = table?.buyPrice ?? 68.15;
  const stake = line * (ante ? anteCost : 1);
  const canSpin = !spinning && balance >= stake;
  const canBuy = !spinning && balance >= line * buyPrice;

  return (
    <SpaceRoot>
      <SpaceHeader title="STAR CLUSTER" chip={roundWin > 0 ? { label: `${roundWin.toFixed(2)}×`, color: T.win } : null} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
        <SpaceSidebar>
          <SoundButton />
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(7px, 1.5vh, 13px)", opacity: spinning ? 0.4 : 1, pointerEvents: spinning ? "none" : "auto", transition: "opacity .2s ease" }}>
            <BetStepper bet={bet} setBet={setBet} disabled={spinning} maxBet={MAX_BET} />

            {/* the two side bets, the way the genre presents them */}
            <button onClick={() => { bnSfx.click(); setAnte((a) => !a); }}
              className={"bn-ante" + (ante ? " on" : "")}>
              <span className="bn-ante-title">DOUBLE CHANCE</span>
              <span className="bn-ante-sub">{fmtMKD(line * anteCost)} · 2× COMETS</span>
              <span className="bn-ante-pill">{ante ? "ON" : "OFF"}</span>
            </button>

            <button onClick={() => { bnSfx.click(); run("buy"); }} disabled={!canBuy} className="bn-buy">
              <span className="bn-buy-title">BUY FREE SPINS</span>
              <span className="bn-buy-price">{fmtMKD(line * buyPrice)}</span>
            </button>
          </div>
        </SpaceSidebar>

        <div className="bn-stage">
          <div className={"bn-marquee" + (freeLeft > 0 ? " free" : "")} key={freeLeft > 0 ? "fs" : marquee}>
            {freeLeft > 0
              ? `FREE SPINS · ${freeLeft} LEFT${bombs.length ? ` · ×${bombs.reduce((a, b) => a + b.mult, 0)}` : ""}`
              : MARQUEE[marquee]}
          </div>

          <div className="bn-board" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}>
            {grid.map((id, i) => {
              const col = i % COLS, row = Math.floor(i / COLS);
              return (
                <div className="bn-cell" key={i}>
                  {id && (() => {
                    const cls = "bn-sym"
                      + (winIds.has(id) ? " bn-win" : "")
                      + (clearing.has(id) ? " bn-clear" : "")
                      + (id === "scatter" ? " scatter" : LOW.includes(id) ? " low" : " high");
                    // stagger by column, then by height, so the board fills
                    // left to right and bottom up like poured gravel
                    const dropDelay = col * 46 + (ROWS - row) * 18;
                    const style = {
                      // A comet runs TWO animations, so it needs two delays:
                      // the drop, and a negative offset that starts its twinkle
                      // part-way through — otherwise every comet on the board
                      // pulses in lockstep. One inline value would have been
                      // applied to both.
                      animationDelay: id === "scatter"
                        ? `${dropDelay}ms, ${-(i % 12) * 96}ms`
                        : `${dropDelay}ms`,
                      "--tilt": `${((i * 37) % 15) - 7}deg`,
                    };
                    // The comet is a 12-frame strip played with steps(), not a
                    // still — a scatter should catch the eye across the room.
                    return id === "scatter"
                      ? <span key={`${dropSeq}-${i}`} className={cls} style={style} role="img" aria-label="comet" />
                      : <img key={`${dropSeq}-${i}`} src={src(id)} alt={NAMES[id] || id} draggable={false} className={cls} style={style} />;
                  })()}
                </div>
              );
            })}
            {/* Orbs land ON the field, at the cell the server picked. They are
                inert — they never pay and never tumble — and every one on the
                board is summed into the sequence multiplier. */}
            {freeLeft > 0 && bombs.map((b, i) => (
              <span className="bn-orb" key={i}
                style={{ gridColumn: (b.cell % COLS) + 1, gridRow: Math.floor(b.cell / COLS) + 1 }}>
                <img src={GEM + "meteor.png"} alt="" />
                <b>×{b.mult}</b>
              </span>
            ))}
            {banner && <div className={"bn-banner bn-banner-" + banner.kind}>{banner.text}</div>}
          </div>

          <div className={"bn-readout" + (error ? " err" : roundWin > 0 ? " win" : "")}>
            {error || (roundWin > 0 ? `WIN ${fmtMKD(roundWin * line)}` : spinning ? "TUMBLING…" : "GOOD LUCK!")}
          </div>
        </div>
      </div>

      {/* bottom bar: readouts left, the big button centre, info right */}
      <div className="bn-bottom">
        <div className="bn-meters">
          <div><span>CREDIT</span><b>{fmtMKD(balance)}</b></div>
          <div><span>BET</span><b>{fmtMKD(stake)}</b></div>
        </div>

        <div className="bn-spinwrap">
          <button onClick={() => { bnSfx.click(); setBet(Math.max(50, bet - 50)); }} disabled={spinning} className="bn-step">−</button>
          <button onClick={() => run(ante ? "ante" : "base")} disabled={!canSpin} className={"bn-spin" + (spinning ? " busy" : "")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-3.2-6.9" /><path d="M21 3v6h-6" />
            </svg>
          </button>
          <button onClick={() => { bnSfx.click(); setBet(Math.min(MAX_BET, bet + 50)); }} disabled={spinning} className="bn-step">+</button>
        </div>

        <div className="bn-tools">
          <span className="bn-hint">HOLD SPACE FOR TURBO</span>
          <button onClick={() => { bnSfx.click(); navigate("/"); }} className="bn-tool">LOBBY</button>
          <button onClick={() => { bnSfx.click(); setRules(true); }} className="bn-tool">INFO</button>
        </div>
      </div>

      {rules && <RulesModal onClose={() => setRules(false)} table={table} />}
    </SpaceRoot>
  );
}
