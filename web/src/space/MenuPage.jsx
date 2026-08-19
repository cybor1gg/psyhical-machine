// Main Menu — port of the "Pod Terminal UI" prototype: trilingual header,
// category pills, momentum cover-flow carousel of the 12 game cards, credits
// chip, CASHOUT and the pulsing gold PLAY. Carousel physics (drag, inertia
// friction .95, snap glide with cubic easing, tick per notch, tap-to-center,
// infinite wrap) ported from the prototype's logic class.
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useBalance } from "../lib/balanceStore";
import { fmtMKD } from "./format";
import { openCashPanel } from "../kiosk/CashSimulator";
import { sfx, armAmbientOnGesture, startAmbient } from "./spaceAudio";
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
  { id: "bonanza", name: "NOVA BONANZA", cat: "ORIGINALS" },
  { id: "lander", name: "STAR LANDER", cat: "ORIGINALS" },
];
// Card id → app route (bj is the design's id for blackjack).
const ROUTE = { bj: "/games/blackjack" };
const routeFor = (id) => ROUTE[id] || `/games/${id}`;

const LANGS = [
  { code: "MK", flag: "radial-gradient(circle at 50% 50%, #ffd233 0 20%, rgba(255,210,51,0) 21%), conic-gradient(from 22deg, #ffd233 0 9deg, #d20000 9deg 36deg, #ffd233 36deg 45deg, #d20000 45deg 81deg, #ffd233 81deg 90deg, #d20000 90deg 126deg, #ffd233 126deg 135deg, #d20000 135deg 171deg, #ffd233 171deg 180deg, #d20000 180deg 216deg, #ffd233 216deg 225deg, #d20000 225deg 261deg, #ffd233 261deg 270deg, #d20000 270deg 306deg, #ffd233 306deg 315deg, #d20000 315deg 360deg)" },
  { code: "EN", flag: 'url("/space/flags/uk.png")' },
  { code: "EL", flag: 'url("/space/flags/gr.png")' },
];
const COPY = {
  MK: { play: "ИГРАЈ", credit: "КРЕДИТ", cash: "ИСПЛАТА", insert: "ВНЕСИ ПАРИ" },
  EN: { play: "PLAY", credit: "CREDIT", cash: "CASHOUT", insert: "INSERT CASH" },
  EL: { play: "ΠΑΙΞΕ", credit: "ΥΠΟΛΟΙΠΟ", cash: "ΕΞΑΡΓΥΡΩΣΗ", insert: "ΕΙΣΑΓΩΓΗ" },
};

const tint = (a) => `rgba(217, 178, 106, ${a})`;

// Where the player left the carousel. Module scope, so coming back from a game
// lands on the same card mid-scroll instead of snapping back to the first one.
// A page reload starts fresh, which is what you want on a cabinet reboot.
const lastPick = { pos: 0, sel: null };

export default function MenuPage() {
  const [sel, setSel] = useState(() => lastPick.sel || "hilo");
  const [lang, setLang] = useState(() => { try { return window.localStorage.getItem("space_lang") || "EN"; } catch { return "EN"; } });
  const [langOpen, setLangOpen] = useState(false);
  const balance = useBalance() ?? 0;
  const navigate = useNavigate();

  const selRef = useRef(sel);
  selRef.current = sel;
  const rootRef = useRef(null);
  const portRef = useRef(null);
  const m = useRef({ pos: 0, vel: 0, tween: null, drag: null, movedAt: 0, notch: undefined, lockSel: null, cards: null, list: GAMES, raf: 0, run: false, parkPos: NaN, timer: 0, wake: null, hinted: false }).current;

  useEffect(() => { try { window.localStorage.setItem("space_lang", lang); } catch { /* fine */ } }, [lang]);
  useEffect(() => { armAmbientOnGesture(); }, []);

  // no category filter any more — the carousel is simply every game
  const visible = useCallback(() => GAMES, []);

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
    if (m.wake) m.wake();
  };

  // rAF cover-flow loop — writes card transforms directly (never through
  // React state), exactly like the prototype.
  useEffect(() => {
    m.run = true;
    m.list = visible();
    m.cards = null;
    // resume exactly where we left off; a category switch still resets,
    // matching the prototype
    m.pos = lastPick.pos || 0;
    m.vel = 0; m.tween = null; m.lockSel = null; m.notch = undefined;
    // The cards are the one thing on this screen with no other route onto a
    // compositor layer: their transforms are written here as inline styles,
    // not by a CSS animation or a transition. So they get the hint — but only
    // while the wheel is actually turning. Gecko charges will-change against a
    // document-wide budget by border-box area, and fourteen cards holding a
    // claim while perfectly still is budget spent on nothing.
    const hint = (on) => {
      if (m.hinted === on) return;
      m.hinted = on;
      cardEls().forEach((el) => { el.style.willChange = on ? "transform, opacity" : ""; });
    };
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
      // Park the loop when the wheel has fully settled: a parked carousel
      // costs 5 ticks/s of maintenance instead of 60fps of style writes.
      // Any interaction (drag, glide, fling) un-parks on the next tick.
      const parked = !m.drag && !m.tween && m.vel === 0 && m.pos === m.parkPos;
      m.parkPos = m.pos;
      if (parked) { hint(false); m.timer = setTimeout(() => { m.raf = requestAnimationFrame(tick); }, 200); }
      else m.raf = requestAnimationFrame(tick);
    };
    m.wake = () => {
      if (!m.run) return;
      clearTimeout(m.timer);
      cancelAnimationFrame(m.raf);
      m.parkPos = NaN;
      hint(true);
      m.raf = requestAnimationFrame(tick);
    };
    // first tick runs synchronously so the cards are laid out immediately,
    // even before the first animation frame is delivered
    tick();
    return () => {
      m.run = false;
      cancelAnimationFrame(m.raf);
      clearTimeout(m.timer);
      lastPick.pos = m.pos; lastPick.sel = selRef.current;
    };
  }, [visible]);

  // Drag physics (pointer events on the whole carousel port).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onDown = (e) => {
      const btn = e.target.closest && e.target.closest("button");
      if (btn && !btn.hasAttribute("data-mt-btn")) return;
      m.drag = { x: e.clientX, start: e.clientX, t: performance.now(), vx: 0, moved: false };
      m.vel = 0; m.tween = null;
      if (m.wake) m.wake();
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

  // Tapping the card IS the play button now. The centred card launches; a
  // card off to the side glides to the middle first, so a mis-tap while
  // browsing brings the game into view instead of starting it.
  const play = (id) => { sfx.select(); startAmbient(); navigate(routeFor(id || sel)); };

  const pick = (i, id) => {
    if (m.movedAt && performance.now() - m.movedAt < 220) return;
    const N = m.list.length;
    const centred = ((Math.round(m.pos) % N) + N) % N === i;
    if (centred) { play(id); return; }
    const k = Math.round((m.pos - i) / N);
    m.vel = 0;
    sfx.select();
    glideTo(i + k * N);
    m.lockSel = id;
    setSel(id);
  };

  const t = COPY[lang] || COPY.EN;
  const curLang = LANGS.find((l) => l.code === lang) || LANGS[1];
  const list = visible();
  m.list = list;
  m.cards = null;

  const orbs = [
    { left: "5%", top: "12%", size: 280, fill: "rgba(217,178,106,.30)", dur: "9s", delay: "0s" },
    { left: "70%", top: "4%", size: 320, fill: "rgba(123,63,212,.26)", dur: "11s", delay: "1.5s" },
    { left: "38%", top: "58%", size: 380, fill: "rgba(217,178,106,.16)", dur: "13s", delay: ".8s" },
    { left: "85%", top: "62%", size: 260, fill: "rgba(90,140,255,.18)", dur: "10s", delay: "2.2s" },
    { left: "16%", top: "70%", size: 300, fill: "rgba(123,63,212,.18)", dur: "12s", delay: "3s" },
    { left: "56%", top: "20%", size: 190, fill: "rgba(240,217,154,.20)", dur: "8s", delay: "1s" },
  ];

  return (
    <div ref={rootRef} style={{ position: "relative", zIndex: 1, width: "100vw", height: "100vh", minHeight: 500, overflow: "hidden", display: "flex", flexDirection: "column", background: "transparent", fontFamily: "'DM Sans', Helvetica, Arial, sans-serif", color: "#f0ece4", touchAction: "none", userSelect: "none" }}>
      {/* No ambience of its own any more: the shared backdrop IS the sky, so
          the lobby and every game show pixel-identical stars and sun. */}

      {/* carousel port */}
      <div ref={portRef} style={{ position: "relative", flex: 1, minHeight: 0, cursor: "grab" }}>
        {list.map((g, i) => (
          // will-change is set by the rAF loop while the wheel turns, not here
          <div key={`${g.id}-${i}`} data-mt-i={i} style={{ position: "absolute", left: "50%", top: "50%", width: "min(366px, 33vw)", visibility: "hidden" }}>
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

      {/* footer — language, credits, money in */}
      <div style={{ position: "relative", zIndex: 340, flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: "0 54px 34px" }}>
        {/* the ONLY money-in control on the lobby: CashSimulator keeps its
            floating opener for the game screens, where there is no room for
            a labelled one, and hides it here so there are not two. */}
        <button onClick={() => { sfx.click(); openCashPanel(); }} className="sp-hover-gold"
          style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "16px 28px", borderRadius: 999, border: "1px solid rgba(217,178,106,.3)", background: "rgba(217,178,106,.07)", color: "#e6dcc4", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 17, fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="2.5" y="6" width="19" height="12" rx="2" />
            <circle cx="12" cy="12" r="3" />
            <path d="M6 9.5v5M18 9.5v5" strokeLinecap="round" />
          </svg>
          {t.insert}
        </button>
        {/* no box around the credits — the number itself is the readout */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <div style={{ fontSize: 13, letterSpacing: 6, color: "#6b789a", textTransform: "uppercase" }}>{t.credit}</div>
          <div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1, color: "#f0d99a", letterSpacing: 1, textShadow: "0 0 26px rgba(240,217,154,.45), 0 0 70px rgba(240,217,154,.18)" }}>{fmtMKD(balance)}</div>
        </div>

        {/* language picker: bottom-right, opens upward, right-aligned */}
        <div style={{ position: "relative", flex: "none" }}>
          <button onClick={() => { sfx.click(); setLangOpen((o) => !o); }} className="sp-hover-gold"
            style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 26px", borderRadius: 18, border: "1px solid rgba(217,178,106,.3)", background: "rgba(8,11,18,.55)", color: "#e6dcc4", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 24, fontWeight: 700, letterSpacing: 3, cursor: "pointer" }}>
            <span style={{ display: "block", flex: "none", width: 52, height: 35, borderRadius: 5, backgroundColor: "#0c1018", backgroundImage: curLang.flag, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }} />
            {curLang.code}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
              style={{ opacity: .7, transform: langOpen ? "rotate(180deg)" : "none", transition: "transform .18s ease" }}>
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {langOpen && (
            <div style={{ position: "absolute", bottom: "calc(100% + 10px)", right: 0, display: "flex", flexDirection: "column", gap: 4, padding: 8, borderRadius: 18, border: "1px solid rgba(217,178,106,.3)", background: "rgba(8,11,18,.97)", boxShadow: "0 -18px 44px rgba(0,0,0,.6)" }}>
              {LANGS.filter((l) => l.code !== lang).map((l) => (
                <button key={l.code} onClick={() => { sfx.click(); setLang(l.code); setLangOpen(false); }} className="sp-hover-gold"
                  style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 26px 14px 18px", borderRadius: 14, border: "none", background: "transparent", color: "#cdd6e4", fontFamily: "'DM Sans', Helvetica, sans-serif", fontSize: 24, fontWeight: 700, letterSpacing: 3, cursor: "pointer", whiteSpace: "nowrap" }}>
                  <span style={{ display: "block", flex: "none", width: 52, height: 35, borderRadius: 5, backgroundColor: "#0c1018", backgroundImage: l.flag, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }} />
                  {l.code}
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
