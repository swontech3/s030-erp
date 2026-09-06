import * as React from "react";
/** Native select with SwonBiz chrome. Options accept strings or {label,value}. */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  options?: Array<string | { label: string; value: string }>;
  size?: "md" | "sm";
}
export function Select(props: SelectProps): JSX.Element;
