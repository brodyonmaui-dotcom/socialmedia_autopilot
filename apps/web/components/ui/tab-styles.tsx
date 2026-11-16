import { cx } from "./cx.js";

/** v3 segmented control: a hairline card well with equal segments; the active one is a raised pill (44 px on phones, 36 px ≥ lg). */
export const TAB_BAR = "flex w-full gap-1 rounded-ds-sm border border-ds-line bg-ds-card p-1";

/** Wrapping variant: the ds-text gap shows through as 1px lines between ds-bg cells. */
export const TAB_GRID =
  "grid w-full grid-cols-2 gap-1 rounded-ds-sm border border-ds-line bg-ds-card p-1 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none";
/** Cell for TAB_GRID: inactive cells take the page colour over the line-coloured gap; an odd last cell spans on phones. */
export function tabGridCell(active: boolean): string {
  return cx("h-11 text-center last:odd:col-span-2 lg:last:odd:col-span-1", active && "bg-ds-raised");
}

export function tabSegment(active: boolean): string {
  return cx(
    "flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-ds-xs px-3 text-[14px] font-semibold transition-colors duration-[var(--ds-dur)] ease-ds lg:min-h-9",
    active ? "bg-ds-raised text-ds-text" : "text-ds-muted hover:bg-ds-raised hover:text-ds-text",
  );
}

export function TabCount({ count }: { count: number }) {
  return <span className="ds-num font-bold">{count}</span>;
}
