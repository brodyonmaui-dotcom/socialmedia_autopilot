export type MarqueeItem = { text: string; style?: "stroke" | "serif" | "solid" };

/** @deprecated v2 star separator (decoration). Renders nothing. */
export function Star(_: { className?: string }) {
  return null;
}

/**
 * @deprecated v2 ticker. v3 hard rule 2 (nothing moves unless the user caused it) removes marquees, so
 * this renders nothing; it stays exported only until the remaining v2 pages drop their import.
 */
export function Marquee(_: { items: MarqueeItem[]; size?: "xl" | "bg"; label: string; className?: string }) {
  return null;
}
