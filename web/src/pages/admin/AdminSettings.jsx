// The AUDIT TRAIL, in the backoffice's touch language: every money-adjacent
// change on the machine — config edits, period resets — as finger-sized rows
// with the before → after visible in place. Game configuration itself lives
// on the dashboard: tap any game row there.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../../api";
import { LoadingScreen } from "../../components/mint/LoadingScreen";
import { gameName } from "../../components/office/games";
import { useAdminGuard } from "./adminShared";
import "./dash.css";

const when = (d) => {
  const x = new Date(d);
  return x.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " +
    x.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
};

const ACTION = {
  "platform.config.update": "CONFIG CHANGE",
  "platform.period.reset": "PERIOD RESET",
};

// the human-readable diff of a config change: only what actually moved
function diff(before, after) {
  if (!before || !after) return [];
  const out = [];
  const F = [
    ["houseEdge", (v) => ((1 - v) * 100).toFixed(2) + "% RTP"],
    ["minBet", (v) => "min " + v],
    ["maxBet", (v) => "max " + v],
    ["enabled", (v) => (v ? "enabled" : "disabled")],
  ];
  for (const [k, fmt] of F) {
    if (before[k] !== undefined && after[k] !== undefined && before[k] !== after[k]) {
      out.push(`${fmt(before[k])} → ${fmt(after[k])}`);
    }
  }
  return out;
}

export default function AdminSettings() {
  const { ready, email } = useAdminGuard();
  const navigate = useNavigate();
  const [audit, setAudit] = useState(null);

  useEffect(() => {
    if (ready) apiGet("/api/admin/audit?limit=60").then(({ ok, data }) => { if (ok) setAudit(data); });
  }, [ready]);

  if (!ready) return <LoadingScreen />;

  return (
    <div className="ad-root">
      <header className="ad-top">
        <div className="ad-title"><b>AUDIT TRAIL</b><span>{email}</span></div>
        <div className="ad-top-btns">
          <button type="button" className="ad-nav" onClick={() => navigate("/admin")}>DASHBOARD</button>
          <button type="button" className="ad-nav" onClick={() => navigate("/admin/bets")}>BETS</button>
          <button type="button" className="ad-nav dim" onClick={() => navigate("/")}>LOBBY</button>
        </div>
      </header>

      <div className="ad-note">
        GAME SETTINGS (RTP, BET WINDOW, ENABLE) ARE EDITED ON THE DASHBOARD — TAP ANY GAME ROW THERE.
        EVERY CHANGE MADE ANYWHERE LANDS HERE, PERMANENTLY.
      </div>

      <div className="ad-feed">
        {audit === null && <div className="ad-empty">LOADING…</div>}
        {audit !== null && audit.length === 0 && <div className="ad-empty">NO CHANGES RECORDED YET</div>}
        {audit !== null && audit.map((a, i) => {
          const lines = diff(a.before, a.after);
          return (
            <div key={i} className="ad-feedrow audit">
              <span className="ad-feed-when">{when(a.at)}</span>
              <span className="ad-feed-game">{ACTION[a.action] || a.action}</span>
              <span className="ad-feed-cell"><i>GAME</i>{a.gameType ? gameName(a.gameType) : "—"}</span>
              <span className="ad-feed-cell wide"><i>WHAT CHANGED</i>{lines.length ? lines.join(" · ") : "—"}</span>
              <span className="ad-feed-cell"><i>BY</i>{a.actor || "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
