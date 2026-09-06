import React from "react";

export function IconButton({ variant = "ghost", size = 40, label, children, disabled, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const h = hover && !disabled;
  const variants = {
    ghost: { background: h ? "var(--surface-alt)" : "transparent", border: "1px solid var(--border)", color: "var(--text-body)" },
    bare: { background: h ? "var(--surface-alt)" : "transparent", border: "1px solid transparent", color: "var(--text-muted)" },
    primary: { background: h ? "var(--color-primary-hover)" : "var(--color-primary)", border: "1px solid transparent", color: "#fff" },
  };
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center",
        borderRadius: "var(--radius-md)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
        transition: "background var(--dur) var(--ease-out), color var(--dur) var(--ease-out)",
        padding: 0, ...variants[variant], ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
