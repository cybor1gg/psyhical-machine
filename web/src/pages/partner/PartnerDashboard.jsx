// Operator's view of their own casino: GGR, our fee, their NGR, daily chart,
// per-game split and recent rounds. Everything scoped by the op_token.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../../api";
import { LoadingScreen } from "../../components/mint/LoadingScreen";
import {
  OfficeShell, PageHead, Card, StatCard, OfficeTable, BarChart,
  DateRangePicker, rangeQuery, fmtMoney, moneyTone,
} from "../../components/office/kit";
import { gameName } from "../../components/office/games";
import { PARTNER_NAV, usePartnerGuard } from "./partnerShared";

export default function PartnerDashboard() {
  const { ready, email, operator } = usePartnerGuard();
  const [range, setRange] = useState("30");
  const [report, setReport] = useState(null);
  const [rounds, setRounds] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!ready) return;
    apiGet(`/api/partner/report${rangeQuery(range)}`).then(({ ok, data }) => ok && setReport(data));
    apiGet(`/api/partner/rounds${rangeQuery(range) || "?"}&limit=12`).then(({ ok, data }) => ok && setRounds(data));
  }, [ready, range]);

  if (!ready || !report) return <LoadingScreen label="Loading dashboard" />;

  return (
    <OfficeShell brand={` ${operator}`} brandAccent="◆" nav={PARTNER_NAV} user={email}
      onLogout={() => apiPost("/api/partner/logout").then(() => navigate("/partner/login"))}>
      <PageHead title="Dashboard" sub="Your players' activity on MTech Originals games"
        right={<DateRangePicker value={range} onChange={setRange} />} />

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <StatCard label="GGR" value={fmtMoney(report.totals.ggr)} tone={moneyTone(report.totals.ggr)} sub="bets − payouts" />
        <StatCard label="Provider fee" value={fmtMoney(report.totals.providerFee)} sub="MTech rev-share" />
        <StatCard label="Your NGR" value={fmtMoney(report.totals.ngr)} tone={moneyTone(report.totals.ngr)} sub="GGR − fee" />
        <StatCard label="Rounds" value={report.totals.rounds.toLocaleString()} />
      </div>

      <Card style={{ marginBottom: 18 }}>
        <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>Daily GGR</div>
        <BarChart data={report.daily} />
      </Card>

      <Card style={{ marginBottom: 18 }}>
        <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>By game</div>
        <OfficeTable
          columns={[
            { key: "gameType", label: "Game", render: (r) => <span style={{ fontWeight: 700 }}>{gameName(r.gameType)}</span> },
            { key: "rounds", label: "Rounds", align: "right" },
            { key: "totalBets", label: "Bets", align: "right", render: (r) => fmtMoney(r.totalBets) },
            { key: "ggr", label: "GGR", align: "right", render: (r) => <span style={{ color: moneyTone(r.ggr), fontWeight: 700 }}>{fmtMoney(r.ggr)}</span> },
            { key: "revSharePct", label: "Rev-share", align: "right", render: (r) => r.revSharePct + "%" },
            { key: "ngr", label: "Your NGR", align: "right", render: (r) => fmtMoney(r.ngr) },
          ]}
          rows={report.games.map((g) => ({ ...g, key: g.gameType }))}
          empty="No settled rounds in this range"
        />
      </Card>

      <Card>
        <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>Recent rounds</div>
        <OfficeTable
          columns={[
            { key: "createdAt", label: "When", render: (r) => new Date(r.createdAt).toLocaleString() },
            { key: "playerId", label: "Player" },
            { key: "gameType", label: "Game", render: (r) => gameName(r.gameType) },
            { key: "betAmount", label: "Bet", align: "right", render: (r) => fmtMoney(r.betAmount) },
            { key: "payout", label: "Payout", align: "right", render: (r) => fmtMoney(r.payout) },
            { key: "status", label: "Result", render: (r) => (
              <span style={{ color: r.status === "cashed_out" ? "var(--mint-bright)" : "var(--loss)", fontWeight: 700, fontSize: "var(--fs-caption)" }}>
                {r.status === "cashed_out" ? "PAID" : "LOST"}
              </span>) },
          ]}
          rows={(rounds?.rounds || []).map((r) => ({ ...r, key: r.roundId }))}
          empty="No rounds yet"
        />
      </Card>
    </OfficeShell>
  );
}
