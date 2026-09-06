import * as React from "react";
/** Single-choice control. Group several with a shared `name`. */
export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
}
export function Radio(props: RadioProps): JSX.Element;
