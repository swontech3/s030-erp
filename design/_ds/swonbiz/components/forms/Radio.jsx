import React from "react";

export function Radio({ name, value, label, description, checked, onChange, disabled, style, ...rest }) {
  const uid = React.useId();
  return (
    <label htmlFor={uid} style={{ display: "flex", gap: "var(--space-3)", alignItems: description ? "flex-start" : "center",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .5 : 1, ...style }}>
      <input id={uid} type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled}
        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} {...rest} />
      <span style={{
        width: 20, height: 20, flex: "0 0 auto", marginTop: description ? 2 : 0, borderRadius: "999px",
        border: checked ? "6px solid var(--color-primary)" : "1px solid var(--border-strong)",
        background: "var(--surface)",
        transition: "border var(--dur) var(--ease-out)",
      }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: "16px", color: "var(--text-heading)" }}>{label}</span>
        {description ? <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-muted)" }}>{description}</span> : null}
      </span>
    </label>
  );
}
