import React from "react";

export function Tooltip({ content, placement = "top", children, style }) {
  const [open, setOpen] = React.useState(false);
  const pos = {
    top: { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    bottom: { top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    right: { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
  }[placement];
  return (
    <span style={{ position: "relative", display: "inline-flex", ...style }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {children}
      <span role="tooltip" style={{
        position: "absolute", ...pos, zIndex: 40,
        opacity: open ? 1 : 0, visibility: open ? "visible" : "hidden",
        transition: "opacity var(--dur) var(--ease-out)",
        background: "var(--surface-inverse)", color: "#fff",
        fontSize: "var(--text-caption-size)", lineHeight: 1.45, fontWeight: 400,
        padding: "8px 12px", borderRadius: "var(--radius-sm)", whiteSpace: "nowrap",
        boxShadow: "var(--shadow-float)", pointerEvents: "none",
      }}>{content}</span>
    </span>
  );
}
