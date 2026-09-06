import React from "react";

export function Tag({ onRemove, children, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: "8px",
        height: 32, padding: onRemove ? "0 8px 0 12px" : "0 12px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
        background: hover ? "var(--surface-alt)" : "var(--surface)",
        color: "var(--text-heading)", fontSize: "var(--text-caption-size)",
        fontWeight: "var(--weight-regular)",
        transition: "background var(--dur) var(--ease-out)",
        ...style,
      }}
      {...rest}
    >
      {children}
      {onRemove ? (
        <button onClick={onRemove} aria-label="제거"
          style={{ width: 18, height: 18, display: "grid", placeItems: "center", border: 0, background: "transparent",
                   color: "var(--text-caption)", cursor: "pointer", borderRadius: "var(--radius-xs)", padding: 0, lineHeight: 1, fontSize: 14 }}>×</button>
      ) : null}
    </span>
  );
}
