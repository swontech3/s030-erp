import * as React from "react";

/**
 * Primary action control. 54px tall, 30px side padding, 8px radius.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = indigo fill + brand shadow; ghost = hairline border; subtle = indigo-50 fill; inverse = for dark sections; link = inline text action */
  variant?: "primary" | "ghost" | "subtle" | "inverse" | "link";
  /** md = 54px (default), sm = 40px for dense UI/tables */
  size?: "md" | "sm";
  fullWidth?: boolean;
  disabled?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  /** Render as another element, e.g. "a" */
  as?: "button" | "a";
  children?: React.ReactNode;
}
export function Button(props: ButtonProps): JSX.Element;
