import React from "react";

export function Switch({ checked = false, onChange, label, disabled, style, ...rest }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-3)",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .5 : 1, ...style }}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled}
        onChange={(e) => onChange && onChange(e)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} {...rest} />
      <span style={{
        width: 44, height: 26, borderRadius: "999px", padding: 3, flex: "0 0 auto",
        background: checked ? "var(--color-primary)" : "var(--slate-200)",
        transition: "background var(--dur) var(--ease-out)", display: "flex",
        justifyContent: checked ? "flex-end" : "flex-start",
      }}>
        <span style={{ width: 20, height: 20, borderRadius: 999, background: "#fff", boxShadow: "0 1px 2px rgba(11,17,32,.2)",
                       transition: "transform var(--dur) var(--ease-out)" }} />
      </span>
      {label ? <span style={{ fontSize: "16px", color: "var(--text-heading)" }}>{label}</span> : null}
    </label>
  );
}
