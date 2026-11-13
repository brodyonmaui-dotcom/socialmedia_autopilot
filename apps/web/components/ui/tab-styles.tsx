import { cx } from "./cx.js";

/** White segmented bar; equal-width segments split by thin light-gray dividers. */
export const TAB_BAR = "flex h-11 w-full overflow-hidden rounded-ds-md bg-ds-paper ring-1 ring-ds-line divide-x divide-ds-paper-2";

export function tabSegment(active: boolean): string {
  return cx(
    "flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 px-3 ds-caps font-bold text-ds-ink transition-colors duration-200 ease-ds",
    active ? "bg-ds-accent" : "hover:bg-ds-paper-2",
  );
}

export function TabCount({ count }: { count: number }) {
  return <span className="ds-num font-bold">{count}</span>;
}
