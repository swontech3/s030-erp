import * as React from "react";
/** Centered modal on a 44%-opacity #0B1120 scrim. One decision per dialog. */
export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title: string;
  description?: string;
  /** Action row, right-aligned. Ghost cancel first, primary confirm last. */
  footer?: React.ReactNode;
  width?: number;
  children?: React.ReactNode;
}
export function Dialog(props: DialogProps): JSX.Element | null;
