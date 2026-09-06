import * as React from "react";
/** Rectangular 6px-radius chip for filters and multi-select values. Removable when onRemove is passed. */
export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  onRemove?: () => void;
  children?: React.ReactNode;
}
export function Tag(props: TagProps): JSX.Element;
