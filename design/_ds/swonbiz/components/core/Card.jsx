import React from "react";

export function Card({ padding = 24, interactive = false, tone = "surface", children, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const tones = {
    surface: { background: "var(--surface-card)", border: "1px solid var(--border)" },
    alt: { background: "var(--surface-alt)", border: "1px solid var(--border)" },
    inverse: { background: "var(--surface-inverse)", border: "1px solid rgba(255,255,255,.10)" },
  };
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: "var(--radius-lg)",
        padding,
        boxShadow: "none",
        transition: "border-color var(--dur) var(--ease-out), transform var(--dur) var(--ease-out)",
        ...tones[tone],
        ...(interactive ? {
          cursor: "pointer",
          borderColor: hover ? "var(--color-secondary)" : undefined,
          transform: hover ? "translateY(-2px)" : "none",
        } : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
