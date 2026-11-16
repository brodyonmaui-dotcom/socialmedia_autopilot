import { cx } from "./cx.js";

export type DisplayLine = { text: string; style?: "solid" | "stroke" | "serif" };

/**
 * @deprecated v2 hero type. v3 renders the lines as one plain page title in the display face (one font,
 * one style per phrase; no outline or italic words). New screens use PageHeader.
 */
export function Display({ lines, as: Tag = "h1", className }: { lines: DisplayLine[]; as?: "h1" | "h2"; className?: string }) {
  return <Tag className={cx("ds-title text-ds-text", className)}>{lines.map((l) => l.text).join(" ")}</Tag>;
}
