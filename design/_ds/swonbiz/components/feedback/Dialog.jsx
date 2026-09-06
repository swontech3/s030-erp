import React from "react";

export function Dialog({ open, onClose, title, description, footer, width = 480, children }) {
  if (!open) return null;
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center",
               background: "rgba(11,17,32,.44)", backdropFilter: "blur(2px)", padding: "var(--space-6)" }}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: width, background: "var(--surface)", borderRadius: "var(--radius-lg)",
                 border: "1px solid var(--border)", boxShadow: "var(--shadow-overlay)", padding: "var(--space-6)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-4)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <h3 style={{ margin: 0, fontSize: "var(--text-h3-size)", lineHeight: 1.35, fontWeight: 600, color: "var(--text-heading)", letterSpacing: "-.012em" }}>{title}</h3>
            {description ? <p style={{ margin: 0, fontSize: "var(--text-body-size)", lineHeight: 1.6, color: "var(--text-body)" }}>{description}</p> : null}
          </div>
          <button onClick={onClose} aria-label="닫기"
            style={{ width: 32, height: 32, display: "grid", placeItems: "center", border: 0, background: "transparent",
                     color: "var(--text-caption)", cursor: "pointer", borderRadius: "var(--radius-sm)", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        {children ? <div style={{ marginTop: "var(--space-5)" }}>{children}</div> : null}
        {footer ? <div style={{ marginTop: "var(--space-6)", display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>{footer}</div> : null}
      </div>
    </div>
  );
}
