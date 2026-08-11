// Operator-controlled game settings: RTP within the platform window.
// Rev-share is shown read-only — that's the contract, not a self-serve knob.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, apiPut } from "../../api";
import { LoadingScreen } from "../../components/mint/LoadingScreen";
import { OfficeShell, PageHead, Card, Btn, RtpSlider } from "../../components/office/kit";
import { gameName, sortGames } from "../../components/office/games";
import { rulesPricedLong } from "../../components/office/rtpCopy";
import { PARTNER_NAV, usePartnerGuard } from "./partnerShared";

function GameRtpCard({ game, onSaved }) {
  const [rtpPct, setRtpPct] = useState(game.rtp);
  const [msg, setMsg] = useState("");
  const dirty = Math.abs(rtpPct - game.rtp) > 0.001;

  async function save() {
    setMsg("");
    const houseEdge = Math.round((1 - rtpPct / 100) * 10000) / 10000;
    const { ok, data } = await apiPut("/api/partner/config", { gameType: game.gameType, houseEdge });
    setMsg(ok ? "Saved. Applies to new rounds immediately" : data.error || "Failed");
    if (ok) onSaved();
  }

  return (
    <Card style={{ flex: 1, minWidth: 340 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "var(--fs-md)" }}>{gameName(game.gameType)}</span>
        <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>Rev-share: <b>{game.revSharePct}%</b></span>
      </div>

      {game.rtpConfigurable ? (
        <>
          <p style={{ margin: "0 0 14px", fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.5 }}>
            Player RTP. Every payout multiplier reprices instantly. Allowed window is set by MTech.
          </p>
          <RtpSlider boundsPct={{ min: game.bounds.rtpMin, max: game.bounds.rtpMax }} valuePct={rtpPct} onChange={setRtpPct} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center", marginTop: 14 }}>
            {msg && <span style={{ fontSize: "var(--fs-caption)", fontWeight: 700, color: msg.startsWith("Saved") ? "var(--mint-bright)" : "var(--loss)" }}>{msg}</span>}
            <Btn small onClick={save} disabled={!dirty}>Save RTP</Btn>
          </div>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: "var(--fs-sm)", color: "var(--text-muted)", lineHeight: 1.55 }}>
          {rulesPricedLong(game.gameType)}
        </p>
      )}
    </Card>
  );
}

export default function PartnerSettings() {
  const { ready, email, operator } = usePartnerGuard();
  const [config, setConfig] = useState(null);
  const navigate = useNavigate();

  const load = () => apiGet("/api/partner/config").then(({ ok, data }) => ok && setConfig(data));
  useEffect(() => { if (ready) load(); }, [ready]);

  if (!ready || !config) return <LoadingScreen label="Loading settings" />;

  return (
    <OfficeShell brand={` ${operator}`} brandAccent="◆" nav={PARTNER_NAV} user={email}
      onLogout={() => apiPost("/api/partner/logout").then(() => navigate("/partner/login"))}>
      <PageHead title="Game settings" sub="Tune the player RTP for your casino; every change is audited" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 460px))", gap: 14 }}>
        {sortGames(config.games, (g) => g.gameType).map((g) => <GameRtpCard key={g.gameType} game={g} onSaved={load} />)}
      </div>
    </OfficeShell>
  );
}
