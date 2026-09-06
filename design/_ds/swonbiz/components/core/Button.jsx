import React from "react";

const SIZES = {
  md: { height: "var(--control-h)", padding: "0 var(--control-px)", fontSize: "16px" },
  sm: { height: "var(--control-h-sm)", padding: "0 var(--control-px-sm)", fontSize: "14px" },
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  disabled = false,
  iconLeft,
  iconRight,
  as = "button",
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const h = hover && !disabled;

  const variants = {
    primary: {
      background: h ? "var(--color-primary-hover)" : "var(--color-primary)",
      color: "var(--text-on-primary)",
      border: "1px solid transparent",
      boxShadow: h ? "var(--shadow-primary-hover)" : "var(--shadow-primary)",
    },
    ghost: {
      background: h ? "var(--surface-alt)" : "var(--surface)",
      color: "var(--text-heading)",
      border: "1px solid var(--border)",
      boxShadow: "none",
    },
    subtle: {
      background: h ? "#E4E9FF" : "var(--color-accent-bg)",
      color: "var(--color-primary-hover)",
      border: "1px solid transparent",
      boxShadow: "none",
    },
    inverse: {
      background: h ? "#FFFFFF" : "rgba(255,255,255,.10)",
      color: h ? "var(--slate-950)" : "#FFFFFF",
      border: "1px solid rgba(255,255,255,.22)",
      boxShadow: "none",
    },
    link: {
      background: "transparent",
      color: h ? "var(--text-link-hover)" : "var(--text-link)",
      border: "1px solid transparent",
      boxShadow: "none",
      padding: 0,
      height: "auto",
    },
  };

  const Tag = as;
  return (
    <Tag
      disabled={Tag === "button" ? disabled : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{
        display: fullWidth ? "flex" : "inline-flex",
        width: fullWidth ? "100%" : undefined,
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-2)",
        fontFamily: "var(--font-core)",
        fontWeight: "var(--weight-bold)",
        letterSpacing: "-.01em",
        borderRadius: "var(--radius-md)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transform: active && !disabled ? "translateY(1px)" : "none",
        transition: "background var(--dur) var(--ease-out), box-shadow var(--dur) var(--ease-out), color var(--dur) var(--ease-out), transform var(--dur-fast) var(--ease-out)",
        textDecoration: "none",
        whiteSpace: "nowrap",
        ...SIZES[size],
        ...variants[variant],
        ...style,
      }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </Tag>
  );
}
