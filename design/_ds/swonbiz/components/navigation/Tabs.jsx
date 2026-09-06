import React from "react";

export function Tabs({ items = [], value, onChange, variant = "underline", style, ...rest }) {
  const active = value ?? (items[0] && (items[0].value ?? items[0]));
  if (variant === "segmented") {
    return (
      <div style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--surface-alt)",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-md)", ...style }} {...rest}>
        {items.map((it) => {
          const v = it.value ?? it; const l = it.label ?? it;
          const on = v === active;
          return (
            <button key={v} onClick={() => onChange && onChange(v)}
              style={{ height: 32, padding: "0 14px", border: 0, borderRadius: "var(--radius-sm)",
                       background: on ? "var(--surface)" : "transparent",
                       color: on ? "var(--text-heading)" : "var(--text-muted)",
                       fontFamily: "var(--font-core)", fontSize: "14px", fontWeight: on ? 700 : 400,
                       cursor: "pointer", transition: "background var(--dur) var(--ease-out)" }}>{l}</button>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: "var(--space-6)", borderBottom: "1px solid var(--border)", ...style }} {...rest}>
      {items.map((it) => {
        const v = it.value ?? it; const l = it.label ?? it;
        const on = v === active;
        return (
          <button key={v} onClick={() => onChange && onChange(v)}
            style={{ position: "relative", border: 0, background: "transparent", padding: "0 0 12px",
                     fontFamily: "var(--font-core)", fontSize: "16px", fontWeight: on ? 700 : 400,
                     color: on ? "var(--text-heading)" : "var(--text-muted)", cursor: "pointer",
                     transition: "color var(--dur) var(--ease-out)" }}>
            {l}
            {it.count != null ? <span style={{ marginLeft: 8, fontSize: 13, color: "var(--text-caption)" }}>{it.count}</span> : null}
            <span style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: 2,
                           background: on ? "var(--color-primary)" : "transparent" }} />
          </button>
        );
      })}
    </div>
  );
}
