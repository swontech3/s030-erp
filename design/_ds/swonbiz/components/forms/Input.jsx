import React from "react";

export function Input({ label, hint, error, size = "md", iconLeft, id, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const uid = id || React.useId();
  const h = size === "sm" ? "var(--control-h-sm)" : "var(--control-h)";
  const border = error ? "#DC2626" : focus ? "var(--color-primary)" : "var(--border)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", ...style }}>
      {label ? (
        <label htmlFor={uid} style={{ fontSize: "var(--text-caption-size)", fontWeight: "var(--weight-bold)", color: "var(--text-heading)" }}>{label}</label>
      ) : null}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        {iconLeft ? <span style={{ position: "absolute", left: 14, display: "flex", color: "var(--text-caption)" }}>{iconLeft}</span> : null}
        <input
          id={uid}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            width: "100%", height: h,
            padding: iconLeft ? "0 16px 0 42px" : "0 16px",
            fontFamily: "var(--font-core)", fontSize: "16px", color: "var(--text-heading)",
            background: "var(--surface)", border: `1px solid ${border}`,
            borderRadius: "var(--radius-md)", outline: "none",
            boxShadow: focus ? "0 0 0 3px var(--focus-ring)" : "none",
            transition: "border-color var(--dur) var(--ease-out), box-shadow var(--dur) var(--ease-out)",
          }}
          {...rest}
        />
      </div>
      {error || hint ? (
        <span style={{ fontSize: "var(--text-caption-size)", color: error ? "#DC2626" : "var(--text-muted)" }}>{error || hint}</span>
      ) : null}
    </div>
  );
}
