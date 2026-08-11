// Global bets feed: every round on the platform, newest first. Filtering
// lives behind one minimal Filters button — a popover with toggle chips for
// games, operators and settlement, applied server-side (correct across
// pages). The button badge shows how many filters are active.
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../../api";
import { LoadingScreen } from "../../components/mint/LoadingScreen";
import { OfficeShell, PageHead, Card, StatCard, OfficeTable, Tabs, Btn, fmtMoney, moneyTone } from "../../components/office/kit";
import { gameName, GAME_ORDER } from "../../components/office/games";
import { ADMIN_NAV, useAdminGuard } from "./adminShared";

const PAGE = 50;
const STATUSES = [
  { key: "cashed_out", label: "Paid" },
  { key: "lost", label: "Lost" },
  { key: "active", label: "In play" },
];

const iso = (d) => d.toISOString().slice(0, 10);
const RANGE_PRESETS = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: null },
];

// From–to range control: quick presets + two date inputs for a custom window.
function RangePicker({ from, to, setFrom, setTo }) {
  const applyPreset = (p) => {
    setTo(iso(new Date()));
    setFrom(p.days == null ? "" : iso(new Date(Date.now() - p.days * 86400000)));
  };
  const inputStyle = {
    height: 34, padding: "0 10px", borderRadius: "var(--r-md)", border: "1px solid var(--border)",
    background: "var(--surface-raised)", color: "var(--text)", fontFamily: "var(--font-numeric)",
    fontSize: "var(--fs-caption)", colorScheme: "dark",
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {RANGE_PRESETS.map((p) => (
        <button key={p.key} onClick={() => applyPreset(p)}
          style={{ height: 34, padding: "0 12px", borderRadius: "var(--r-pill)", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--fs-caption)", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)" }}>
          {p.label}
        </button>
      ))}
      <span style={{ width: 1, height: 22, background: "var(--border)" }} />
      <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={inputStyle} aria-label="From date" />
      <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-caption)" }}>to</span>
      <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={inputStyle} aria-label="To date" />
    </div>
  );
}

function Chip({ on, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 12px", borderRadius: 999, cursor: "pointer",
      fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--fs-caption)",
      background: on ? "var(--mint)" : "var(--surface-raised)",
      color: on ? "var(--text-on-accent)" : "var(--text-muted)",
      border: on ? "1px solid var(--mint)" : "1px solid var(--border)",
      transition: "background var(--dur-fast), color var(--dur-fast)",
    }}>{children}</button>
  );
}

function FilterButton({ games, setGames, status, setStatus }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const active = games.size + (status ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  const toggleSet = (set, setter) => (key) => {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    setter(n);
  };
  const section = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", margin: "2px 0 7px" };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 14px",
        background: open ? "var(--surface-raised)" : "var(--surface)",
        border: `1px solid ${open || active ? "var(--mint-32)" : "var(--border)"}`,
        borderRadius: "var(--r-md)", color: "var(--text)", cursor: "pointer",
        fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--fs-sm)",
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
        Filters
        {active > 0 && (
          <span style={{ minWidth: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 999, background: "var(--mint)", color: "var(--text-on-accent)", fontSize: 11, fontWeight: 800, padding: "0 5px" }}>{active}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 40, width: 420, maxWidth: "calc(100vw - 32px)",
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)",
          boxShadow: "0 18px 44px rgba(0,0,0,0.5)", padding: 14,
          animation: "mb-rise var(--dur-fast) var(--ease-out)",
        }}>
          <div style={section}>Games</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {GAME_ORDER.map((g) => (
              <Chip key={g} on={games.has(g)} onClick={() => toggleSet(games, setGames)(g)}>{gameName(g)}</Chip>
            ))}
          </div>

          <div style={section}>Settlement</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {STATUSES.map((s) => (
              <Chip key={s.key} on={status === s.key} onClick={() => setStatus(status === s.key ? "" : s.key)}>{s.label}</Chip>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>Empty = everything</span>
            <Btn small tone="ghost" onClick={() => { setGames(new Set()); setStatus(""); }} disabled={active === 0}>Clear all</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Totals tab: platform money summary over a from–to window ──
function TotalsTab() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [totals, setTotals] = useState(null);

  useEffect(() => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    apiGet(`/api/admin/summary?${q}`).then(({ ok, data }) => ok && setTotals(data));
  }, [from, to]);

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <RangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      {!totals ? (
        <Card><div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Loading totals…</div></Card>
      ) : (
        <>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
            <StatCard label="Total wagered" value={fmtMoney(totals.wagered)} sub={`${totals.rounds.toLocaleString()} settled rounds`} />
            <StatCard label="Total won" value={fmtMoney(totals.won)} tone="var(--mint-bright)" sub="paid to players" />
            <StatCard label="Total lost" value={fmtMoney(totals.lost)} tone="var(--loss)" sub={`${totals.lostRounds.toLocaleString()} losing rounds`} />
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <StatCard label="Total GGR" value={fmtMoney(totals.ggr)} tone={moneyTone(totals.ggr)} sub="wagered − won" />
            <StatCard label="Our revenue" value={fmtMoney(totals.revenue)} tone={moneyTone(totals.revenue)} sub="rev-share + direct GGR" />
          </div>
        </>
      )}
    </>
  );
}

// ── Bets tab: the filterable global rounds feed ──
function BetsTab() {
  const [games, setGames] = useState(() => new Set());
  const [status, setStatus] = useState("");
  const [skip, setSkip] = useState(0);
  const [data, setData] = useState(null);

  useEffect(() => { setSkip(0); }, [games, status]);

  useEffect(() => {
    const q = new URLSearchParams({ limit: PAGE, skip });
    if (games.size) q.set("games", [...games].join(","));
    if (status) q.set("status", status);
    apiGet(`/api/admin/rounds?${q}`).then(({ ok, data }) => ok && setData(data));
  }, [games, status, skip]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <FilterButton games={games} setGames={setGames} status={status} setStatus={setStatus} />
      </div>
      <Card>
        <OfficeTable
          columns={[
            { key: "createdAt", label: "When", render: (r) => new Date(r.createdAt).toLocaleString() },
            { key: "player", label: "Player" },
            { key: "gameType", label: "Game", render: (r) => <span style={{ fontWeight: 700 }}>{gameName(r.gameType)}</span> },
            { key: "staked", label: "Staked", align: "right", render: (r) => fmtMoney(r.staked) },
            { key: "payout", label: "Payout", align: "right", render: (r) => fmtMoney(r.payout) },
            { key: "net", label: "House", align: "right", render: (r) => {
              const net = r.status === "active" ? null : r.staked - r.payout;
              return net == null ? <span style={{ color: "var(--text-muted)" }}>—</span>
                : <span style={{ color: moneyTone(net), fontWeight: 700 }}>{fmtMoney(net)}</span>;
            } },
            { key: "status", label: "Status", render: (r) => (
              <span style={{
                fontWeight: 700, fontSize: "var(--fs-caption)",
                color: r.status === "cashed_out" ? "var(--mint-bright)" : r.status === "lost" ? "var(--loss)" : "var(--gold)",
              }}>
                {r.status === "cashed_out" ? "PAID" : r.status === "lost" ? "LOST" : "IN PLAY"}
              </span>
            ) },
          ]}
          rows={(data?.rounds || []).map((r) => ({ ...r, key: r.roundId }))}
          empty="No rounds match these filters"
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <Btn small tone="ghost" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))}>← Newer</Btn>
          <Btn small tone="ghost" disabled={!data || data.rounds.length < PAGE} onClick={() => setSkip(skip + PAGE)}>Older →</Btn>
        </div>
      </Card>
    </>
  );
}

export default function AdminBets() {
  const { ready, email } = useAdminGuard();
  const [tab, setTab] = useState("bets");
  const navigate = useNavigate();

  if (!ready) return <LoadingScreen label="Loading bets" />;

  return (
    <OfficeShell brand="MTech Admin" brandAccent="▮" nav={ADMIN_NAV} user={email}
      onLogout={() => apiPost("/api/auth/logout").then(() => navigate("/login"))}>
      <PageHead title="Bets" sub="Every round on the platform, and the money behind it" />
      <Tabs items={[{ key: "bets", label: "Bets" }, { key: "totals", label: "Totals" }]} value={tab} onChange={setTab} />
      {tab === "bets" ? <BetsTab /> : <TotalsTab />}
    </OfficeShell>
  );
}
