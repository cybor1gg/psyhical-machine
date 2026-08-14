// Backoffice UI kit — shared by the provider (/admin) and partner (/partner)
// portals. MintBets tokens throughout; everything server-driven.
import React from "react";
import { NavLink } from "react-router-dom";

// The cabinet takes denars, so the backoffice reports denars. Macedonian
// convention, same as the machine's own readout: dot thousands separator,
// comma decimal. Kept to two decimals here (unlike the cabinet, which drops
// a trailing ,00) so figures line up down a right-aligned ledger column.
export const fmtMoney = (v) => {
  const n = Number(v) || 0;
  const [whole, cents] = Math.abs(n).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (n < 0 ? "−" : "") + grouped + "," + cents + " МКД";
};
export const moneyTone = (v) => (v > 0 ? "var(--mint-bright)" : v < 0 ? "var(--loss)" : "var(--text)");

// ── shell: sidebar + topbar + content ───────────────────────────────────────
export function OfficeShell({ brand, brandAccent, nav, user, onLogout, children }) {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", background: "var(--ink)", color: "var(--text)", fontFamily: "var(--font-body)" }}>
      <aside style={{ flex: "0 0 216px", background: "var(--surface)", borderRight: "1px solid var(--border)", padding: "18px 12px", display: "flex", flexDirection: "column", gap: 4, position: "sticky", top: 0, height: "100dvh", boxSizing: "border-box" }}>
        <div style={{ padding: "2px 10px 16px", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 17 }}>
          <span style={{ color: "var(--mint-bright)" }}>{brandAccent}</span>{brand}
        </div>
        {nav.map((item) => (
          <NavLink key={item.path} to={item.path} end={item.end}
            style={({ isActive }) => ({
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              borderRadius: "var(--r-md)", textDecoration: "none",
              fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--fs-sm)",
              color: isActive ? "var(--mint-bright)" : "var(--text-muted)",
              background: isActive ? "var(--mint-12)" : "transparent",
            })}>
            {item.icon}{item.label}
          </NavLink>
        ))}
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "0 4px" }}>
          {user && <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", padding: "0 8px", overflow: "hidden", textOverflow: "ellipsis" }}>{user}</span>}
          {onLogout && (
            <button onClick={onLogout} style={{ height: 38, borderRadius: "var(--r-md)", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--fs-sm)" }}>
              Log out
            </button>
          )}
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, padding: "26px 30px 60px", boxSizing: "border-box" }}>
        {children}
      </main>
    </div>
  );
}

export function PageHead({ title, sub, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
      <div>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "var(--fs-xl)", letterSpacing: "var(--ls-tight)" }}>{title}</h1>
        {sub && <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({ children, style = {} }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", padding: 18, boxSizing: "border-box", ...style }}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, tone = "var(--text)" }) {
  return (
    <Card style={{ flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 24, color: tone }}>{value}</div>
      {sub && <div style={{ marginTop: 4, fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>{sub}</div>}
    </Card>
  );
}

// ── table ───────────────────────────────────────────────────────────────────
export function OfficeTable({ columns, rows, empty = "Nothing here yet" }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-sm)" }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align || "left", padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--fs-caption)", letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: "22px 12px", color: "var(--text-muted)", textAlign: "center" }}>{empty}</td></tr>
          )}
          {rows.map((row, i) => (
            <tr key={row.key ?? i} style={{ borderBottom: "1px solid color-mix(in srgb, var(--border) 45%, transparent)" }}>
              {columns.map((c) => (
                <td key={c.key} style={{ padding: "11px 12px", textAlign: c.align || "left", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── daily GGR bar chart ─────────────────────────────────────────────────────
// HTML/CSS (not scaled SVG — scaled SVG distorts text). Interactive: hovering
// a day highlights its column and shows a tooltip; y-axis uses "nice" ticks.
// axis ticks — short form, no currency suffix (the axis is denars throughout
// and "1.2k МКД" on every tick is just noise)
const compact = (v) => {
  if (v === 0) return "0";
  const a = Math.abs(v);
  const s = a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + "k" : a.toFixed(a >= 1 ? 0 : 2);
  return (v < 0 ? "−" : "") + s;
};

export function BarChart({ data, height = 170 }) {
  const [hover, setHover] = React.useState(null);
  if (!data || data.length === 0) {
    return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>No activity in this range</div>;
  }

  const top = Math.max(0, ...data.map((d) => d.ggr));
  const bot = Math.min(0, ...data.map((d) => d.ggr));
  const span = top - bot || 1;
  // nice tick step: 1/2/2.5/5 × 10^k, aiming for ~4 gridlines
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => raw <= m * pow) || 10) * pow;
  const ticks = [];
  for (let v = Math.ceil(bot / step) * step; v <= top + step * 0.01; v += step) ticks.push(Math.round(v * 100) / 100);
  const y = (v) => height - ((v - bot) / span) * height; // px from chart top

  const n = data.length;
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const hovered = hover != null ? data[hover] : null;

  return (
    <div style={{ overflowX: n > 48 ? "auto" : "visible" }}>
      <div style={{ display: "flex", gap: 10, minWidth: n > 48 ? n * 16 : 0 }}>
        {/* y axis labels */}
        <div style={{ position: "relative", width: 46, height, flex: "0 0 auto" }}>
          {ticks.map((t) => (
            <span key={t} style={{ position: "absolute", right: 0, top: y(t) - 7, fontSize: 10, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{compact(t)}</span>
          ))}
        </div>
        {/* plot area */}
        <div style={{ position: "relative", flex: 1, height: height + 24 }} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <div key={t} style={{ position: "absolute", left: 0, right: 0, top: y(t), borderTop: t === 0 ? "1px solid var(--border)" : "1px dashed color-mix(in srgb, var(--border) 55%, transparent)", pointerEvents: "none" }} />
          ))}
          {/* bars — one hover slot per day, full column hit area */}
          <div style={{ position: "absolute", inset: `0 0 24px 0`, display: "flex" }}>
            {data.map((d, i) => {
              const pos = d.ggr >= 0;
              const barTop = pos ? y(d.ggr) : y(0);
              const barH = Math.max(2, Math.abs(y(d.ggr) - y(0)));
              return (
                <div key={d.date} onMouseEnter={() => setHover(i)}
                  style={{ position: "relative", flex: 1, minWidth: 6, background: hover === i ? "color-mix(in srgb, var(--mint-12) 70%, transparent)" : "transparent", borderRadius: 4 }}>
                  <div style={{
                    position: "absolute", left: "18%", right: "18%", top: barTop, height: barH,
                    borderRadius: 3,
                    background: pos ? (hover === i ? "var(--mint-bright)" : "var(--mint)") : (hover === i ? "#f0685a" : "var(--loss)"),
                    transition: "background var(--dur-fast)",
                  }} />
                </div>
              );
            })}
          </div>
          {/* x axis labels — plain HTML, never distorted */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex" }}>
            {data.map((d, i) => (
              <span key={d.date} style={{ flex: 1, minWidth: 6, textAlign: "center", fontSize: 10, color: hover === i ? "var(--text)" : "var(--text-muted)", whiteSpace: "nowrap", overflow: "visible" }}>
                {i % labelEvery === 0 ? d.date.slice(5) : ""}
              </span>
            ))}
          </div>
          {/* tooltip */}
          {hovered && (
            <div style={{
              position: "absolute", bottom: height + 30 - y(Math.max(hovered.ggr, 0)),
              left: `${((hover + 0.5) / n) * 100}%`, transform: "translateX(-50%)",
              background: "var(--ink)", border: "1px solid var(--border)", borderRadius: "var(--r-md)",
              padding: "8px 12px", pointerEvents: "none", zIndex: 5, whiteSpace: "nowrap",
              boxShadow: "var(--shadow-md)", animation: "mb-fade-in var(--dur-fast) var(--ease-out)",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 3 }}>
                {new Date(hovered.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </div>
              <div style={{ fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 15, color: moneyTone(hovered.ggr) }}>
                {fmtMoney(hovered.ggr)}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{hovered.rounds.toLocaleString()} rounds</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── primitives ──────────────────────────────────────────────────────────────
export function Btn({ children, onClick, tone = "primary", disabled = false, small = false, type = "button" }) {
  const solid = tone === "primary";
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      style={{
        height: small ? 34 : 42, padding: small ? "0 14px" : "0 20px", borderRadius: "var(--r-md)",
        border: solid ? "none" : "1px solid var(--border)",
        background: solid ? "linear-gradient(180deg, var(--mint-bright) 0%, var(--mint) 55%, var(--mint-deep) 100%)" : "transparent",
        color: solid ? "var(--text-on-accent)" : tone === "danger" ? "var(--loss)" : "var(--text)",
        fontFamily: "var(--font-display)", fontWeight: 700, fontSize: small ? "var(--fs-sm)" : "var(--fs-base)",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
      }}>
      {children}
    </button>
  );
}

export function TextInput({ value, onChange, placeholder, type = "text", onKeyDown, autoFocus }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type}
      onKeyDown={onKeyDown} autoFocus={autoFocus}
      style={{
        width: "100%", height: 44, padding: "0 14px", boxSizing: "border-box",
        background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--r-md)",
        color: "var(--text)", fontFamily: "var(--font-body)", fontSize: "var(--fs-base)", outline: "none",
      }} />
  );
}

export function Modal({ title, onClose, children, width = 440 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(8,14,12,0.7)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", padding: 22, boxSizing: "border-box", animation: "mb-pop var(--dur-base) var(--ease-bounce)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "var(--fs-md)" }}>{title}</span>
          <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: "var(--r-md)", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Copyable secret shown exactly once (API keys, temp passwords).
export function SecretRow({ label, value }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: "var(--fs-caption)", fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <code style={{ flex: 1, padding: "9px 12px", background: "var(--ink)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", fontSize: 12, overflowX: "auto", whiteSpace: "nowrap" }}>{value}</code>
        <Btn small tone="ghost" onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          {copied ? "Copied" : "Copy"}
        </Btn>
      </div>
    </div>
  );
}

// RTP editor: slider across the platform-allowed window + live RTP preview.
export function RtpSlider({ boundsPct, valuePct, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{boundsPct.min.toFixed(1)}%</span>
      <input type="range" min={boundsPct.min} max={boundsPct.max} step={0.1} value={valuePct}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: "var(--mint)" }} />
      <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{boundsPct.max.toFixed(1)}%</span>
      <span style={{ minWidth: 74, textAlign: "right", fontFamily: "var(--font-numeric)", fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: 17, color: "var(--mint-bright)" }}>
        {valuePct.toFixed(1)}%
      </span>
    </div>
  );
}

// Horizontal tab pills — the scale answer for per-game sections: one game's
// panel visible at a time instead of N cards sprawling down the page.
export function Tabs({ items, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
      {items.map((it) => (
        <button key={it.key} onClick={() => onChange(it.key)}
          style={{
            height: 36, padding: "0 16px", borderRadius: "var(--r-md)", cursor: "pointer",
            fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--fs-sm)",
            border: value === it.key ? "1.5px solid var(--mint-bright)" : "1px solid var(--border)",
            background: value === it.key ? "var(--mint-12)" : "var(--surface-raised)",
            color: value === it.key ? "var(--mint-bright)" : "var(--text-muted)",
            display: "inline-flex", alignItems: "center", gap: 7,
          }}>
          {it.label}
          {it.badge && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
              {it.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function DateRangePicker({ value, onChange }) {
  const opts = [
    { key: "7", label: "7 days" },
    { key: "30", label: "30 days" },
    { key: "all", label: "All time" },
  ];
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {opts.map((o) => (
        <button key={o.key} onClick={() => onChange(o.key)}
          style={{
            height: 34, padding: "0 14px", borderRadius: "var(--r-pill)", cursor: "pointer",
            fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--fs-caption)",
            border: value === o.key ? "1px solid var(--mint-32)" : "1px solid var(--border)",
            background: value === o.key ? "var(--mint-12)" : "transparent",
            color: value === o.key ? "var(--mint-bright)" : "var(--text-muted)",
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function rangeQuery(rangeKey) {
  if (rangeKey === "all") return "";
  const from = new Date(Date.now() - parseInt(rangeKey) * 86400000).toISOString().slice(0, 10);
  return `?from=${from}`;
}
