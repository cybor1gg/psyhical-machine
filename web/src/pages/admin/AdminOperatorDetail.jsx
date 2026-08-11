// One operator: economics, per-game RTP + rev-share editors, portal logins.
import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet, apiPost, apiPut } from "../../api";
import { LoadingScreen } from "../../components/mint/LoadingScreen";
import {
  OfficeShell, PageHead, Card, StatCard, OfficeTable, BarChart, Btn, TextInput,
  Modal, SecretRow, RtpSlider, DateRangePicker, rangeQuery, fmtMoney, moneyTone, Tabs,
} from "../../components/office/kit";
import { gameName, sortGames } from "../../components/office/games";
import { rulesPricedShort } from "../../components/office/rtpCopy";
import { ADMIN_NAV, useAdminGuard } from "./adminShared";

// Integration endpoint editor — the wallet URL our servers call for
// debit/credit. Repointable without recreating the operator (domain moves,
// staging → production cutovers).
function WalletUrlCard({ opId, operator, onSaved }) {
  const [url, setUrl] = useState(operator.walletUrl || "");
  const [msg, setMsg] = useState("");
  const dirty = url.trim() !== (operator.walletUrl || "");

  async function save() {
    setMsg("");
    const { ok, data } = await apiPut(`/api/admin/operators/${opId}/wallet`, { walletUrl: url });
    setMsg(ok ? "Saved. Applies to the next wallet call" : data.error || "Failed");
    if (ok) onSaved();
  }

  return (
    <Card style={{ marginBottom: 18 }}>
      <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
        Wallet API endpoint
      </div>
      <p style={{ margin: "0 0 10px", fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.5 }}>
        The base URL our servers call for <code style={{ color: "var(--text)" }}>/debit</code>, <code style={{ color: "var(--text)" }}>/credit</code> and <code style={{ color: "var(--text)" }}>/rollback</code>.
        Signed with this operator's shared secret. Every change is audited.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <TextInput value={url} onChange={setUrl} placeholder="https://casino.example.com/wallet" />
        </div>
        {msg && <span style={{ fontSize: "var(--fs-caption)", fontWeight: 700, color: msg.startsWith("Saved") ? "var(--mint-bright)" : "var(--loss)" }}>{msg}</span>}
        <Btn small onClick={save} disabled={!dirty}>Save endpoint</Btn>
      </div>
    </Card>
  );
}

function GameConfigCard({ opId, game, onSaved }) {
  const pctFromEdge = (e) => Math.round((1 - e) * 1000) / 10;
  const [rtpPct, setRtpPct] = useState(pctFromEdge(game.houseEdgeEffective));
  const [share, setShare] = useState(String(game.revSharePct));
  const [msg, setMsg] = useState("");

  // Round the window INWARD (min up, max down) so the slider can never offer
  // an endpoint the API would reject as outside the platform window.
  const boundsPct = {
    min: Math.ceil((1 - game.bounds.max) * 1000) / 10,
    max: Math.floor((1 - game.bounds.min) * 1000) / 10,
  };
  const dirtyRtp = game.rtpConfigurable && Math.abs(rtpPct - pctFromEdge(game.houseEdgeEffective)) > 0.001;
  const dirtyShare = parseFloat(share) !== game.revSharePct;

  async function save() {
    setMsg("");
    const body = { gameType: game.gameType };
    if (dirtyRtp) body.houseEdge = Math.round((1 - rtpPct / 100) * 10000) / 10000;
    if (dirtyShare) {
      const s = parseFloat(share);
      // A blank field parses to NaN → JSON null → the override would be
      // silently cleared back to the platform default. Refuse it instead.
      if (!Number.isFinite(s)) { setMsg("Rev-share must be a number"); return; }
      body.revSharePct = s;
    }
    const { ok, data } = await apiPut(`/api/admin/operators/${opId}/config`, body);
    setMsg(ok ? "Saved" : data.error || "Failed");
    if (ok) onSaved();
  }

  return (
    <Card style={{ maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "var(--fs-md)" }}>{gameName(game.gameType)}</span>
        {game.houseEdgeOverride == null && game.rtpConfigurable && (
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 8px" }}>PLATFORM DEFAULT</span>
        )}
      </div>

      <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>RTP</div>
      {game.rtpConfigurable ? (
        <RtpSlider boundsPct={boundsPct} valuePct={rtpPct} onChange={setRtpPct} />
      ) : (
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", padding: "6px 0" }}>
          {rulesPricedShort(game.gameType)}
        </div>
      )}

      <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, color: "var(--text-muted)", margin: "16px 0 6px" }}>Rev-share (our % of GGR)</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ width: 110 }}>
          <TextInput value={share} onChange={setShare} type="number" />
        </div>
        <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>%</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {msg && <span style={{ fontSize: "var(--fs-caption)", color: msg === "Saved" ? "var(--mint-bright)" : "var(--loss)", fontWeight: 700 }}>{msg}</span>}
          <Btn small onClick={save} disabled={!dirtyRtp && !dirtyShare}>Save</Btn>
        </div>
      </div>
    </Card>
  );
}

export default function AdminOperatorDetail() {
  const { ready, email } = useAdminGuard();
  const { id } = useParams();
  const [range, setRange] = useState("30");
  const [detail, setDetail] = useState(null);
  const [report, setReport] = useState(null);
  const [newEmail, setNewEmail] = useState("");
  const [portalCred, setPortalCred] = useState(null);
  const [portalErr, setPortalErr] = useState("");
  const [gameTab, setGameTab] = useState(null);
  const navigate = useNavigate();

  const loadDetail = () => apiGet(`/api/admin/operators/${id}`).then(({ ok, data }) => ok && setDetail(data));
  useEffect(() => { if (ready) loadDetail(); }, [ready, id]);
  useEffect(() => {
    if (!ready) return;
    apiGet(`/api/admin/operators/${id}/report${rangeQuery(range)}`).then(({ ok, data }) => ok && setReport(data));
  }, [ready, id, range]);

  if (!ready || !detail || !report) return <LoadingScreen label="Loading operator" />;

  async function addPortalUser() {
    setPortalErr("");
    const { ok, data } = await apiPost(`/api/admin/operators/${id}/portal-user`, { email: newEmail });
    if (!ok) return setPortalErr(data.error || "Failed");
    setNewEmail("");
    setPortalCred(data);
    loadDetail();
  }

  return (
    <OfficeShell brand="Tech Admin" brandAccent="M" nav={ADMIN_NAV} user={email}
      onLogout={() => apiPost("/api/auth/logout").then(() => navigate("/login"))}>
      <PageHead
        title={detail.operator.name}
        sub={`Wallet: ${detail.operator.walletMode} · since ${new Date(detail.operator.createdAt).toLocaleDateString()}`}
        right={<DateRangePicker value={range} onChange={setRange} />}
      />

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <StatCard label="GGR" value={fmtMoney(report.totals.ggr)} tone={moneyTone(report.totals.ggr)} />
        <StatCard label="Our fee" value={fmtMoney(report.totals.providerFee)} tone={moneyTone(report.totals.providerFee)} />
        <StatCard label="Their NGR" value={fmtMoney(report.totals.ngr)} />
        <StatCard label="Rounds" value={report.totals.rounds.toLocaleString()} />
      </div>

      <Card style={{ marginBottom: 18 }}>
        <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>Daily GGR</div>
        <BarChart data={report.daily} />
      </Card>

      <WalletUrlCard opId={id} operator={detail.operator} onSaved={loadDetail} />

      <Card style={{ marginBottom: 18 }}>
        <OfficeTable
          columns={[
            { key: "gameType", label: "Game", render: (r) => <span style={{ fontWeight: 700 }}>{gameName(r.gameType)}</span> },
            { key: "rounds", label: "Rounds", align: "right" },
            { key: "totalBets", label: "Bets", align: "right", render: (r) => fmtMoney(r.totalBets) },
            { key: "totalPayouts", label: "Payouts", align: "right", render: (r) => fmtMoney(r.totalPayouts) },
            { key: "ggr", label: "GGR", align: "right", render: (r) => <span style={{ color: moneyTone(r.ggr), fontWeight: 700 }}>{fmtMoney(r.ggr)}</span> },
            { key: "revSharePct", label: "Share", align: "right", render: (r) => r.revSharePct + "%" },
            { key: "providerFee", label: "Our fee", align: "right", render: (r) => fmtMoney(r.providerFee) },
            { key: "ngr", label: "Their NGR", align: "right", render: (r) => fmtMoney(r.ngr) },
          ]}
          rows={report.games.map((g) => ({ ...g, key: g.gameType }))}
          empty="No settled rounds in this range"
        />
      </Card>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
          Game configuration
        </div>
        {(() => {
          const games = sortGames(detail.games, (g) => g.gameType);
          const current = games.find((g) => g.gameType === gameTab) || games[0];
          return (
            <>
              <Tabs
                items={games.map((g) => ({
                  key: g.gameType, label: gameName(g.gameType),
                  badge: g.rtpConfigurable && g.houseEdgeOverride != null ? "custom" : null,
                }))}
                value={current.gameType} onChange={setGameTab} />
              <GameConfigCard key={current.gameType} opId={id} game={current} onSaved={loadDetail} />
            </>
          );
        })()}
      </div>

      <Card>
        <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
          Backoffice logins
        </div>
        {detail.portalUsers.length > 0 && (
          <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {detail.portalUsers.map((u) => (
              <div key={u.email} style={{ fontSize: "var(--fs-sm)", fontVariantNumeric: "tabular-nums" }}>
                {u.email} <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-caption)" }}>· added {new Date(u.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, maxWidth: 460 }}>
          <TextInput value={newEmail} onChange={setNewEmail} placeholder="operator-user@their-casino.com" />
          <Btn onClick={addPortalUser} disabled={!newEmail.includes("@")}>Invite</Btn>
        </div>
        {portalErr && <div style={{ marginTop: 8, color: "var(--loss)", fontSize: "var(--fs-sm)", fontWeight: 600 }}>{portalErr}</div>}
      </Card>

      {portalCred && (
        <Modal title="Portal login created" onClose={() => setPortalCred(null)} width={500}>
          <p style={{ margin: "0 0 14px", color: "var(--loss)", fontSize: "var(--fs-sm)", fontWeight: 700 }}>
            Shown once. Send these to the operator through a secure channel.
          </p>
          <SecretRow label="Login email" value={portalCred.email} />
          <SecretRow label="Temporary password" value={portalCred.tempPassword} />
          <SecretRow label="Portal URL" value={`${location.origin}/partner/login`} />
          <Btn onClick={() => setPortalCred(null)}>Done</Btn>
        </Modal>
      )}
    </OfficeShell>
  );
}
