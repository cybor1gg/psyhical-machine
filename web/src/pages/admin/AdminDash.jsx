// The cabinet backoffice DASHBOARD — built for the machine's own touchscreen:
// every control is finger-sized, statistics read by period or by date range,
// the accounting period resets from here, and each game's RTP is set with
// taps, never a keyboard. The deeper desktop pages (Bets feed, Platform
// settings with the audit trail) stay linked from the top bar.
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, apiPut } from "../../api";
import { LoadingScreen } from "../../components/mint/LoadingScreen";
import { gameName } from "../../components/office/games";
import { useAdminGuard } from "./adminShared";
import { fmtMKD } from "../../space/format";
import "./dash.css";

const RANGES = [
  { key: "period", label: "PERIOD" },
  { key: "today", label: "TODAY" },
  { key: "7d", label: "7 DAYS" },
  { key: "30d", label: "30 DAYS" },
  { key: "custom", label: "CUSTOM" },
];

const dstr = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const dshow = (d) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

// actual-vs-target colouring: within a point = healthy, hot = players ahead,
// cold = machine ahead. Small samples swing wildly - that is normal.
const rtpTone = (rtp, target) => {
  if (rtp == null) return "";
  if (target == null) return "";
  const d = rtp - target;
  return d > 1.5 ? " hot" : d < -1.5 ? " cold" : " ok";
};

function RtpEditor({ cfg, onSaved }) {
  const [edge, setEdge] = useState(cfg.houseEdge);
  const [winMin, setWinMin] = useState(cfg.houseEdgeMin ?? 0.005);
  const [winMax, setWinMax] = useState(cfg.houseEdgeMax ?? 0.1);
  const [minBet, setMinBet] = useState(cfg.minBet);
  const [maxBet, setMaxBet] = useState(cfg.maxBet);
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const lo = winMin, hi = winMax;
  const rtp = Math.round((1 - edge) * 10000) / 100;
  const clampEdge = (e) => Math.min(hi, Math.max(lo, Math.round(e * 10000) / 10000));
  const presets = [0.02, 0.035, 0.06, 0.08].filter((e) => e >= lo && e <= hi);

  const save = async () => {
    setBusy(true); setMsg("");
    const body = { gameType: cfg.gameType, minBet, maxBet, enabled };
    if (cfg.rtpConfigurable) {
      body.houseEdge = Math.min(hi, Math.max(lo, edge));
      body.houseEdgeMin = winMin; body.houseEdgeMax = winMax;
    }
    const { ok, data } = await apiPut("/api/admin/config", body);
    setBusy(false);
    setMsg(ok ? "SAVED" : (data?.error || "FAILED").toUpperCase());
    if (ok) onSaved();
  };

  return (
    <div className="ad-editor" onClick={(e) => e.stopPropagation()}>
      {cfg.rtpConfigurable ? (
        <div className="ad-ed-block">
          <span className="ad-ed-label">RTP</span>
          <div className="ad-ed-row">
            <button type="button" className="ad-mini" onClick={() => setEdge((e) => clampEdge(e + 0.005))}>−</button>
            <span className="ad-ed-value">{rtp.toFixed(2)}%</span>
            <button type="button" className="ad-mini" onClick={() => setEdge((e) => clampEdge(e - 0.005))}>+</button>
          </div>
          <div className="ad-ed-presets">
            {presets.map((e) => (
              <button type="button" key={e}
                className={"ad-chip" + (Math.abs(e - edge) < 0.0001 ? " on" : "")}
                onClick={() => setEdge(e)}>
                {((1 - e) * 100).toFixed(1)}%
              </button>
            ))}
          </div>
          <span className="ad-ed-label">ALLOWED WINDOW</span>
          <div className="ad-ed-row small">
            <button type="button" className="ad-mini sm" onClick={() => setWinMax((v) => Math.min(0.5, v + 0.005))}>−</button>
            <span className="ad-ed-value sm">{((1 - winMax) * 100).toFixed(1)}–{((1 - winMin) * 100).toFixed(1)}%</span>
            <button type="button" className="ad-mini sm" onClick={() => setWinMin((v) => Math.max(0.005, v - 0.005))}>+</button>
          </div>
        </div>
      ) : (
        <div className="ad-ed-block"><span className="ad-ed-label">RTP</span>
          <span className="ad-ed-fixed">FIXED BY THE RULES</span></div>
      )}
      <div className="ad-ed-block">
        <span className="ad-ed-label">MIN BET</span>
        <div className="ad-ed-row">
          <button type="button" className="ad-mini" onClick={() => setMinBet((v) => Math.max(0, v - 50))}>−</button>
          <span className="ad-ed-value">{fmtMKD(minBet)}</span>
          <button type="button" className="ad-mini" onClick={() => setMinBet((v) => v + 50)}>+</button>
        </div>
      </div>
      <div className="ad-ed-block">
        <span className="ad-ed-label">MAX BET</span>
        <div className="ad-ed-row">
          <button type="button" className="ad-mini" onClick={() => setMaxBet((v) => Math.max(minBet, v - 500))}>−</button>
          <span className="ad-ed-value">{fmtMKD(maxBet)}</span>
          <button type="button" className="ad-mini" onClick={() => setMaxBet((v) => v + 500)}>+</button>
        </div>
      </div>
      <div className="ad-ed-block">
        <span className="ad-ed-label">GAME</span>
        <button type="button" className={"ad-toggle" + (enabled ? " on" : "")} onClick={() => setEnabled((v) => !v)}>
          {enabled ? "ENABLED" : "DISABLED"}
        </button>
      </div>
      <div className="ad-ed-block ad-ed-save">
        <button type="button" className="ad-save" disabled={busy} onClick={save}>SAVE</button>
        {msg && <span className={"ad-ed-msg" + (msg === "SAVED" ? " good" : " bad")}>{msg}</span>}
      </div>
    </div>
  );
}

export default function AdminDash() {
  const { ready, email, role } = useAdminGuard();
  const navigate = useNavigate();
  useEffect(() => { if (ready && role === "operator") navigate("/operator"); }, [ready, role]); // eslint-disable-line react-hooks/exhaustive-deps
  const [range, setRange] = useState("period");
  const [from, setFrom] = useState(dstr(Date.now() - 6 * 864e5));
  const [to, setTo] = useState(dstr(Date.now()));
  const [stats, setStats] = useState(null);
  const [period, setPeriod] = useState(null);
  const [configs, setConfigs] = useState([]);
  const [open, setOpen] = useState(null);        // expanded game row
  const [askReset, setAskReset] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const query = useCallback(() => {
    if (range === "period") return "?period=1";
    if (range === "today") return `?from=${dstr(Date.now())}&to=${dstr(Date.now())}`;
    if (range === "7d") return `?from=${dstr(Date.now() - 6 * 864e5)}&to=${dstr(Date.now())}`;
    if (range === "30d") return `?from=${dstr(Date.now() - 29 * 864e5)}&to=${dstr(Date.now())}`;
    return `?from=${from}&to=${to}`;
  }, [range, from, to]);

  const load = useCallback(() => {
    apiGet("/api/admin/stats" + query()).then(({ ok, data }) => { if (ok) setStats(data); });
    apiGet("/api/admin/period").then(({ ok, data }) => { if (ok) setPeriod(data); });
    apiGet("/api/admin/config").then(({ ok, data }) => { if (ok) setConfigs(data); });
  }, [query]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  if (!ready) return <LoadingScreen />;

  const t = stats?.totals;
  const cfgOf = (g) => configs.find((c) => c.gameType === g);
  // every configured game shows, even without play in the range
  const gameRows = configs.map((c) => stats?.perGame.find((g) => g.gameType === c.gameType)
    || { gameType: c.gameType, rounds: 0, staked: 0, payout: 0, ggr: 0, rtp: null, targetRtp: c.houseEdge != null ? Math.round((1 - c.houseEdge) * 10000) / 100 : null });

  const doReset = async () => {
    setAskReset(false);
    const { ok } = await apiPost("/api/admin/period/reset", {});
    if (ok) { setRange("period"); load(); }
  };

  return (
    <div className="ad-root">
      <header className="ad-top">
        <div className="ad-title">
          <b>BACKOFFICE</b>
          <span>{email}</span>
        </div>
        <div className="ad-top-btns">
          <button type="button" className="ad-nav" onClick={() => navigate("/admin/bets")}>BETS</button>
          <button type="button" className="ad-nav" onClick={() => navigate("/admin/settings")}>AUDIT</button>
          <button type="button" className="ad-nav dim" onClick={() => navigate("/")}>LOBBY</button>
        </div>
      </header>

      <div className="ad-ranges">
        {RANGES.map((r) => (
          <button type="button" key={r.key}
            className={"ad-range" + (range === r.key ? " on" : "")}
            onClick={() => setRange(r.key)}>
            {r.label}
          </button>
        ))}
        <button type="button" className="ad-range refresh" onClick={load}>⟳</button>
      </div>

      {range === "custom" && (
        <div className="ad-custom">
          <label>FROM <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>TO <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      )}

      {range === "period" && period && (
        <div className="ad-periodbar">
          <span>CURRENT PERIOD SINCE <b>{new Date(period.current.startedAt).getTime() === 0 ? "FIRST PLAY" : dshow(period.current.startedAt)}</b></span>
          <div className="ad-period-btns">
            {period.history.length > 0 && (
              <button type="button" className="ad-ghost" onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? "HIDE" : "HISTORY"}
              </button>
            )}
            <button type="button" className="ad-reset" onClick={() => setAskReset(true)}>RESET PERIOD</button>
          </div>
        </div>
      )}

      {showHistory && period?.history.map((h) => (
        <div className="ad-hist" key={h._id}>
          <span>{dshow(h.startedAt)} → {dshow(h.endedAt)}</span>
          <span>TURNOVER {fmtMKD(h.totals?.wagered ?? 0)}</span>
          <span className={h.totals?.ggr >= 0 ? "good" : "bad"}>RESULT {fmtMKD(h.totals?.ggr ?? 0)}</span>
        </div>
      ))}

      {period?.master && (
        <div className="ad-master">
          <div className="ad-master-head">
            <b>MASTER PERIOD</b>
            <span>SINCE {period.master.since ? dshow(period.master.since) : "FIRST PLAY"} — LIFETIME METERS, NO RESET TOUCHES THESE</span>
          </div>
          <div className="ad-master-row">
            <span><i>TURNOVER</i>{fmtMKD(period.master.wagered)}</span>
            <span><i>PAID OUT</i>{fmtMKD(period.master.won)}</span>
            <span className={period.master.ggr >= 0 ? "good" : "bad"}><i>RESULT</i>{fmtMKD(period.master.ggr)}</span>
            <span><i>ROUNDS</i>{period.master.rounds}</span>
            <span><i>RTP</i>{period.master.rtp != null ? period.master.rtp.toFixed(2) + "%" : "—"}</span>
          </div>
        </div>
      )}

      {t && (
        <div className="ad-cards">
          <div className="ad-card"><span className="ad-card-k">TURNOVER</span><b>{fmtMKD(t.wagered)}</b><span className="ad-card-s">{t.rounds} ROUNDS</span></div>
          <div className="ad-card"><span className="ad-card-k">PAID OUT</span><b>{fmtMKD(t.won)}</b><span className="ad-card-s">{t.wonRounds} WINNING</span></div>
          <div className={"ad-card big" + (t.ggr >= 0 ? " good" : " bad")}><span className="ad-card-k">RESULT</span><b>{fmtMKD(t.ggr)}</b><span className="ad-card-s">HOUSE {t.ggr >= 0 ? "PROFIT" : "LOSS"}</span></div>
          <div className="ad-card"><span className="ad-card-k">ACTUAL RTP</span><b>{t.rtp != null ? t.rtp.toFixed(2) + "%" : "—"}</b><span className="ad-card-s">RETURN TO PLAYERS</span></div>
        </div>
      )}

      <div className="ad-games">
        {gameRows.map((g) => {
          const cfg = cfgOf(g.gameType);
          const isOpen = open === g.gameType;
          return (
            <div key={g.gameType}
              className={"ad-game" + (isOpen ? " open" : "") + (cfg && !cfg.enabled ? " off" : "")}
              onClick={() => setOpen(isOpen ? null : g.gameType)}>
              <div className="ad-game-row">
                <span className="ad-game-name">{gameName(g.gameType)}</span>
                <span className="ad-game-cell"><i>ROUNDS</i>{g.rounds}</span>
                <span className="ad-game-cell"><i>TURNOVER</i>{fmtMKD(g.staked)}</span>
                <span className={"ad-game-cell" + (g.ggr >= 0 ? " good" : " bad")}><i>RESULT</i>{fmtMKD(g.ggr)}</span>
                <span className={"ad-rtp" + rtpTone(g.rtp, g.targetRtp)}>
                  <i>RTP</i>
                  {g.rtp != null ? g.rtp.toFixed(1) + "%" : "—"}
                  {g.targetRtp != null && <em>TARGET {g.targetRtp.toFixed(1)}%</em>}
                </span>
              </div>
              {isOpen && cfg && <RtpEditor cfg={cfg} onSaved={load} />}
            </div>
          );
        })}
      </div>

      {askReset && (
        <div className="ad-modal" onClick={() => setAskReset(false)}>
          <div className="ad-modal-box" onClick={(e) => e.stopPropagation()}>
            <b>RESET PERIOD?</b>
            <p>Statistics collected since {period && new Date(period.current.startedAt).getTime() !== 0 ? dshow(period.current.startedAt) : "first play"} are archived and a new period starts now.</p>
            <div className="ad-modal-row">
              <button type="button" className="ad-ghost" onClick={() => setAskReset(false)}>CANCEL</button>
              <button type="button" className="ad-reset" onClick={doReset}>RESET</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
