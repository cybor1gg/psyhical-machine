// The bets feed, in the backoffice's touch language: every round on the
// machine, newest first, as finger-sized rows. Filters are tap chips applied
// SERVER-side (correct across pages), the pager is two big buttons. The
// statistics themselves live on the dashboard — this page is the ledger.
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../../api";
import { LoadingScreen } from "../../components/mint/LoadingScreen";
import { gameName, GAME_ORDER } from "../../components/office/games";
import { useAdminGuard } from "./adminShared";
import { fmtMKD } from "../../space/format";
import "./dash.css";

const PAGE = 50;
const STATUSES = [
  { key: "", label: "ALL" },
  { key: "cashed_out", label: "PAID" },
  { key: "lost", label: "LOST" },
  { key: "active", label: "IN PLAY" },
];

const when = (d) => {
  const x = new Date(d);
  return x.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) + " " +
    x.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
};

export default function AdminBets() {
  const { ready, email, role } = useAdminGuard();
  const navigate = useNavigate();
  useEffect(() => { if (ready && role === "operator") navigate("/operator"); }, [ready, role]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, setRows] = useState(null);
  const [skip, setSkip] = useState(0);
  const [games, setGames] = useState([]);        // empty = all
  const [status, setStatus] = useState("");

  const load = useCallback(() => {
    const q = new URLSearchParams({ skip: String(skip), limit: String(PAGE) });
    if (games.length) q.set("games", games.join(","));
    if (status) q.set("status", status);
    apiGet("/api/admin/rounds?" + q).then(({ ok, data }) => { if (ok) setRows(data.rounds); });
  }, [skip, games, status]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  if (!ready) return <LoadingScreen />;

  const toggleGame = (g) => {
    setSkip(0);
    setGames((cur) => cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]);
  };

  return (
    <div className="ad-root">
      <header className="ad-top">
        <div className="ad-title"><b>BETS</b><span>{email}</span></div>
        <div className="ad-top-btns">
          <button type="button" className="ad-nav" onClick={() => navigate("/admin")}>DASHBOARD</button>
          <button type="button" className="ad-nav" onClick={() => navigate("/admin/settings")}>AUDIT</button>
          <button type="button" className="ad-nav dim" onClick={() => navigate("/")}>LOBBY</button>
        </div>
      </header>

      <div className="ad-chiprow">
        <button type="button" className={"ad-chip" + (games.length === 0 ? " on" : "")}
          onClick={() => { setGames([]); setSkip(0); }}>ALL GAMES</button>
        {GAME_ORDER.map((g) => (
          <button type="button" key={g} className={"ad-chip" + (games.includes(g) ? " on" : "")}
            onClick={() => toggleGame(g)}>{gameName(g).toUpperCase()}</button>
        ))}
      </div>
      <div className="ad-chiprow">
        {STATUSES.map((s) => (
          <button type="button" key={s.key} className={"ad-chip" + (status === s.key ? " on" : "")}
            onClick={() => { setStatus(s.key); setSkip(0); }}>{s.label}</button>
        ))}
      </div>

      <div className="ad-feed">
        {rows === null && <div className="ad-empty">LOADING…</div>}
        {rows !== null && rows.length === 0 && <div className="ad-empty">NOTHING HERE</div>}
        {rows !== null && rows.map((r) => (
          <div key={r.roundId} className="ad-feedrow">
            <span className="ad-feed-when">{when(r.createdAt)}</span>
            <span className="ad-feed-game">{gameName(r.gameType)}</span>
            <span className="ad-feed-cell"><i>BET</i>{fmtMKD(r.staked)}</span>
            <span className={"ad-feed-cell" + (r.payout > 0 ? " good" : "")}><i>PAID</i>{fmtMKD(r.payout)}</span>
            <span className={"ad-status " + r.status}>
              {r.status === "cashed_out" ? "PAID" : r.status === "lost" ? "LOST" : "IN PLAY"}
            </span>
          </div>
        ))}
      </div>

      <div className="ad-pager">
        <button type="button" className="ad-ghost" disabled={skip === 0}
          onClick={() => setSkip((s) => Math.max(0, s - PAGE))}>◀ NEWER</button>
        <span>PAGE {Math.floor(skip / PAGE) + 1}</span>
        <button type="button" className="ad-ghost" disabled={rows !== null && rows.length < PAGE}
          onClick={() => setSkip((s) => s + PAGE)}>OLDER ▶</button>
      </div>
    </div>
  );
}
