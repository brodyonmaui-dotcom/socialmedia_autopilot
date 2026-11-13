import { cx } from "./cx.js";

/** v2 bordered strip: equal-width square cells split by 1px ds-text lines. 46px = 44px (h-11) cells + 1px border each side. */
export const TAB_BAR = "flex h-[46px] w-full overflow-hidden border border-ds-text divide-x divide-ds-text";

export function tabSegment(active: boolean): string {
  return cx(
    "flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 px-3 ds-caps transition-colors duration-300 ease-ds",
    active ? "bg-ds-invert text-ds-on-invert" : "text-ds-text hover:bg-ds-raised",
  );
}

export function TabCount({ count }: { count: number }) {
  return <span className="ds-num font-bold">{count}</span>;
}
