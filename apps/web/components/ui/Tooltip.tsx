import type { ReactNode } from "react";
import { cx } from "./cx.js";

export interface TooltipProps {
  /** Id of the tooltip element. The caller puts `aria-describedby={id}` on the trigger (no cloning). */
  id: string;
  text: string;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}

/**
 * CSS-only hint: shows on hover and focus-within of the wrapper. Never the only place
 * information lives (the trigger still needs its own aria-label).
 *
 *   <Tooltip id="tt-refresh" text="Refresh stats">
 *     <Button variant="icon" aria-label="Refresh" aria-describedby="tt-refresh">…</Button>
 *   </Tooltip>
 */
export function Tooltip({ id, text, children, side = "top", className }: TooltipProps) {
  const top = side === "top";
  return (
    <span className={cx("group/tt relative inline-flex", className)}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={cx(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-60 -translate-x-1/2 bg-ds-invert px-3 py-2",
          "ds-mono leading-snug text-ds-on-invert shadow-ds-pop",
          "invisible opacity-0 transition-opacity duration-300 ease-ds",
          "group-hover/tt:visible group-hover/tt:opacity-100 group-focus-within/tt:visible group-focus-within/tt:opacity-100",
          top ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        {text}
        <span
          aria-hidden="true"
          className={cx(
            "absolute left-1/2 size-2 -translate-x-1/2 rotate-45 bg-ds-invert",
            top ? "-bottom-1" : "-top-1",
          )}
        />
      </span>
    </span>
  );
}
