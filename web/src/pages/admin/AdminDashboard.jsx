// Provider backoffice — home. Platform totals, per-operator economics, and
// operator onboarding (credentials shown exactly once).
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../../api";
import { LoadingScreen } from "../../components/mint/LoadingScreen";
import {
  OfficeShell, PageHead, Card, StatCard, OfficeTable, Btn, TextInput, Modal,
  SecretRow, DateRangePicker, rangeQuery, fmtMoney, moneyTone,
} from "../../components/office/kit";
import { gameName } from "../../components/office/games";
import { ADMIN_NAV, useAdminGuard } from "./adminShared";

export default function AdminDashboard() {
  const { ready, email } = useAdminGuard();
  const [range, setRange] = useState("30");
  const [data, setData] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWalletUrl, setNewWalletUrl] = useState("");
  const [creds, setCreds] = useState(null);
  const [err, setErr] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!ready) return;
    apiGet(`/api/admin/operators${rangeQuery(range)}`).then(({ ok, data }) => ok && setData(data));
  }, [ready, range]);

  if (!ready || !data) return <LoadingScreen label="Opening backoffice" />;

  async function addOperator() {
    setErr("");
    const { ok, data: d } = await apiPost("/api/admin/operators", {
      name: newName,
      walletUrl: newWalletUrl || null,
      walletMode: newWalletUrl ? "remote" : "local",
    });
    if (!ok) return setErr(d.error || "Could not create operator");
    setShowAdd(false);
    setNewName(""); setNewWalletUrl("");
    setCreds(d);
    apiGet(`/api/admin/operators${rangeQuery(range)}`).then(({ ok, data }) => ok && setData(data));
  }

  return (
    <OfficeShell brand="Tech Admin" brandAccent="M" nav={ADMIN_NAV} user={email}
      onLogout={() => apiPost("/api/auth/logout").then(() => navigate("/login"))}>
      <PageHead title="Operators" sub="Platform economics per partner casino"
        right={<div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <DateRangePicker value={range} onChange={setRange} />
          <Btn onClick={() => setShowAdd(true)}>+ Add operator</Btn>
        </div>} />

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <StatCard label="Platform GGR" value={fmtMoney(data.totals.ggr)} tone={moneyTone(data.totals.ggr)} />
        <StatCard label="Our revenue" value={fmtMoney(data.totals.providerRevenue)} tone={moneyTone(data.totals.providerRevenue)} sub="rev-share + direct GGR" />
        <StatCard label="Settled rounds" value={data.totals.rounds.toLocaleString()} />
      </div>

      <Card>
        <OfficeTable
          columns={[
            { key: "operator", label: "Operator", render: (r) => (
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                {r.operator}
                {!r.active && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--loss)", border: "1px solid var(--loss)", borderRadius: 999, padding: "1px 7px" }}>INACTIVE</span>}
              </span>) },
            { key: "rounds", label: "Rounds", align: "right", render: (r) => r.rounds.toLocaleString() },
            { key: "totalBets", label: "Bets", align: "right", render: (r) => fmtMoney(r.totalBets) },
            { key: "ggr", label: "GGR", align: "right", render: (r) => <span style={{ color: moneyTone(r.ggr), fontWeight: 700 }}>{fmtMoney(r.ggr)}</span> },
            { key: "revShare", label: "Rev-share", align: "right", render: (r) => {
              if (!r.revShare) return <span style={{ color: "var(--text-muted)" }}>—</span>;
              const values = Object.values(r.revShare);
              const uniform = values.every((v) => v === values[0]);
              if (uniform) return `${values[0]}%`;
              const detail = Object.entries(r.revShare).map(([g, v]) => `${gameName(g)} ${v}%`).join(" · ");
              return <span title={detail} style={{ borderBottom: "1px dotted var(--text-muted)", cursor: "help" }}>varies</span>;
            } },
            { key: "providerRevenue", label: "Our revenue", align: "right", render: (r) => <span style={{ color: moneyTone(r.providerRevenue) }}>{fmtMoney(r.providerRevenue)}</span> },
            { key: "ngr", label: "Operator NGR", align: "right", render: (r) => fmtMoney(r.ngr) },
            { key: "_", label: "", align: "right", render: (r) => r.operatorId
              ? <Btn small tone="ghost" onClick={() => navigate(`/admin/operators/${r.operatorId}`)}>Manage</Btn>
              : <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-caption)" }}>our players</span> },
          ]}
          rows={data.operators.map((o) => ({ ...o, key: o.operatorId || "direct" }))}
        />
      </Card>

      {showAdd && (
        <Modal title="Add operator" onClose={() => setShowAdd(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <TextInput value={newName} onChange={setNewName} placeholder="Casino name (e.g. LuckyBets)" autoFocus />
            <TextInput value={newWalletUrl} onChange={setNewWalletUrl} placeholder="Wallet API base URL (e.g. https://api.luckybets.com/wallet)" />
            <p style={{ margin: 0, fontSize: "var(--fs-caption)", color: "var(--text-muted)", lineHeight: 1.5 }}>
              The endpoint on <b>their backend</b> where we call <code>/debit</code>, <code>/credit</code> and{" "}
              <code>/rollback</code> to move their players' money (seamless wallet, HMAC-signed).
              Leave empty for a play-money wallet hosted on our side (demo/test integrations only).
            </p>
            {err && <div style={{ color: "var(--loss)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>{err}</div>}
            <Btn onClick={addOperator} disabled={!newName.trim()}>Create operator</Btn>
          </div>
        </Modal>
      )}

      {creds && (
        <Modal title={`Credentials for ${creds.name}`} onClose={() => setCreds(null)} width={520}>
          <p style={{ margin: "0 0 14px", color: "var(--loss)", fontSize: "var(--fs-sm)", fontWeight: 700 }}>
            Shown once. Copy both now; we store only hashes.
          </p>
          <SecretRow label="API key (x-api-key)" value={creds.apiKey} />
          <SecretRow label="Shared secret (wallet HMAC)" value={creds.sharedSecret} />
          <Btn onClick={() => setCreds(null)}>Done, I saved them</Btn>
        </Modal>
      )}
    </OfficeShell>
  );
}
