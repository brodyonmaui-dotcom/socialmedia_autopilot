import type { ReactNode } from "react";
import { CONTAINER } from "./GridLines.js";
import { cx } from "./cx.js";

/** Section heading band: mono index, Inter 900 <h2> (+ optional serif word), caps meta on the right. */
export function SectionHead({
  index,
  title,
  serif,
  meta,
  id,
}: {
  index: string;
  title: string;
  serif?: string;
  meta?: ReactNode;
  id?: string;
}) {
  return (
    <div className="border-b border-ds-line">
      <div className={cx(CONTAINER, "grid grid-cols-4 items-end gap-y-3 py-6 lg:grid-cols-12 lg:py-10")}>
        <p className="ds-mono col-span-1 self-start text-ds-muted lg:self-end">{index}</p>
        <h2
          id={id}
          className="col-span-3 text-[32px] font-black leading-[0.95] tracking-[-0.04em] lg:col-span-8 lg:text-[56px]"
        >
          {title}
          {serif && (
            <>
              {" "}
              <span className="ds-serif font-normal">{serif}</span>
            </>
          )}
        </h2>
        {meta != null && <div className="ds-caps col-span-4 text-ds-muted lg:col-span-3 lg:text-right">{meta}</div>}
      </div>
    </div>
  );
}
