// Mines — the "brain". Climb family like tower: start / guess / cashout /
// active. Server-authoritative: mine positions live on the server until the
// round settles; this renders exactly what the API reveals.
import { useState, useEffect, useRef } from "react";
import { apiGet, apiPost } from "../api";
import { sound } from "../lib/sound";
import { reportBalance, reportStakeDebit, reportRoundEnd } from "../lib/operatorBridge";
import { GameBottombar } from "./mint/GameChrome";
import { useStableViewportHeight } from "./mint/FitBox";
import { MinesBoard, MinesSlider, MinesReadout, CashWin } from "./mint/MinesVisuals";
import { useCanvasHeight } from "./mint/BlackjackVisuals";
import { useHiloMobile } from "./mint/HiloVisuals";
import { BetAmountInput, ActionButton, StatField, SelectField, CabinetControlBar } from "./mint/BetPanelLite";

// labelled by TOTAL tiles (client preference), not columns
const GRID_OPTIONS = [
  { value: 25, label: "25" },
  { value: 36, label: "36" },
  { value: 49, label: "49" },
  { value: 64, label: "64" },
];

export default function MinesGame({ initialBalance }) {
  const [amount, setAmount] = useState("10.00");
  const [balance, setBalance] = useState(typeof initialBalance === "number" ? initialBalance : null);
  const maxBet = () => { if (typeof balance === "number" && Number.isFinite(balance)) setAmount(balance.toFixed(2)); };
  const [mines, setMines] = useState(3);
  const [gridSize, setGridSize] = useState(25);
  const [active, setActive] = useState(false);
  const [revealed, setRevealed] = useState({});   // tile -> "gem" | "mine"
  const [picks, setPicks] = useState(0);
  const [mult, setMult] = useState(1);
  const [nextMult, setNextMult] = useState(1.125);
  const [dead, setDead] = useState(false);
  const [cashed, setCashed] = useState(false);
  const [hitTile, setHitTile] = useState(null);
  const [lastGem, setLastGem] = useState(null);
  const [winPop, setWinPop] = useState(null);
  const [pendingTile, setPendingTile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mobile = useHiloMobile();
  const vh = useStableViewportHeight();
  const timers = useRef([]);
  const bet = parseFloat(amount) || 0;

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const money = (v) => (Math.floor(Math.abs(v) * 100 + 1e-9) / 100).toFixed(2);

  // Cash inserted mid-game must be spendable immediately — the validator
  // (and its simulator) broadcast the new balance on this event.
  useEffect(() => {
    const onCash = (e) => setBalance(e.detail.balance);
    window.addEventListener("cabinet:cash-in", onCash);
    return () => window.removeEventListener("cabinet:cash-in", onCash);
  }, []);

  // resume
  const initRan = useRef(false);
  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    apiGet("/api/games/mines/active").then(({ ok, data }) => {
      if (!ok || !data.active) return;
      setGridSize(data.gridSize ?? data.tiles ?? 25); // before the board renders active
      setMines(data.mines);
      setAmount(Number(data.betAmount).toFixed(2));
      const rev = {};
      data.picks.forEach((t) => (rev[t] = "gem"));
      setRevealed(rev);
      setPicks(data.picks.length);
      setMult(data.multiplier);
      setNextMult(data.nextMultiplier);
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
    if (busy || active) return;
    if (typeof balance === "number" && Number.isFinite(balance) && (bet) > balance + 1e-9) { setError("Insufficient balance"); return; }
    sound.prime();
    sound.tileTap();
    setRevealed({});
    setPicks(0);
    setMult(1);
    setDead(false);
    setCashed(false);
    setHitTile(null);
    setLastGem(null);
    setWinPop(null);
    reportStakeDebit(bet); // stake leaves the operator wallet at the tap
    const data = await api("/api/games/mines/start", { betAmount: bet, mines, gridSize });
    if (!data) return;
    if (typeof data.balance === "number") setBalance(data.balance);
    reportBalance(data.balance, null, "stake"); // server truth; round still in flight
    setNextMult(data.ladder[0]);
    setActive(true);
  }

  async function pick(tile) {
    if (busy || !active || pendingTile != null) return;
    sound.prime();
    sound.tileTap();
    setPendingTile(tile);
    const data = await api("/api/games/mines/guess", { tile });
    setPendingTile(null);
    if (!data) return;
    if (!data.won) {
      // bust: bomb on the hit tile, then the rest of the field reveals
      sound.shatter();
      reportRoundEnd(); // bust pays nothing — closes the round for the host
      setActive(false);
      setDead(true);
      setHitTile(tile);
      const rev = {};
      Object.entries(revealedRef.current).forEach(([k, v]) => (rev[k] = v));
      data.mines.forEach((m) => (rev[m] = "mine"));
      setRevealed(rev);
      return;
    }
    sound.gemPing(data.picks);
    setRevealed((r) => ({ ...r, [tile]: "gem" }));
    setPicks(data.picks);
    setMult(data.multiplier);
    setNextMult(data.nextMultiplier ?? data.multiplier);
    setLastGem({ i: tile, mx: data.multiplier, id: Date.now() });
    later(() => setLastGem(null), 1700);
    if (data.top) {
      // found every gem — auto-settled
      sound.cashOut();
      if (typeof data.balance === "number") setBalance(data.balance);
      reportRoundEnd(data.balance); // operator wallet moves with the auto-settle
      setActive(false);
      setDead(true);
      setCashed(true);
      const rev = { ...revealedRef.current, [tile]: "gem" };
      data.mines.forEach((m) => (rev[m] = "mine"));
      setRevealed(rev);
      setWinPop({ mult: data.multiplier, amount: data.payout });
      later(() => setWinPop(null), 3400);
    }
  }

  // pick() closes over `revealed` across awaits — keep a live ref
  const revealedRef = useRef(revealed);
  useEffect(() => { revealedRef.current = revealed; }, [revealed]);

  async function cashout() {
    if (busy || !active || picks < 1) return;
    sound.prime();
    const data = await api("/api/games/mines/cashout");
    if (!data) return;
    sound.cashOut();
    if (typeof data.balance === "number") setBalance(data.balance);
    reportRoundEnd(data.balance); // operator wallet moves with the cash-out
    setActive(false);
    setDead(true);
    setCashed(true);
    const rev = { ...revealedRef.current };
    data.mines.forEach((m) => { if (!rev[m]) rev[m] = "mine"; });
    setRevealed(rev);
    setWinPop({ mult: data.multiplier, amount: data.payout });
    later(() => setWinPop(null), 3400);
  }

  // uniformly random unrevealed (and un-pending) tile → the normal pick path
  function pickRandom() {
    if (busy || !active || dead || pendingTile != null) return;
    const closed = [];
    for (let i = 0; i < gridSize; i++) if (!revealed[i] && pendingTile !== i) closed.push(i);
    if (!closed.length) return;
    pick(closed[Math.floor(Math.random() * closed.length)]);
  }

  // grid change (bet-time only): keep the mine count legal on the new board
  const changeGrid = (v) => {
    const g = Number(v);
    setGridSize(g);
    setMines(Math.min(mines, g - 1));
  };

  const canCashout = active && picks >= 1;
  const canRandom = active && !busy && !dead && pendingTile == null;
  const actionLabel = active
    ? (canCashout ? `Cashout $${money(bet * mult)}` : "Pick a tile")
    : "Bet";

  const gridPicker = (
    <SelectField label="Grid" value={gridSize} onChange={changeGrid}
      options={GRID_OPTIONS} disabled={active || busy} />
  );

  // style-match Keno's Auto Pick secondary button
  const randomBtn = (
    <button onClick={pickRandom} disabled={!canRandom} style={{
      height: 36, borderRadius: "var(--r-md)", border: "1px solid var(--border)",
      background: "var(--surface-raised)", color: "var(--text)",
      fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 12.5,
      cursor: canRandom ? "pointer" : "default", opacity: canRandom ? 1 : 0.5,
    }}>Pick random tile</button>
  );

  const bottombar = <GameBottombar game="mines" />;

  // Desktop: the square board scales to the MEASURED canvas height so every
  // tile + the readout always fit without clipping (same discipline as the
  // blackjack/war card fit). The root is height-pinned (like tower), so the
  // canvas cannot grow when the readout appears — no measure feedback loop.
  // Mobile: fixed width, the page scrolls. Bigger grids keep the same board
  // footprint — the squares just get smaller.
  const [canvasRef, canvasH] = useCanvasHeight();
  const boardMax = mobile ? 392 : Math.max(240, Math.min(480, (canvasH || 560) - 150));

  const board = (
    <div style={{ position: "relative", width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
      {winPop && (
        <div onClick={() => setWinPop(null)} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20, cursor: "pointer" }}>
          <CashWin mult={winPop.mult} profit={money(winPop.amount)} gems={picks} />
        </div>
      )}
      <MinesBoard revealed={revealed} onPick={pick} dead={!active || dead} count={gridSize}
        hitTile={hitTile} cashed={cashed} lastGem={lastGem} pendingTile={pendingTile}
        maxW={boardMax} />
      {/* Always reserve (and mount) the readout so the board never changes
          height on bet — the grid keeps the same tile size and position
          before and after. Fade it in/out instead of popping the layout. */}
      <div style={{ maxWidth: boardMax, width: "100%", margin: "0 auto", opacity: active ? 1 : 0, transition: "opacity var(--dur-base) var(--ease-out)", pointerEvents: active ? "auto" : "none" }}>
        <MinesReadout current={mult} next={nextMult} />
      </div>
    </div>
  );

  // ── MOBILE: scrolling page like roulette/tower — board at NATURAL size on
  // top (no FitBox, so the squares stay big), controls flow below it. The Bet
  // button sits first in the sheet so it's on screen right under the board;
  // pushing the slider/amount further down is the accepted trade.
  if (mobile) {
    return (
      <div style={{ minHeight: vh, display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
        <div style={{ flex: "0 0 auto", position: "relative", padding: "10px 8px 12px", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }}>
          {board}
        </div>
        <div style={{ flex: "1 1 auto", padding: "8px 12px 14px", display: "flex", flexDirection: "column", gap: 8, background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
          {error && (
            <div style={{ padding: "8px 12px", borderRadius: "var(--r-md)", background: "rgba(225,91,76,0.12)", border: "1px solid rgba(225,91,76,0.4)", color: "var(--loss)", fontSize: "var(--fs-caption)", fontWeight: 600 }}>{error}</div>
          )}
          <ActionButton label={actionLabel} tone={active ? "gold" : "primary"} glow={!active}
            onClick={active ? cashout : start} disabled={busy || (active && !canCashout)} small />
          {randomBtn}
          {gridPicker}
          <div>
            <div style={{ marginBottom: 4, fontSize: "var(--fs-caption)", color: "var(--text-muted)", fontWeight: 600, fontFamily: "var(--font-display)" }}>Number of Mines</div>
            <MinesSlider mines={mines} setMines={setMines} maxMines={gridSize - 1} disabled={active || busy} />
          </div>
          <BetAmountInput value={amount} onChange={setAmount} disabled={active}
            onHalf={() => setAmount(String(Math.max(0, bet / 2).toFixed(2)))}
            onDouble={() => setAmount(String((bet * 2).toFixed(2)))}
            onMax={maxBet} label="Bet Amount" small />
        </div>
        {bottombar}
      </div>
    );
  }

  // ── CABINET: the board owns the whole screen, controls docked bottom ──
  // (height pinned: the board fits itself to the measured canvas height, so
  // the page must never scroll)
  return (
    <div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <div ref={canvasRef} style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 26px 10px", boxSizing: "border-box", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(60% 40% at 50% 0%, rgba(70,180,140,0.08), transparent 70%)" }} />
        {board}
      </div>
      <CabinetControlBar
        amount={amount} onAmount={setAmount} betLocked={active} onMax={maxBet}
        actionLabel={actionLabel} actionTone={active ? "gold" : "primary"} glow={!active}
        onAction={active ? cashout : start} actionDisabled={busy || (active && !canCashout)}
        error={error} secondary={randomBtn}
      >
        {/* setup pickers before the round, the live gems readout during it —
            never both, so the strip always fits the screen */}
        {!active ? (
          <>
            <div style={{ flex: "0 0 auto", minWidth: 150 }}>
              {gridPicker}
            </div>
            <div style={{ flex: "0 0 auto", minWidth: 190 }}>
              <div>
                <div style={{ marginBottom: 6, fontSize: "var(--fs-caption)", color: "var(--text-muted)", fontWeight: 600 }}>Number of Mines</div>
                <MinesSlider mines={mines} setMines={setMines} maxMines={gridSize - 1} disabled={active || busy} />
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: "0 0 auto", minWidth: 170 }}>
            <StatField label={`Gems found: ${picks} / ${gridSize - mines}`} value={`×${mult.toFixed(4)}`} tone="mint" />
          </div>
        )}
      </CabinetControlBar>
      {bottombar}
    </div>
  );
}
