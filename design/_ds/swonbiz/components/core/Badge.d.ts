import * as React from "react";
/** Pill status/label chip, 26px tall. The one place radius exceeds 12px. */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: "brand" | "neutral" | "accent" | "solid" | "inverse";
  /** Leading 6px status dot */
  dot?: boolean;
  children?: React.ReactNode;
}
export function Badge(props: BadgeProps): JSX.Element;
