import * as React from "react";
/** Dark 14px label on hover/focus. One short line — never a paragraph, never interactive content. */
export interface TooltipProps {
  content: React.ReactNode;
  placement?: "top" | "bottom" | "right";
  children?: React.ReactNode;
}
export function Tooltip(props: TooltipProps): JSX.Element;
