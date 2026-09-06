import * as React from "react";
/**
 * Single-line text field with optional label, hint and error.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  /** Sets the error state and replaces the hint text */
  error?: string;
  size?: "md" | "sm";
  iconLeft?: React.ReactNode;
}
export function Input(props: InputProps): JSX.Element;
