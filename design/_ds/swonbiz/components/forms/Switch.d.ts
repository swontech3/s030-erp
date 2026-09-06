import * as React from "react";
/** 44x26 toggle for instant-apply settings. Use Checkbox for form submission instead. */
export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  checked?: boolean;
  label?: string;
  disabled?: boolean;
}
export function Switch(props: SwitchProps): JSX.Element;
