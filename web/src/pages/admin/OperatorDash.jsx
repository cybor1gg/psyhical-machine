// The OPERATOR panel — the floor key, not the office key. An operator sees
// the current accounting period, resets it, and reads the machine's MASTER
// meters (lifetime, never resettable). No RTP, no configs, no ledgers:
// those live behind the admin login.
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../../api";
import { LoadingScreen } from "../../components/mint/LoadingScreen";
import { useAdminGuard } from "./adminShared";
import { fmtMKD } from "../../space/format";
import "./dash.css";

const dshow = (d) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

export default function OperatorDash() {
  const { ready, email } = useAdminGuard();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [period, setPeriod] = useState(null);
  const [askReset, setAskReset] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(() => {
    apiGet("/api/admin/stats?period=1").then(({ ok, data }) => { if (ok) setStats(data); });
    apiGet("/api/admin/period").then(({ ok, data }) => { if (ok) setPeriod(data); });
  }, []);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  if (!ready) return <LoadingScreen />;

  const t = stats?.totals;
  const m = period?.master;

  const doReset = async () => {
    setAskReset(false);
    const { ok } = await apiPost("/api/admin/period/reset", {});
    if (ok) load();
  };

  return (
    <div className="ad-root">
      <header className="ad-top">
        <div className="ad-title"><b>OPERATOR</b><span>{email}</span></div>
        <div className="ad-top-btns">
          <button type="button" className="ad-nav" onClick={load}>REFRESH</button>
          <button type="button" className="ad-nav dim" onClick={() => navigate("/")}>LOBBY</button>
        </div>
      </header>

      {period && (
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
          <span>BY {h.closedBy || "—"}</span>
        </div>
      ))}

      {t && (
        <div className="ad-cards">
          <div className="ad-card"><span className="ad-card-k">TURNOVER</span><b>{fmtMKD(t.wagered)}</b><span className="ad-card-s">{t.rounds} ROUNDS</span></div>
          <div className="ad-card"><span className="ad-card-k">PAID OUT</span><b>{fmtMKD(t.won)}</b><span className="ad-card-s">{t.wonRounds} WINNING</span></div>
          <div className={"ad-card" + (t.ggr >= 0 ? " good" : " bad")}><span className="ad-card-k">RESULT</span><b>{fmtMKD(t.ggr)}</b><span className="ad-card-s">HOUSE {t.ggr >= 0 ? "PROFIT" : "LOSS"}</span></div>
          <div className="ad-card"><span className="ad-card-k">ACTUAL RTP</span><b>{t.rtp != null ? t.rtp.toFixed(2) + "%" : "—"}</b><span className="ad-card-s">THIS PERIOD</span></div>
        </div>
      )}

      {m && (
        <div className="ad-master">
          <div className="ad-master-head">
            <b>MASTER PERIOD</b>
            <span>SINCE {m.since ? dshow(m.since) : "FIRST PLAY"} — LIFETIME METERS, NO RESET TOUCHES THESE</span>
          </div>
          <div className="ad-master-row">
            <span><i>TURNOVER</i>{fmtMKD(m.wagered)}</span>
            <span><i>PAID OUT</i>{fmtMKD(m.won)}</span>
            <span className={m.ggr >= 0 ? "good" : "bad"}><i>RESULT</i>{fmtMKD(m.ggr)}</span>
            <span><i>ROUNDS</i>{m.rounds}</span>
            <span><i>RTP</i>{m.rtp != null ? m.rtp.toFixed(2) + "%" : "—"}</span>
          </div>
        </div>
      )}

      {askReset && (
        <div className="ad-modal" onClick={() => setAskReset(false)}>
          <div className="ad-modal-box" onClick={(e) => e.stopPropagation()}>
            <b>RESET PERIOD?</b>
            <p>Statistics collected this period are archived and a new period starts now. The MASTER meters are not affected.</p>
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
