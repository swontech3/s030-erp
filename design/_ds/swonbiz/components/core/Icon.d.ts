/** Lucide icon wrapper. SVG is inlined, so stroke inherits currentColor. Sizes 16/20/24 only. */
export interface IconProps {
  /** Lucide icon slug, e.g. "shield-check", "file-text", "sparkles" */
  name: string;
  size?: number;
}
export function Icon(props: IconProps): JSX.Element;
