import React from "react";

const TONES = {
  info: { accent: "var(--color-primary)", icon: "info" },
  success: { accent: "var(--color-primary)", icon: "check" },
  warning: { accent: "#D97706", icon: "alert-triangle" },
  error: { accent: "#DC2626", icon: "alert-circle" },
};

export function Toast({ tone = "info", title, description, onClose, style }) {
  const t = TONES[tone];
  return (
    <div role="status" style={{
      display: "flex", gap: "var(--space-3)", alignItems: "flex-start",
      width: 380, padding: "var(--space-4)", background: "var(--surface)",
      border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-float)", ...style,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: t.accent, marginTop: 7, flex: "0 0 auto" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        <span style={{ fontSize: "var(--text-body-size)", fontWeight: 700, color: "var(--text-heading)" }}>{title}</span>
        {description ? <span style={{ fontSize: "var(--text-caption-size)", lineHeight: 1.55, color: "var(--text-muted)" }}>{description}</span> : null}
      </div>
      {onClose ? (
        <button onClick={onClose} aria-label="닫기" style={{ border: 0, background: "transparent", color: "var(--text-caption)",
          cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 2 }}>×</button>
      ) : null}
    </div>
  );
}
