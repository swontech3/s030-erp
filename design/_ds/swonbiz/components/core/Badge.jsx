import React from "react";

const TONES = {
  brand: { background: "var(--color-accent-bg)", color: "var(--color-primary-hover)", border: "1px solid transparent" },
  neutral: { background: "var(--surface-alt)", color: "var(--text-muted)", border: "1px solid var(--border)" },
  accent: { background: "rgba(34,211,238,.14)", color: "#0E7490", border: "1px solid transparent" },
  solid: { background: "var(--color-primary)", color: "#fff", border: "1px solid transparent" },
  inverse: { background: "rgba(255,255,255,.10)", color: "#fff", border: "1px solid rgba(255,255,255,.18)" },
};

export function Badge({ tone = "brand", dot = false, children, style, ...rest }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: "6px",
        height: 26, padding: "0 10px", borderRadius: "var(--radius-pill)",
        fontSize: "var(--text-caption-size)", fontWeight: "var(--weight-bold)",
        letterSpacing: "-.005em", whiteSpace: "nowrap",
        ...TONES[tone], ...style,
      }}
      {...rest}
    >
      {dot ? <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", opacity: .8 }} /> : null}
      {children}
    </span>
  );
}
