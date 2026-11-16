import { cx } from "./cx.js";

export type ReadoutItem = { k: string; v: string };

/** @deprecated v2 readout. v3: label / value pairs in two columns, Inter, tabular numbers (no monospace). */
export function Readout({ items, className }: { items: ReadoutItem[]; className?: string }) {
  return (
    <dl className={cx("grid grid-cols-2 gap-x-6 gap-y-3", className)}>
      {items.map((it) => (
        <div key={it.k} className="min-w-0">
          <dt className="ds-label text-ds-muted">{it.k}</dt>
          <dd className="ds-num text-[15px] text-ds-text">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}
