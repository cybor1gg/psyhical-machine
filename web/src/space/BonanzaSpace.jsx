// SUGAR RUSH — pay-anywhere tumbling slot, 6×5.
//
// The server resolves the WHOLE round in one POST: the paid spin, every
// tumble it causes, and any free spins it won. What happens here is replay —
// symbols drop in, winners flash and clear, survivors fall, the next drop
// fills the gaps, and the counter climbs. Nothing on this screen decides
// anything; it only paces the reveal.
//
// The credits stay frozen for the whole round (holdBalance) and are released
// when the last tumble has settled, so the win lands with the animation
// rather than ahead of it.
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost, apiGet } from "../api";
import { useBalance, holdBalance, releaseBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import {
  SpaceRoot, SpaceHeader, SpaceSidebar, SectionLabel,
  GoldButton, SoundButton, BetStepper, T,
} from "./Shell";
import { beep, sfx, whoosh, startAmbient, armAmbientOnGesture } from "./spaceAudio";
import { useMaxBet } from "./limits";
import "./space.css";
import "./bonanza.css";

const COLS = 6, ROWS = 5;

// Each symbol is drawn, not loaded — a gradient body, a highlight and a
// glyph. Keeps the screen self-contained and lets it scale to any cabinet.
const SYM = {
  banana: { body: ["#ffe27a", "#e0a92b"], ink: "#5b3d05", glyph: "🍌", ring: "rgba(255,226,122,.55)" },
  grape: { body: ["#c39bff", "#6d3fd0"], ink: "#2b1257", glyph: "🍇", ring: "rgba(195,155,255,.55)" },
  plum: { body: ["#ff9ec4", "#c8407c"], ink: "#4d0f2c", glyph: "🍑", ring: "rgba(255,158,196,.55)" },
  melon: { body: ["#8ce88c", "#2f9e5f"], ink: "#0d3b21", glyph: "🍉", ring: "rgba(140,232,140,.55)" },
  blue: { body: ["#8fd4ff", "#2f6fd0"], ink: "#0b2a56", glyph: "◆", ring: "rgba(143,212,255,.6)" },
  green: { body: ["#9dffd0", "#1f9e77"], ink: "#06382a", glyph: "▲", ring: "rgba(157,255,208,.6)" },
  purple: { body: ["#d0a5ff", "#7b3fd4"], ink: "#2c1055", glyph: "●", ring: "rgba(208,165,255,.6)" },
  heart: { body: ["#ff9d9d", "#d63c3c"], ink: "#4d0d0d", glyph: "♥", ring: "rgba(255,157,157,.65)" },
  scatter: { body: ["#f6ecc9", "#d9b26a"], ink: "#3a2a06", glyph: "★", ring: "rgba(240,217,154,.75)" },
};
const NAMES = {
  banana: "BANANA", grape: "GRAPE", plum: "PLUM", melon: "MELON",
  blue: "BLUE GEM", green: "GREEN GEM", purple: "PURPLE GEM", heart: "HEART", scatter: "SCATTER",
};

const bnSfx = {
  drop() { beep("triangle", 420, 240, 0.05, 0.16); },
  tumble(i) { beep("triangle", 520 + i * 90, 900 + i * 90, 0.05, 0.18); },
  win() { sfx.cash(); },
  scatter() { whoosh(200, 1500, 0.2, 0.5); beep("sine", 500, 1300, 0.16, 0.32); },
  bomb(m) { beep("sawtooth", 180, 60 + m * 6, 0.12, 0.3); },
  click: sfx.click,
};

function Cell({ id, winning, clearing, dropKey }) {
  if (!id) return <div className="bn-cell" />;
  const s = SYM[id] || SYM.banana;
  return (
    <div className={"bn-cell" + (winning ? " bn-win" : "") + (clearing ? " bn-clear" : "")} key={dropKey}>
      <div className="bn-sym" style={{ background: `radial-gradient(circle at 38% 30%, ${s.body[0]}, ${s.body[1]})`, color: s.ink, "--ring": s.ring }}>
        <span className="bn-glyph">{s.glyph}</span>
      </div>
    </div>
  );
}

function RulesModal({ onClose, table }) {
  const rows = table ? Object.entries(table.pays) : [];
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,6,10,.78)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, width: "92%", maxHeight: "86vh", overflowY: "auto", padding: "32px 36px", borderRadius: 24, border: `2px solid ${T.ctlBorder}`, background: "linear-gradient(180deg,#111826,#0a0d14)" }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: T.gold }}>HOW TO PLAY</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, margin: "22px 0", fontSize: 16, lineHeight: 1.5, color: "#b7c0d1" }}>
          <div>◆ There are no lines. A symbol pays when <b>8 or more</b> land anywhere on the grid.</div>
          <div>◆ Winners are removed, everything drops down and new symbols fill the gaps — a <b>tumble</b>. It repeats until a drop makes no win, and every tumble adds to the same round.</div>
          <div>◆ <b>4+ scatters</b> pay a bonus and award 10 free spins.</div>
          <div>◆ In free spins, <b>multiplier bombs</b> land. When the tumbling stops, every bomb is added together and the whole round is multiplied by it.</div>
          <div>◆ 3 scatters during free spins add 5 more.</div>
        </div>
        {rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "6px 14px", fontSize: 14, alignItems: "center" }}>
            <div style={{ color: T.muted, letterSpacing: 2 }}>SYMBOL</div>
            <div style={{ color: T.muted, textAlign: "right" }}>8–9</div>
            <div style={{ color: T.muted, textAlign: "right" }}>10–11</div>
            <div style={{ color: T.muted, textAlign: "right" }}>12+</div>
            {rows.map(([id, tiers]) => (
              <Row key={id} id={id} tiers={tiers} />
            ))}
          </div>
        )}
        <button onClick={onClose} style={{ marginTop: 24, width: "100%", padding: 15, borderRadius: 16, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 19, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>GOT IT</button>
      </div>
    </div>
  );
}
function Row({ id, tiers }) {
  const s = SYM[id] || SYM.banana;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", background: `radial-gradient(circle at 38% 30%, ${s.body[0]}, ${s.body[1]})`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{s.glyph}</span>
        <span style={{ color: "#cdd6e4" }}>{NAMES[id]}</span>
      </div>
      {tiers.map((v, i) => (
        <div key={i} style={{ textAlign: "right", color: T.gold, fontWeight: 700 }}>{v.toFixed(2)}×</div>
      ))}
    </>
  );
}

export default function BonanzaSpace() {
  const MAX_BET = useMaxBet("bonanza");
  const navigate = useNavigate();
  const balance = useBalance() ?? 0;

  const [bet, setBet] = useState(50);
  const [grid, setGrid] = useState(() => Array(COLS * ROWS).fill(null));
  const [winIds, setWinIds] = useState(new Set());
  const [clearing, setClearing] = useState(new Set());
  const [spinning, setSpinning] = useState(false);
  const [roundWin, setRoundWin] = useState(0);
  const [banner, setBanner] = useState(null);      // { kind, text }
  const [freeLeft, setFreeLeft] = useState(0);
  const [bombs, setBombs] = useState([]);
  const [table, setTable] = useState(null);
  const [rules, setRules] = useState(false);
  const [error, setError] = useState("");
  const [dropSeq, setDropSeq] = useState(0);

  const deadRef = useRef(false);
  const heldRef = useRef(false);
  const timers = useRef([]);
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  const hold = () => { if (!heldRef.current) { heldRef.current = true; holdBalance(); } };
  const release = () => { if (heldRef.current) { heldRef.current = false; releaseBalance(); } };

  useEffect(() => {
    armAmbientOnGesture(); startAmbient();
    apiGet("/api/games/bonanza/table").then(({ ok, data }) => { if (ok) setTable(data); });
    return () => { deadRef.current = true; timers.current.forEach(clearTimeout); release(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sleep = (ms) => new Promise((res) => later(res, ms));

  // Play one server-resolved spin: first drop, then each tumble.
  const playSpin = useCallback(async (sp, isFree) => {
    for (let i = 0; i < sp.steps.length; i++) {
      if (deadRef.current) return;
      const step = sp.steps[i];
      setGrid(step.grid);
      setWinIds(new Set());
      setClearing(new Set());
      setDropSeq((n) => n + 1);
      bnSfx.drop();
      await sleep(i === 0 ? 420 : 300);
      if (deadRef.current) return;

      if (step.wins && step.wins.length) {
        setWinIds(new Set(step.wins.map((w) => w.id)));
        bnSfx.tumble(Math.min(i, 6));
        await sleep(480);
        if (deadRef.current) return;
        setRoundWin((w) => w + step.win);
        if (step.bomb) { setBombs((b) => [...b, step.bomb]); bnSfx.bomb(step.bomb); }
        setClearing(new Set(step.wins.map((w) => w.id)));
        await sleep(260);
      }
    }
    if (isFree && sp.multiplier > 1) {
      setBanner({ kind: "mult", text: `×${sp.multiplier}` });
      bnSfx.win();
      await sleep(900);
      setBanner(null);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const spin = async () => {
    if (spinning) return;
    const stake = Math.max(50, Math.min(bet, MAX_BET, Math.floor(balance)));
    if (balance < stake) { setError("NOT ENOUGH CREDITS"); return; }
    setError(""); setSpinning(true); setRoundWin(0); setBombs([]); setBanner(null); setFreeLeft(0);
    hold();
    bnSfx.click();

    const { ok, data } = await apiPost("/api/games/bonanza/spin", { betAmount: stake });
    if (deadRef.current) return;
    if (!ok) {
      setError((data?.error || "Spin failed").toUpperCase());
      setSpinning(false); release();
      return;
    }

    try {
      await playSpin(data.rounds[0], false);
      if (data.freeSpinsAwarded > 0) {
        setBanner({ kind: "free", text: `${data.freeSpinsAwarded} FREE SPINS` });
        bnSfx.scatter();
        await sleep(1400);
        setBanner(null);
        for (let i = 1; i < data.rounds.length; i++) {
          if (deadRef.current) return;
          setFreeLeft(data.rounds.length - i);
          setBombs([]);
          await playSpin(data.rounds[i], true);
        }
        setFreeLeft(0);
      }
      if (data.payout > 0) {
        setBanner({ kind: "win", text: fmtMKD(data.payout) });
        bnSfx.win();
        await sleep(1200);
        setBanner(null);
      }
    } finally {
      if (!deadRef.current) { setSpinning(false); setWinIds(new Set()); setClearing(new Set()); }
      release(); // the credits land now, with the animation finished
    }
  };

  const canSpin = !spinning && balance >= 50;

  return (
    <SpaceRoot>
      <SpaceHeader title="SUGAR RUSH" chip={roundWin > 0 ? { label: `WIN ${fmtMKD(roundWin * bet)}`, color: T.win } : null} />

      <div style={{ position: "relative", zIndex: 5, flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
        <SpaceSidebar>
          <SoundButton />
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 2vh, 16px)", opacity: spinning ? 0.4 : 1, pointerEvents: spinning ? "none" : "auto", transition: "opacity .2s ease" }}>
            <BetStepper bet={bet} setBet={setBet} disabled={spinning} maxBet={MAX_BET} />
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            <SectionLabel>PAYS FROM</SectionLabel>
            <div style={{ fontSize: "clamp(13px, 2vh, 16px)", color: T.text2, letterSpacing: 1 }}>
              8 OF A KIND, ANYWHERE
            </div>
          </div>
        </SpaceSidebar>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(8px, 1.6vh, 16px)", padding: "0 clamp(10px, 2vw, 26px)" }}>
          {freeLeft > 0 && (
            <div className="bn-freebar">FREE SPINS · {freeLeft} LEFT{bombs.length > 0 ? ` · ×${bombs.reduce((a, b) => a + b, 0)}` : ""}</div>
          )}

          <div className="bn-board" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)` }}>
            {grid.map((id, i) => (
              <Cell key={i} id={id} dropKey={`${dropSeq}-${i}`}
                winning={id && winIds.has(id)} clearing={id && clearing.has(id)} />
            ))}
            {banner && (
              <div className={"bn-banner bn-banner-" + banner.kind}>{banner.text}</div>
            )}
          </div>

          <div style={{ minHeight: 26, fontSize: "clamp(14px, 2.2vh, 19px)", fontWeight: 700, letterSpacing: 3, color: error ? "#ff6a5a" : roundWin > 0 ? T.win : T.muted }}>
            {error || (roundWin > 0 ? `${roundWin.toFixed(2)}× — ${fmtMKD(roundWin * bet)}` : spinning ? "TUMBLING…" : "PRESS SPIN")}
          </div>
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 6, flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "0 clamp(16px, 3vw, 40px) clamp(12px, 2.4vh, 26px)" }}>
        <button onClick={() => { bnSfx.click(); navigate("/"); }} className="sp-hover-gold"
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "clamp(12px,2vh,18px) clamp(18px,2.4vw,30px)", borderRadius: 18, border: `2px solid ${T.ctlBorder}`, background: "rgba(255,255,255,.03)", color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(14px,2vh,18px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
          LOBBY
        </button>
        <GoldButton label={spinning ? "…" : "SPIN"} sub={fmtMKD(Math.min(bet, MAX_BET))} onClick={spin} disabled={!canSpin} />
        <button onClick={() => { bnSfx.click(); setRules(true); }} className="sp-hover-gold"
          style={{ padding: "clamp(12px,2vh,18px) clamp(18px,2.4vw,30px)", borderRadius: 18, border: `2px solid ${T.ctlBorder}`, background: "rgba(255,255,255,.03)", color: T.text, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: "clamp(14px,2vh,18px)", fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
          INFO
        </button>
      </div>

      {rules && <RulesModal onClose={() => setRules(false)} table={table} />}
    </SpaceRoot>
  );
}
