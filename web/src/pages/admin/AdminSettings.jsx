// Platform settings: per-game defaults, the RTP window operators may use,
// and the audit trail of every money-adjacent change.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, apiPut } from "../../api";
import { LoadingScreen } from "../../components/mint/LoadingScreen";
import { OfficeShell, PageHead, Card, OfficeTable, Btn, TextInput, Tabs } from "../../components/office/kit";
import { gameName, GAME_ORDER } from "../../components/office/games";
import { rulesPricedLong } from "../../components/office/rtpCopy";
import { ADMIN_NAV, useAdminGuard } from "./adminShared";

// Hoisted: defining this inside the card would mint a new component type per
// render, remounting the input and dropping focus on every keystroke.
function FieldRow({ label, value, onChange, hint }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span style={{ flex: "0 0 190px", fontSize: "var(--fs-sm)", color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
      <div style={{ width: 120 }}><TextInput value={value} onChange={onChange} type="number" /></div>
      {hint && <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>{hint}</span>}
    </div>
  );
}

const formFromCfg = (cfg) => ({
  houseEdge: String(cfg.houseEdge),
  houseEdgeMin: String(cfg.houseEdgeMin ?? 0.005),
  houseEdgeMax: String(cfg.houseEdgeMax ?? 0.1),
  minBet: String(cfg.minBet),
  maxBet: String(cfg.maxBet),
});

function GameSettingsCard({ cfg, onSaved }) {
  const [form, setForm] = useState(() => formFromCfg(cfg));
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [msg, setMsg] = useState("");
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  // Re-sync when the parent reloads configs (after save) so the form always
  // shows what the server actually stored.
  useEffect(() => { setForm(formFromCfg(cfg)); setEnabled(cfg.enabled); }, [cfg]);

  // The server decides which games have an RTP dial (RTP_CONFIGURABLE in
  // api/lib/config.js) — never a hardcoded list here.
  const rtpConfigurable = !!cfg.rtpConfigurable;

  async function save() {
    setMsg("");
    const nums = {
      minBet: parseFloat(form.minBet),
      maxBet: parseFloat(form.maxBet),
      ...(rtpConfigurable
        ? {
            houseEdge: parseFloat(form.houseEdge),
            houseEdgeMin: parseFloat(form.houseEdgeMin),
            houseEdgeMax: parseFloat(form.houseEdgeMax),
          }
        : {}),
    };
    // An empty field would reach the server as null (NaN has no JSON form)
    // and either 400 or, worse, be taken literally — refuse it here.
    if (Object.values(nums).some((v) => !Number.isFinite(v))) {
      setMsg("Every field needs a number");
      return;
    }
    const { ok, data } = await apiPut("/api/admin/config", {
      gameType: cfg.gameType,
      enabled,
      // RTP fields only exist on formula-priced games; the server ignores
      // them for rules-priced games regardless.
      ...nums,
    });
    setMsg(ok ? "Saved" : data.error || "Failed");
    if (ok) onSaved();
  }

  return (
    <Card style={{ maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "var(--fs-md)" }}>{gameName(cfg.gameType)}</span>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-sm)", fontWeight: 600, cursor: "pointer", color: enabled ? "var(--mint-bright)" : "var(--loss)" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ accentColor: "var(--mint)" }} />
          {enabled ? "Enabled" : "Disabled"}
        </label>
      </div>
      {rtpConfigurable ? (
        <>
          <FieldRow label="Default house edge" value={form.houseEdge} onChange={set("houseEdge")} hint={`= ${(100 - parseFloat(form.houseEdge || 0) * 100).toFixed(1)}% RTP (direct players + operators without override)`} />
          <FieldRow label="Window: min edge" value={form.houseEdgeMin} onChange={set("houseEdgeMin")} hint={`operators' best allowed RTP ${(100 - parseFloat(form.houseEdgeMin || 0) * 100).toFixed(1)}%`} />
          <FieldRow label="Window: max edge" value={form.houseEdgeMax} onChange={set("houseEdgeMax")} hint={`operators' worst allowed RTP ${(100 - parseFloat(form.houseEdgeMax || 0) * 100).toFixed(1)}%`} />
        </>
      ) : (
        <p style={{ margin: "0 0 12px", fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.55 }}>
          {rulesPricedLong(cfg.gameType)}
        </p>
      )}
      <FieldRow label="Min bet" value={form.minBet} onChange={set("minBet")} />
      <FieldRow label="Max bet" value={form.maxBet} onChange={set("maxBet")} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center", marginTop: 6 }}>
        {msg && <span style={{ fontSize: "var(--fs-caption)", fontWeight: 700, color: msg === "Saved" ? "var(--mint-bright)" : "var(--loss)" }}>{msg}</span>}
        <Btn small onClick={save}>Save</Btn>
      </div>
    </Card>
  );
}

export default function AdminSettings() {
  const { ready, email } = useAdminGuard();
  const [configs, setConfigs] = useState(null);
  const [audit, setAudit] = useState([]);
  const [tab, setTab] = useState(GAME_ORDER[0]);
  const navigate = useNavigate();

  const load = () => {
    apiGet("/api/admin/config").then(({ ok, data }) => ok && setConfigs(data));
    apiGet("/api/admin/audit?limit=30").then(({ ok, data }) => ok && setAudit(data));
  };
  useEffect(() => { if (ready) load(); }, [ready]);

  if (!ready || !configs) return <LoadingScreen label="Loading settings" />;

  const ordered = [...configs].sort((a, b) => GAME_ORDER.indexOf(a.gameType) - GAME_ORDER.indexOf(b.gameType));
  const current = ordered.find((c) => c.gameType === tab) || ordered[0];

  return (
    <OfficeShell brand="Tech Admin" brandAccent="M" nav={ADMIN_NAV} user={email}
      onLogout={() => apiPost("/api/auth/logout").then(() => navigate("/login"))}>
      <PageHead title="Platform settings" sub="Defaults for every operator, and the RTP window they may configure within" />

      <Tabs
        items={ordered.map((c) => ({ key: c.gameType, label: gameName(c.gameType), badge: c.enabled ? null : "off" }))}
        value={current.gameType} onChange={setTab} />
      <div style={{ marginBottom: 18 }}>
        {/* key: switching games remounts the form so edits never bleed across tabs */}
        <GameSettingsCard key={current.gameType} cfg={current} onSaved={load} />
      </div>

      <Card>
        <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
          Audit trail
        </div>
        <OfficeTable
          columns={[
            { key: "at", label: "When", render: (r) => new Date(r.at).toLocaleString() },
            { key: "actor", label: "Who", render: (r) => <span>{r.actor} <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-caption)" }}>({r.actorType})</span></span> },
            { key: "operator", label: "Operator", render: (r) => r.operator || "—" },
            { key: "action", label: "Action" },
            { key: "gameType", label: "Game", render: (r) => (r.gameType ? gameName(r.gameType) : "—") },
            { key: "change", label: "Change", render: (r) => (
              <code style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {JSON.stringify(r.before)} → {JSON.stringify(r.after)}
              </code>) },
          ]}
          rows={audit.map((a, i) => ({ ...a, key: i }))}
          empty="No changes recorded yet"
        />
      </Card>
    </OfficeShell>
  );
}
