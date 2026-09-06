import * as React from "react";
/** 20px checkbox with 4px radius. Controlled: pass checked + onChange. */
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  /** Secondary line under the label */
  description?: string;
  checked?: boolean;
  disabled?: boolean;
}
export function Checkbox(props: CheckboxProps): JSX.Element;
