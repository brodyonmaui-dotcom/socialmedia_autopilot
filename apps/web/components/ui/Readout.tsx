import { cx } from "./cx.js";

export type ReadoutItem = { k: string; v: string };

/** Mono key/value readouts in two columns (keys faint caps, values full text colour). */
export function Readout({ items, className }: { items: ReadoutItem[]; className?: string }) {
  return (
    <dl className={cx("ds-mono grid grid-cols-2 gap-x-6 gap-y-2", className)}>
      {items.map((it) => (
        <div key={it.k} className="min-w-0">
          <dt className="uppercase text-ds-faint">{it.k}</dt>
          <dd className="text-ds-text">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}
