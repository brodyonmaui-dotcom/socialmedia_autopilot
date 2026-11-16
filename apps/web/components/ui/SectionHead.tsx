import type { ReactNode } from "react";
import { CONTAINER } from "./GridLines.js";
import { cx } from "./cx.js";

/**
 * @deprecated v2 section band. v3: a display section title with an optional muted label on the right;
 * no index numbers and no full-width rule. New screens put titles on their Card instead.
 */
export function SectionHead({
  title,
  serif,
  meta,
  id,
}: {
  /** Ignored in v3 (no index labels). */
  index?: string;
  title: string;
  /** Appended in the same font (v3: one font per phrase). */
  serif?: string;
  meta?: ReactNode;
  id?: string;
}) {
  return (
    <div className={cx(CONTAINER, "flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-4 pt-8 lg:pt-10")}>
      <h2 id={id} className="ds-heading min-w-0 text-ds-text">
        {serif ? `${title} ${serif}` : title}
      </h2>
      {meta != null && <div className="ds-label text-ds-muted">{meta}</div>}
    </div>
  );
}
