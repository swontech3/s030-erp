import React from "react";

export function Select({ label, hint, options = [], size = "md", style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const uid = React.useId();
  const h = size === "sm" ? "var(--control-h-sm)" : "var(--control-h)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", ...style }}>
      {label ? <label htmlFor={uid} style={{ fontSize: "var(--text-caption-size)", fontWeight: "var(--weight-bold)", color: "var(--text-heading)" }}>{label}</label> : null}
      <div style={{ position: "relative", display: "flex" }}>
        <select
          id={uid}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            appearance: "none", width: "100%", height: h, padding: "0 40px 0 16px",
            fontFamily: "var(--font-core)", fontSize: "16px", color: "var(--text-heading)",
            background: "var(--surface)", border: `1px solid ${focus ? "var(--color-primary)" : "var(--border)"}`,
            borderRadius: "var(--radius-md)", outline: "none",
            boxShadow: focus ? "0 0 0 3px var(--focus-ring)" : "none",
            transition: "border-color var(--dur) var(--ease-out), box-shadow var(--dur) var(--ease-out)",
          }}
          {...rest}
        >
          {options.map((o) => {
            const v = typeof o === "string" ? o : o.value;
            const l = typeof o === "string" ? o : o.label;
            return <option key={v} value={v}>{l}</option>;
          })}
        </select>
        <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-60%) rotate(45deg)",
                       width: 7, height: 7, borderRight: "1.5px solid var(--text-muted)", borderBottom: "1.5px solid var(--text-muted)", pointerEvents: "none" }} />
      </div>
      {hint ? <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-muted)" }}>{hint}</span> : null}
    </div>
  );
}
