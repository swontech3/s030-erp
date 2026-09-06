import * as React from "react";
/** Square icon-only control. Always pass `label` for accessibility. */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "ghost" | "bare" | "primary";
  /** Square edge in px. 40 default; 32 for dense toolbars. */
  size?: number;
  label: string;
  children?: React.ReactNode;
}
export function IconButton(props: IconButtonProps): JSX.Element;
