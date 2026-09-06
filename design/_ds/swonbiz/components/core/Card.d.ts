import * as React from "react";
/**
 * Content container: 12px radius, 1px #E2E8F0 border, no shadow.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** px padding, 4px multiples. 24 default, 20 for dense dashboards, 32 for feature cards. */
  padding?: number;
  /** Adds hover lift + indigo-400 border. Only for cards that navigate. */
  interactive?: boolean;
  tone?: "surface" | "alt" | "inverse";
  children?: React.ReactNode;
}
export function Card(props: CardProps): JSX.Element;
