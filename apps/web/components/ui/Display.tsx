import { cx } from "./cx.js";

export type DisplayLine = { text: string; style?: "solid" | "stroke" | "serif" };

const LINE: Record<NonNullable<DisplayLine["style"]>, string> = {
  solid: "font-black ds-num",
  stroke: "ds-stroke font-black",
  serif: "ds-serif font-normal text-[0.9em]",
};

/** Hero display type: one heading, each line a block (solid / outline / serif italic). All lines are real text. */
export function Display({ lines, as: Tag = "h1", className }: { lines: DisplayLine[]; as?: "h1" | "h2"; className?: string }) {
  return (
    <Tag className={cx("ds-display", className)}>
      {lines.map((l, i) => (
        <span key={i} className={cx("block", LINE[l.style ?? "solid"])}>
          {i > 0 && <span className="sr-only"> </span>}
          {l.text}
        </span>
      ))}
    </Tag>
  );
}
