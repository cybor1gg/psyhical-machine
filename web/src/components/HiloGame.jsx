// MintBets Hilo v2 — server-driven calls (higher/lower/same), dedicated mobile
// layout: topbar → history strip → table → bottom controls (matching the
// mobile design reference). Desktop keeps the panel-left / canvas-right shell.
import { useState, useEffect, useRef } from "react";
import { apiGet, apiPost } from "../api";
import { sound } from "../lib/sound";
import { reportBalance, reportStakeDebit, reportRoundEnd } from "../lib/operatorBridge";
import { GameBottombar } from "./mint/GameChrome";
import { useStableViewportHeight } from "./mint/FitBox";
import { cardFromApi } from "./mint/PlayingCard";
import { HiloTable, HiloHistory, HiloWinPopup, SkipButton, useHiloMobile, useShortViewport } from "./mint/HiloVisuals";
import { BetAmountInput, StatField, ActionButton, CabinetControlBar } from "./mint/BetPanelLite";

// onHome: back-to-lobby handler. Passed only by the direct-player page —
// embeds have no lobby, so the button simply doesn't render there.
export default function HiloGame({ initialBalance }) {
  const [amount, setAmount] = useState("10.00");
  const [balance, setBalance] = useState(typeof initialBalance === "number" ? initialBalance : null);
  const maxBet = () => { if (typeof balance === "number" && Number.isFinite(balance)) setAmount(balance.toFixed(2)); };
  const [active, setActive] = useState(false);
  const [cur, setCur] = useState(null);
  const [hist, setHist] = useState([]);
  const [mult, setMult] = useState(1);
  const [calls, setCalls] = useState(null);      // [highSide, lowSide] from server
  const [flash, setFlash] = useState(null);
  const [winPop, setWinPop] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mobile = useHiloMobile();
  const vh = useStableViewportHeight();
  const short = useShortViewport(); // landscape phone

  const bet = parseFloat(amount) || 0;

  // Money shown must match what the server actually pays. The server truncates
  // to 2dp (never rounds up), so toFixed() here would round a $11.575 payout up
  // to "$11.58" while the wallet only ever receives $11.57.
  const money = (v) => (Math.floor(v * 100 + 1e-9) / 100).toFixed(2);

  // Update the table card WITHOUT re-dealing when it's the same card. cur.id
  // keys the PlayingCard, so a fresh object replays the deal animation — right
  // for actual deals, a visible blink when the card never moved (initial
  // double-fetch in StrictMode, cashout returning the carried-over card).
  function setCurCard(apiCard) {
    setCur((prev) => (prev && apiCard && prev.index === apiCard.index ? prev : cardFromApi(apiCard)));
  }

  // Fetch the pre-bet table card (server-drawn, verifiable, skippable).
  async function loadTable(withSound = false) {
    const { ok, data } = await apiGet("/api/games/hilo/table");
    if (!ok || data.active) return;
    if (withSound) sound.cardDeal();
    setCurCard(data.card);
    setCalls(data.calls);
  }

  // Cash inserted mid-game must be spendable immediately — the validator
  // (and its simulator) broadcast the new balance on this event.
  useEffect(() => {
    const onCash = (e) => setBalance(e.detail.balance);
    window.addEventListener("cabinet:cash-in", onCash);
    return () => window.removeEventListener("cabinet:cash-in", onCash);
  }, []);

  // Guard: StrictMode runs mount effects twice in dev; without this the table
  // card is fetched twice and the second response restarts the deal animation.
  const initRan = useRef(false);

  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    apiGet("/api/games/hilo/active").then(({ ok, data }) => {
      if (!ok || !data.active) {
        loadTable(false); // no round → show the table card, face up
        return;
      }
      const cards = (data.cards || []).map(cardFromApi);
      const entries = cards.map((card, i) => {
        if (i === 0) return { card, tag: "start", dir: null, win: null };
        const g = (data.guesses || [])[i - 1] || {};
        if (g.choice === "skip") return { card, tag: "skip", dir: null, win: null };
        const dir = g.choice === "higher" ? "hi" : g.choice === "lower" ? "lo" : "same";
        return { card, tag: g.stepTotal ?? data.multiplier, dir, win: true };
      });
      setHist(entries);
      setCur(cards[cards.length - 1] || null);
      setMult(data.multiplier);
      setCalls(data.calls);
      // Restore the round's real stake — the input defaults to 10.00 on reload,
      // which would otherwise make the cashout/profit figures lie.
      if (data.betAmount != null) setAmount(Number(data.betAmount).toFixed(2));
      setActive(true);
    });
  }, []);

  async function api(path, body) {
    setBusy(true);
    setError("");
    const { ok, data } = await apiPost(path, body);
    setBusy(false);
    if (!ok) {
      setError(data.error || "Something went wrong");
      return null;
    }
    return data;
  }

  async function start() {
    if (busy) return;
    if (typeof balance === "number" && Number.isFinite(balance) && (bet) > balance + 1e-9) { setError("Insufficient balance"); return; }
    // Feedback belongs to the CLICK, not the response — the sound plays now
    // and the response only lights up the call cards. The card itself must not
    // re-deal: betting keeps the exact card on the table (v3 invariant).
    sound.prime();
    sound.cardDeal();
    setWinPop(null);
    reportStakeDebit(bet); // stake leaves the operator wallet at the tap
    const data = await api("/api/games/hilo/start", { betAmount: bet });
    if (!data) return;
    if (typeof data.balance === "number") setBalance(data.balance);
    reportBalance(data.balance, null, "stake"); // server truth; round still in flight
    setCurCard(data.card);
    setHist([{ card: cur || cardFromApi(data.card), tag: "start", dir: null, win: null }]);
    setMult(1);
    setCalls(data.calls);
    setActive(true);
    setFlash(null);
  }

  async function makeCall(call) {
    if (!active || busy || !call) return;
    // Flip sound at click; win/loss sounds stay on the response (outcomes
    // aren't known yet — celebrating early would lie).
    sound.prime();
    sound.cardFlip();
    const data = await api("/api/games/hilo/guess", { choice: call.choice });
    if (!data) return;
    const card = cardFromApi(data.card);
    const dir = call.choice === "higher" ? "hi" : call.choice === "lower" ? "lo" : "same";
    setCur(card);
    if (!data.won) {
      // bust lands silently (client preference — no defeat beat on any Original)
      reportRoundEnd(); // bust pays nothing — closes the round for the host
      setHist((h) => [...h, { card, tag: "bust", dir, win: false }]);
      setActive(false);
      setMult(0);
      setFlash("loss");
      // The bust card stays on the table as the next round's start card (server
      // holds it in pendingHilo); show its greyed odds and clear the red ring
      // once the loss beat plays. Only Skip changes the card from here.
      setCalls(data.calls || null);
      setTimeout(() => setFlash(null), 1200);
      return;
    }
    sound.tick(data.multiplier);
    setMult(data.multiplier);
    setCalls(data.calls);
    setHist((h) => [...h, { card, tag: data.multiplier, dir, win: true }]);
    setFlash(null);
  }

  async function skip() {
    if (busy) return;
    sound.prime();
    sound.cardDeal(); // click-time feedback; the new card lands on response
    const data = await api("/api/games/hilo/skip");
    if (!data) return;
    const card = cardFromApi(data.card);
    setCur(card);
    setCalls(data.calls);
    if (!data.preBet && active) {
      setHist((h) => [...h, { card, tag: "skip", dir: null, win: null }]);
    }
    setFlash(null);
  }

  async function cashout() {
    if (!active || busy) return;
    sound.prime();
    const data = await api("/api/games/hilo/cashout");
    if (!data) return;
    sound.cashOut();
    if (typeof data.balance === "number") setBalance(data.balance);
    reportRoundEnd(data.balance); // operator wallet moves with the cash-out
    setActive(false);
    setFlash("win");
    // The card cashed out on stays as the next round's start card (server holds
    // it in pendingHilo); show its greyed odds. Only Skip changes it.
    setCalls(data.calls || null);
    setWinPop({ mult, amount: data.payout });
    setTimeout(() => setWinPop(null), 3400);
    setTimeout(() => setFlash(null), 3400);
  }

  const canCashout = active && hist.some((e) => e.win === true);
  const actionLabel = active ? (canCashout ? `Cashout $${money(bet * mult)}` : "Make a call first") : "Bet";

  const bottombar = <GameBottombar game="hilo" />;

  const table = (
    <HiloTable
      cur={cur} faceDown={!cur} flash={flash} active={active && !busy}
      calls={calls} onCall={makeCall} onSkip={skip} skipEnabled={!busy}
    />
  );

  const histEntries = hist.length ? hist : (cur ? [{ card: cur, tag: "start", dir: null, win: null }] : []);

  // ── MOBILE: viewport-locked — topbar → history → table (scales) → controls ──
  if (mobile) {
    return (
      <div style={{ height: vh, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
        {/* The history tray is the first thing to go in landscape — even as a
            42px pill strip it's height the table and controls need more. */}
        {!short && histEntries.length > 0 && (
          <div style={{ flex: "0 0 auto", padding: "10px 10px 0" }}>
            <HiloHistory hist={histEntries} compact />
          </div>
        )}
        {/* Table SCALES to the space between history and controls — the page
            never scrolls, so the bet button is always on screen. */}
        <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 6px" }}>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }} />
          {winPop && <div onClick={() => setWinPop(null)} style={{ position: "absolute", inset: 0, zIndex: 29, cursor: "pointer", background: "rgba(0,0,0,0.45)", animation: "rl-fade 240ms ease-out" }} />}
          {winPop && <HiloWinPopup mult={winPop.mult} amount={winPop.amount} />}
          {/* HiloTable fits itself to this flex:1 slot (see its layout-effect
              scaler). Do NOT wrap it in FitBox — a second scaler reading this
              table's own shrink-to-content height oscillates into a flashing
              loop when height is the binding constraint. Desktop renders it
              bare for the same reason. */}
          {table}
        </div>
        {/* Landscape: one row — amount | skip | action. Keeps the primary button
            on screen instead of pushing it ~220px below the fold. */}
        {short ? (
          <div style={{ position: "relative", flex: "0 0 auto", padding: "8px 10px 10px", display: "flex", alignItems: "flex-end", gap: 8, background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
            {error && (
              <div style={{ position: "absolute", left: 10, right: 10, bottom: "calc(100% + 6px)", zIndex: 40, padding: "7px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.24)", border: "1px solid rgba(225,91,76,0.5)", color: "var(--loss)", fontSize: "var(--fs-sm)", fontWeight: 600, textAlign: "center", animation: "mb-rise var(--dur-fast) var(--ease-out)" }}>{error}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <BetAmountInput value={amount} onChange={setAmount} disabled={active}
                onHalf={() => setAmount(String(Math.max(0, bet / 2).toFixed(2)))}
                onDouble={() => setAmount(String((bet * 2).toFixed(2)))}
                onMax={maxBet} label={`Bet Amount · ${mult.toFixed(2)}×`} />
            </div>
            <SkipButton onClick={skip} disabled={busy} compact />
            <div style={{ flex: "0 0 auto", width: 160 }}>
              <ActionButton label={actionLabel} tone={active ? "gold" : "primary"} glow={!active}
                onClick={active ? cashout : start} disabled={busy || (active && !canCashout)} />
            </div>
          </div>
        ) : (
          <div style={{ flex: "0 0 auto", maxHeight: "60%", overflowY: "auto", padding: "8px 12px 14px", display: "flex", flexDirection: "column", gap: 8, background: "var(--surface)", borderTop: "1px solid var(--border)", animation: "mb-rise var(--dur-base) var(--ease-out)" }}>
            {/* Bet/Cashout FIRST: after a round you re-bet with one tap,
                without scrolling past skip and the amount field */}
            {error && (
              <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-caption)", fontWeight: 600, animation: "mb-rise var(--dur-fast) var(--ease-out)" }}>{error}</div>
            )}
            <ActionButton label={actionLabel} tone={active ? "gold" : "primary"} glow={!active}
              onClick={active ? cashout : start} disabled={busy || (active && !canCashout)} small />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", fontWeight: 600 }}>Total Profit</span>
              <span key={mult} style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 13.5, color: "var(--mint-bright)", padding: "3px 9px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", animation: "mb-pop-scale 260ms var(--ease-bounce)" }}>
                ${money(active || flash === "win" ? bet * mult : 0)} · {mult.toFixed(2)}×
              </span>
            </div>
            <SkipButton onClick={skip} disabled={busy} />
            <BetAmountInput value={amount} onChange={setAmount} disabled={active}
              onHalf={() => setAmount(String(Math.max(0, bet / 2).toFixed(2)))}
              onDouble={() => setAmount(String((bet * 2).toFixed(2)))}
              onMax={maxBet} label="Bet Amount" small />
          </div>
        )}
        {bottombar}
      </div>
    );
  }

  // ── CABINET: the table owns the whole screen, controls docked bottom ──────────────────────
  return (
    <div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column", gap: 12, padding: "14px 26px 10px", boxSizing: "border-box", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }} />
        {winPop && <div onClick={() => setWinPop(null)} style={{ position: "absolute", inset: 0, zIndex: 29, cursor: "pointer", background: "rgba(0,0,0,0.45)", animation: "rl-fade 240ms ease-out" }} />}
        {winPop && <HiloWinPopup mult={winPop.mult} amount={winPop.amount} />}

        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
          {table}
        </div>
        <div style={{ flex: "0 0 auto", width: "100%", display: "flex", justifyContent: "center", paddingBottom: 2 }}>
          <div style={{ width: "min(760px, 94%)" }}>
            <HiloHistory hist={histEntries} />
          </div>
        </div>
      </div>
      <CabinetControlBar
        amount={amount} onAmount={setAmount} betLocked={active} onMax={maxBet}
        actionLabel={actionLabel}
        actionTone={active ? "gold" : "primary"}
        glow={!active}
        onAction={active ? cashout : start}
        actionDisabled={busy || (active && !canCashout)}
        error={error}
      >
        <div style={{ flex: "0 0 auto", minWidth: 170 }}>
            <StatField label={`Total Profit (${mult.toFixed(2)}\u00d7)`} value={`$${money(active || flash === "win" ? bet * mult : 0)}`} tone="mint" />
        </div>
        <div style={{ flex: "0 0 auto", minWidth: 150 }}>
          <SkipButton onClick={skip} disabled={busy} />
        </div>
      </CabinetControlBar>
      {bottombar}
    </div>
  );
}
