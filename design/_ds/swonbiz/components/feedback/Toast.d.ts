import * as React from "react";
/** Transient notice, bottom-right stack, 380px wide. Tone shows as a dot, never a colored panel. */
export interface ToastProps {
  tone?: "info" | "success" | "warning" | "error";
  title: string;
  description?: string;
  onClose?: () => void;
}
export function Toast(props: ToastProps): JSX.Element;
