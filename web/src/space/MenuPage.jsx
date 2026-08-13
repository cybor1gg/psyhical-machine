// Main Menu — port of the "Pod Terminal UI" prototype: trilingual header,
// category pills, momentum cover-flow carousel of the 12 game cards, credits
// chip, CASHOUT and the pulsing gold PLAY. Carousel physics (drag, inertia
// friction .95, snap glide with cubic easing, tick per notch, tap-to-center,
// infinite wrap) ported from the prototype's logic class.
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api";
import { useBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import SpaceBackground from "./SpaceBackground";
import { openCashPanel } from "../kiosk/CashSimulator";
import { sfx, cycleVol, useVol, VOL_LABELS, armAmbientOnGesture, startAmbient } from "./spaceAudio";
import "./space.css";

const ACCENT = "#d9b26a";

const GAMES = [
  { id: "hilo", name: "HI·LO", cat: "ORIGINALS" },
  { id: "bj", name: "BLACKJACK", cat: "TABLE" },
  { id: "tower", name: "TOWER", cat: "ORIGINALS" },
  { id: "war", name: "WAR", cat: "TABLE" },
  { id: "mines", name: "MINES", cat: "ORIGINALS" },
  { id: "chicken", name: "CHICKEN CROSS", cat: "ORIGINALS" },
  { id: "dice", name: "DICE", cat: "ORIGINALS" },
  { id: "limbo", name: "LIMBO", cat: "ORIGINALS" },
  { id: "plinko", name: "PLINKO", cat: "ORIGINALS" },
  { id: "keno", name: "KENO", cat: "ORIGINALS" },
  { id: "roulette", name: "ROULETTE", cat: "TABLE" },
  { id: "baccarat", name: "BACCARAT", cat: "TABLE" },
];
// Card id → app route (bj is the design's id for blackjack).
const ROUTE = { bj: "/games/blackjack" };
const routeFor = (id) => ROUTE[id] || `/games/${id}`;

const LANGS = [
  { code: "MK", flag: "radial-gradient(circle at 50% 50%, #ffd233 0 20%, rgba(255,210,51,0) 21%), conic-gradient(from 22deg, #ffd233 0 9deg, #d20000 9deg 36deg, #ffd233 36deg 45deg, #d20000 45deg 81deg, #ffd233 81deg 90deg, #d20000 90deg 126deg, #ffd233 126deg 135deg, #d20000 135deg 171deg, #ffd233 171deg 180deg, #d20000 180deg 216deg, #ffd233 216deg 225deg, #d20000 225deg 261deg, #ffd233 261deg 270deg, #d20000 270deg 306deg, #ffd233 306deg 315deg, #d20000 315deg 360deg)" },
  { code: "EN", flag: 'url("/space/flags/uk.png")' },
  { code: "EL", flag: 'url("/space/flags/gr.png")' },
];
const CATS = ["ALL GAMES", "ORIGINALS", "TABLE"];
const COPY = {
  MK: { play: "ИГРАЈ", credit: "КРЕДИТ", cash: "ИСПЛАТА", insert: "ВНЕСИ ПАРИ" },
  EN: { play: "PLAY", credit: "CREDIT", cash: "CASHOUT", insert: "INSERT CASH" },
  EL: { play: "ΠΑΙΞΕ", credit: "ΥΠΟΛΟΙΠΟ", cash: "ΕΞΑΡΓΥΡΩΣΗ", insert: "ΕΙΣΑΓΩΓΗ" },
};

const tint = (a) => `rgba(217, 178, 106, ${a})`;

function CashoutModal({ onClose }) {
  const balance = useBalance() ?? 0;
  const [phase, setPhase] = useState("confirm"); // confirm | busy | done
  const [paid, setPaid] = useState(0);
  const [error, setError] = useState("");
  const confirm = async () => {
    setPhase("busy");
    const { ok, data } = await apiPost("/api/cabinet/cash-out");
    if (!ok) { setError(data?.error || "Cash out failed"); setPhase("confirm"); return; }
    setPaid(data.amount);
    setPhase("done");
    sfx.cash();
  };
  const btn = (extra) => ({ padding: "18px 40px", borderRadius: 46, fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 4, cursor: "pointer", ...extra });
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(3,4,7,.82)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "min(560px, 92vw)", padding: "38px 40px", borderRadius: 24, border: "2px solid #2a3345", background: "rgba(10,14,22,.96)", textAlign: "center", fontFamily: "'DM Sans', Helvetica, sans-serif" }}>
        {phase === "done" ? (
          <>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: "#f0d99a" }}>COLLECT YOUR PAYOUT</div>
            <div style={{ fontSize: 46, fontWeight: 700, color: "#3ae0a1", margin: "18px 0 8px" }}>{fmtMKD(paid)}</div>
            <div style={{ fontSize: 15, color: "#8a94a8", letterSpacing: 1, marginBottom: 26 }}>Please see the attendant to receive your cash.</div>
            <button onClick={onClose} style={btn({ border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", width: "100%" })}>DONE</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: "#f0d99a" }}>CASH OUT?</div>
            <div style={{ fontSize: 42, fontWeight: 700, color: "#f0d99a", margin: "16px 0 6px" }}>{fmtMKD(balance)}</div>
            <div style={{ fontSize: 15, color: "#8a94a8", letterSpacing: 1, marginBottom: 22 }}>Your remaining credits will be paid out by the attendant.</div>
            {error && <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,122,106,.5)", background: "rgba(255,122,106,.12)", color: "#ff7a6a", fontSize: 14, fontWeight: 600 }}>{error}</div>}
            <div style={{ display: "flex", gap: 14 }}>
              <button onClick={onClose} disabled={phase === "busy"} style={btn({ flex: 1, border: "2px solid #3a4557", background: "rgba(255,255,255,.04)", color: "#cdd6e4" })}>KEEP PLAYING</button>
              <button onClick={confirm} disabled={phase === "busy" || balance <= 0} style={btn({ flex: 1, border: "3px solid #f6f1e6", background: "linear-gradient(180deg,#f0d99a,#d9b26a 55%,#a9843e)", color: "#1a1408", opacity: phase === "busy" || balance <= 0 ? 0.6 : 1 })}>
                {phase === "busy" ? "…" : "CASH OUT"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function MenuPage() {
  const [cat, setCat] = useState("ALL GAMES");
  const [sel, setSel] = useState("hilo");
  const [lang, setLang] = useState(() => { try { return window.localStorage.getItem("space_lang") || "EN"; } catch { return "EN"; } });
  const [cashOpen, setCashOpen] = useState(false);
  const vol = useVol();
  const balance = useBalance() ?? 0;
  const navigate = useNavigate();

  const rootRef = useRef(null);
  const portRef = useRef(null);
  const m = useRef({ pos: 0, vel: 0, tween: null, drag: null, movedAt: 0, notch: undefined, lockSel: null, cards: null, list: GAMES, raf: 0, run: false }).current;

  useEffect(() => { try { window.localStorage.setItem("space_lang", lang); } catch { /* fine */ } }, [lang]);
  useEffect(() => { armAmbientOnGesture(); }, []);

  const visible = useCallback(() => {
    const base = cat === "ALL GAMES" ? GAMES : GAMES.filter((g) => g.cat === cat);
    return base.length <= 5 ? base.concat(base) : base;
  }, [cat]);

  const stride = () => {
    const port = portRef.current;
    const w = port ? Math.min(330, port.clientWidth * 0.30) : 330;
    return w + 24;
  };
  const cardEls = () => {
    if (m.cards) return m.cards;
    const port = portRef.current;
    if (!port) return [];
    m.cards = Array.from(port.querySelectorAll("[data-mt-i]"));
    return m.cards;
  };
  const glideTo = (to, dur, ease) => {
    const dist = Math.abs(to - m.pos);
    if (dist < 0.001) { m.pos = to; m.tween = null; return; }
    m.tween = { from: m.pos, to, start: performance.now(), dur: dur || Math.min(1000, 420 + 280 * dist), ease: ease || "inout" };
  };

  // rAF cover-flow loop — writes card transforms directly (never through
  // React state), exactly like the prototype.
  useEffect(() => {
    m.run = true;
    m.list = visible();
    m.cards = null;
    m.pos = 0; m.vel = 0; m.tween = null; m.lockSel = null; m.notch = undefined;
    const tick = () => {
      if (!m.run) return;
      const list = m.list;
      const N = list.length;
      if (!m.drag) {
        if (m.tween) {
          const w = m.tween, k = Math.min(1, (performance.now() - w.start) / w.dur);
          const e = w.ease === "out" ? 1 - Math.pow(1 - k, 3) : (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
          m.pos = w.from + (w.to - w.from) * e;
          if (k >= 1) { m.pos = w.to; m.tween = null; }
        } else if (m.vel !== 0) {
          m.pos += m.vel;
          m.vel *= 0.95;
          if (Math.abs(m.vel) < 0.03) {
            const to = Math.round(m.pos + m.vel * 12);
            m.vel = 0;
            glideTo(to, 520, "out");
          }
        }
        const notch = Math.round(m.pos);
        if (notch !== m.notch) {
          if (m.notch !== undefined && (m.drag || m.vel !== 0 || m.tween)) sfx.tick();
          m.notch = notch;
        }
      }
      const st = stride();
      const centreIdx = ((Math.round(m.pos) % N) + N) % N;
      cardEls().forEach((el) => {
        const i = parseInt(el.getAttribute("data-mt-i"), 10);
        if (isNaN(i) || i >= N) { el.style.visibility = "hidden"; return; }
        let d = i - (((m.pos % N) + N) % N);
        d = ((d % N) + N * 1.5) % N - N / 2;
        if (Math.abs(d) > 3.3) { el.style.visibility = "hidden"; return; }
        const t = Math.max(0, 1 - Math.min(1, Math.abs(d) / 1.7));
        const e2 = t * t * (3 - 2 * t);
        el.style.visibility = "visible";
        el.style.zIndex = String(200 - Math.round(Math.abs(d) * 40));
        el.style.transform = `translate(-50%, -50%) translateX(${(d * st).toFixed(2)}px) translateY(${(-14 * e2).toFixed(2)}px) scale(${(0.86 + 0.14 * e2).toFixed(4)})`;
        el.style.opacity = (0.45 + 0.55 * Math.max(0, 1 - Math.abs(d) / 2.6)).toFixed(3);
        const btn = el.firstElementChild;
        const on = i === centreIdx;
        if (btn && btn._on !== on) {
          btn._on = on;
          btn.style.borderColor = on ? ACCENT : "#222b3a";
          btn.style.boxShadow = on
            ? `0 22px 48px rgba(0,0,0,.62), 0 0 34px ${tint(0.22)}, inset 0 0 0 1px ${tint(0.35)}`
            : "0 12px 26px rgba(0,0,0,.5)";
        }
      });
      const cid = list[centreIdx] && list[centreIdx].id;
      const fast = Math.abs(m.vel) > 0.06;
      if (cid && !m.drag && !fast) {
        setSel((prev) => {
          if (cid === prev) return prev;
          if (m.lockSel && m.lockSel !== cid) return prev;
          m.lockSel = null;
          return cid;
        });
      } else if (m.lockSel === cid) m.lockSel = null;
      m.raf = requestAnimationFrame(tick);
    };
    // first tick runs synchronously so the cards are laid out immediately,
    // even before the first animation frame is delivered
    tick();
    return () => { m.run = false; cancelAnimationFrame(m.raf); };
  }, [visible]); // restarts on category switch — pos resets like the prototype

  // Drag physics (pointer events on the whole carousel port).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onDown = (e) => {
      const btn = e.target.closest && e.target.closest("button");
      if (btn && !btn.hasAttribute("data-mt-btn")) return;
      m.drag = { x: e.clientX, start: e.clientX, t: performance.now(), vx: 0, moved: false };
      m.vel = 0; m.tween = null;
      root.style.cursor = "grabbing";
    };
    const onMove = (e) => {
      const d = m.drag;
      if (!d) return;
      const now = performance.now(), dt = Math.max(1, now - d.t);
      const dx = e.clientX - d.x;
      if (Math.abs(e.clientX - d.start) > 7) d.moved = true;
      m.pos -= dx / stride();
      d.vx = 0.75 * d.vx + 0.25 * (-(dx / dt) * 16.7 / stride());
      d.x = e.clientX; d.t = now;
    };
    const onUp = () => {
      const d = m.drag;
      if (!d) return;
      m.drag = null;
      root.style.cursor = "grab";
      m.movedAt = d.moved ? performance.now() : 0;
      const v = Math.max(-0.34, Math.min(0.34, d.vx));
      if (Math.abs(v) > 0.012) m.vel = v;
      else glideTo(Math.round(m.pos), 380);
    };
    root.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      root.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [m]);

  const pick = (i, id) => {
    if (m.movedAt && performance.now() - m.movedAt < 220) return;
    const N = m.list.length;
    const k = Math.round((m.pos - i) / N);
    m.vel = 0;
    sfx.select();
    glideTo(i + k * N);
    m.lockSel = id;
    setSel(id);
  };

  const switchCat = (next) => {
    if (next === cat) return;
    const port = portRef.current;
    if (port) { port.style.transition = "opacity .16s ease"; port.style.opacity = "0"; }
    setTimeout(() => {
      setCat(next);
      // timer, not rAF: the fade-in must restore even when no frame is
      // being composited at this instant
      setTimeout(() => {
        const p = portRef.current;
        if (p) { p.style.transition = "opacity .3s ease"; p.style.opacity = "1"; }
      }, 40);
    }, 170);
  };

  const t = COPY[lang] || COPY.EN;
  const list = visible();
  m.list = list;
  m.cards = null;
  const selGame = GAMES.find((g) => g.id === sel) || GAMES[0];
  const play = () => { sfx.select(); startAmbient(); navigate(routeFor(sel)); };

  const orbs = [
    { left: "5%", top: "12%", size: 280, fill: "rgba(217,178,106,.30)", dur: "9s", delay: "0s" },
    { left: "70%", top: "4%", size: 320, fill: "rgba(123,63,212,.26)", dur: "11s", delay: "1.5s" },
    { left: "38%", top: "58%", size: 380, fill: "rgba(217,178,106,.16)", dur: "13s", delay: ".8s" },
    { left: "85%", top: "62%", size: 260, fill: "rgba(90,140,255,.18)", dur: "10s", delay: "2.2s" },
    { left: "16%", top: "70%", size: 300, fill: "rgba(123,63,212,.18)", dur: "12s", delay: "3s" },
    { left: "56%", top: "20%", size: 190, fill: "rgba(240,217,154,.20)", dur: "8s", delay: "1s" },
  ];

  return (
    <div ref={rootRef} style={{ position: "relative", width: "100vw", height: "100vh", minHeight: 500, overflow: "hidden", display: "flex", flexDirection: "column", background: "radial-gradient(130% 100% at 50% -25%, #1a1f33 0%, #0a0c14 55%, #06070b 100%)", fontFamily: "'DM Sans', Helvetica, Arial, sans-serif", color: "#f0ece4", touchAction: "none", userSelect: "none" }}>
      {/* menu ambience under the shared solar system */}
      <div className="mt-conic" style={{ position: "absolute", inset: "-25%", pointerEvents: "none", opacity: 0.55, background: "conic-gradient(from 0deg, rgba(217,178,106,0) 0deg, rgba(217,178,106,.14) 42deg, rgba(217,178,106,0) 92deg, rgba(123,63,212,.12) 205deg, rgba(217,178,106,0) 305deg)", animation: "mtSpin 26s linear infinite" }} />
      <div className="mt-stars" style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: "radial-gradient(circle at 20px 20px, rgba(217,178,106,.20) 2px, transparent 3px), radial-gradient(circle at 90px 70px, rgba(255,255,255,.12) 1.5px, transparent 3px), repeating-linear-gradient(64deg, rgba(255,255,255,.03) 0 1px, transparent 1px 92px)", backgroundSize: "140px 140px, 180px 180px, auto", animation: "mtStars 36s linear infinite, mtTwinkle 3.6s ease-in-out infinite" }} />
      <div className="mt-stars2" style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.5, backgroundImage: "radial-gradient(circle at 55px 110px, rgba(240,217,154,.16) 1.5px, transparent 3px), radial-gradient(circle at 130px 40px, rgba(150,170,255,.13) 1px, transparent 2.5px)", backgroundSize: "200px 200px, 240px 240px", animation: "mtStars2 48s linear infinite, mtTwinkle 5.2s ease-in-out infinite reverse" }} />
      <div className="mt-comet" style={{ position: "absolute", top: "18%", left: 0, width: 130, height: 2, borderRadius: 2, pointerEvents: "none", background: "linear-gradient(90deg, rgba(240,217,154,0), rgba(240,217,154,.8))", filter: "drop-shadow(0 0 6px rgba(240,217,154,.8))", animation: "mtComet 11s ease-in 2s infinite" }} />
      {orbs.map((o, i) => (
        <div key={i} className="mt-orb" style={{ position: "absolute", left: o.left, top: o.top, width: o.size, height: o.size, borderRadius: "50%", background: o.fill, filter: "blur(30px)", animation: `mtDrift ${o.dur} ease-in-out infinite`, animationDelay: o.delay, pointerEvents: "none" }} />
      ))}
      <div className="mt-sweep" style={{ position: "absolute", top: "-20%", left: "12%", width: "76%", height: "140%", pointerEvents: "none", filter: "blur(70px)", background: "radial-gradient(46% 50% at 50% 50%, rgba(240,217,154,.11), rgba(240,217,154,.05) 45%, rgba(240,217,154,0) 78%)", animation: "mtSweep 10s ease-in-out infinite alternate" }} />
      <SpaceBackground variant="menu" />

      {/* header */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "30px 54px 0" }}>
        <div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 5, color: "#f0d99a", lineHeight: 1 }}>M-TECH ORIGINALS</div>
          <div style={{ fontSize: 15, letterSpacing: 6, color: "#5d6a80", marginTop: 8 }}>TABLE GAMES &amp; ORIGINALS</div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {LANGS.map((l) => {
            const on = l.code === lang;
            return (
              <button key={l.code} onClick={() => { sfx.click(); setLang(l.code); }} className="sp-hover-gold"
                style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 18px", borderRadius: 12, border: `2px solid ${on ? "#d9b26a" : "#26303f"}`, background: on ? "linear-gradient(180deg, rgba(217,178,106,.22), rgba(217,178,106,.06))" : "rgba(255,255,255,.02)", color: on ? "#f0d99a" : "#7f8ca1", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 17, fontWeight: 700, letterSpacing: 2, cursor: "pointer" }}>
                <span style={{ display: "block", flex: "none", width: 44, height: 30, borderRadius: 4, border: "1px solid rgba(255,255,255,.4)", backgroundColor: "#0c1018", backgroundImage: l.flag, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }} />
                {l.code}
              </button>
            );
          })}
        </div>
      </div>

      {/* category pills + volume */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14, padding: "22px 54px 0" }}>
        {CATS.map((c) => {
          const on = c === cat;
          return (
            <button key={c} onClick={() => { sfx.click(); switchCat(c === cat ? "ALL GAMES" : c); }} className="sp-hover-gold"
              style={{ flex: "none", whiteSpace: "nowrap", padding: "13px 30px", borderRadius: 34, border: `2px solid ${on ? "#d9b26a" : "#26303f"}`, background: on ? "linear-gradient(180deg, rgba(217,178,106,.22), rgba(217,178,106,.06))" : "rgba(255,255,255,.02)", color: on ? "#f0d99a" : "#7f8ca1", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
              {c}
            </button>
          );
        })}
        <button onClick={() => { cycleVol(); sfx.click(); }} title={VOL_LABELS[vol]} className="sp-hover-gold"
          style={{ marginLeft: "auto", flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "11px 20px 11px 18px", borderRadius: 34, border: "2px solid #2a3345", background: "rgba(255,255,255,.03)", color: "#cdd6e4", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3z" /></svg>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 20 }}>
            {[11, 15, 19].map((h, i) => (
              <span key={i} style={{ display: "block", width: 5, height: h, borderRadius: 2, background: i < vol ? ACCENT : "#2a3345" }} />
            ))}
          </div>
          <span style={{ minWidth: 58, textAlign: "left" }}>{VOL_LABELS[vol]}</span>
        </button>
      </div>

      {/* carousel port */}
      <div ref={portRef} style={{ position: "relative", flex: 1, minHeight: 0, cursor: "grab" }}>
        {list.map((g, i) => (
          <div key={`${g.id}-${i}`} data-mt-i={i} style={{ position: "absolute", left: "50%", top: "50%", width: "min(366px, 33vw)", visibility: "hidden", willChange: "transform, opacity" }}>
            <button onClick={() => pick(i, g.id)} data-mt-btn="1"
              style={{ position: "relative", display: "block", width: "100%", aspectRatio: "33 / 42", maxHeight: "60vh", padding: 0, overflow: "hidden", borderRadius: 24, border: "2px solid #222b3a", background: "linear-gradient(180deg, #10141d 0%, #0a0d14 100%)", cursor: "pointer" }}>
              <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,.04) 0 2px, transparent 2px 18px)" }} />
              <img src={`/space/games/${g.id}.jpg`} alt={g.name} draggable={false}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", pointerEvents: "none" }} />
            </button>
          </div>
        ))}
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 160, pointerEvents: "none", background: "linear-gradient(90deg, rgba(6,7,11,.92), rgba(6,7,11,0))", zIndex: 300 }} />
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 160, pointerEvents: "none", background: "linear-gradient(270deg, rgba(6,7,11,.92), rgba(6,7,11,0))", zIndex: 300 }} />
      </div>

      {/* footer */}
      <div style={{ position: "relative", zIndex: 320, flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 30, padding: "0 54px 36px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "14px 30px", border: "2px solid #2a3345", borderRadius: 16, background: "rgba(255,255,255,.03)" }}>
            <div style={{ fontSize: 15, letterSpacing: 5, color: "#5d6a80" }}>{t.credit}</div>
            <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, color: "#f0d99a" }}>{fmtMKD(balance)}</div>
          </div>
          {/* money in — the bill validator will drive this endpoint on real
              hardware; on a touchscreen this is how credits get loaded */}
          <button onClick={() => { sfx.click(); openCashPanel(); }} className="sp-hover-gold"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 24px", borderRadius: 16, border: "2px solid #2a3345", background: "rgba(255,255,255,.03)", color: "#cdd6e4", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="2.5" y="6" width="19" height="12" rx="2" />
              <circle cx="12" cy="12" r="3" />
              <path d="M6 9.5v5M18 9.5v5" strokeLinecap="round" />
            </svg>
            {t.insert}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 14, letterSpacing: 4, color: "#5d6a80" }}>{selGame.cat === "TABLE" ? "TABLE GAMES" : "ORIGINALS"}</div>
            <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.2 }}>{selGame.name}</div>
          </div>
          <button onClick={() => { sfx.click(); setCashOpen(true); }} className="sp-hover-gold"
            style={{ padding: "20px 46px", borderRadius: 46, border: "2px solid #3a4557", background: "rgba(255,255,255,.04)", color: "#cdd6e4", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: 5, cursor: "pointer" }}>
            {t.cash}
          </button>
          <button onClick={play}
            style={{ padding: "22px 84px", borderRadius: 46, border: "3px solid #f6f1e6", background: "linear-gradient(180deg, #f0d99a 0%, #d9b26a 55%, #a9843e 100%)", color: "#1a1408", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 32, fontWeight: 700, letterSpacing: 8, cursor: "pointer", animation: "mtPulse 2.7s ease-in-out infinite" }}>
            {t.play}
          </button>
        </div>
      </div>

      {cashOpen && <CashoutModal onClose={() => setCashOpen(false)} />}
    </div>
  );
}
