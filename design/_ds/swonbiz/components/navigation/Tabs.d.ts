import * as React from "react";
/**
 * View switcher. `underline` for page-level sections, `segmented` for in-card filters.
 * @startingPoint section="Navigation" subtitle="Underline and segmented tabs" viewport="700x180"
 */
export interface TabItem { label: string; value: string; count?: number }
export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  items: Array<TabItem | string>;
  value?: string;
  onChange?: (value: string) => void;
  variant?: "underline" | "segmented";
}
export function Tabs(props: TabsProps): JSX.Element;
