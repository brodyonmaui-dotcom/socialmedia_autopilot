import Link from "next/link";
import { isValidElement, type ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";

export type CardLinkAction = { href: string; label: string };

function isLinkAction(a: unknown): a is CardLinkAction {
  return typeof a === "object" && a !== null && !isValidElement(a) && "href" in a && "label" in a;
}

const SPAN: Record<1 | 2 | 3, string> = {
  1: "",
  2: "sm:col-span-2",
  3: "sm:col-span-2 xl:col-span-3",
};

/**
 * v2 bordered cell: 1px ds-line border, no fill (`fill` → bg-ds-card), square corners, no shadow.
 * Header = caps label (optional mono `index` like "01") + a thin corner action.
 * `hero` = inverted (black) band on top, `bleed` = content flush to the bottom/left/right edges (charts).
 * `span` widens it in a CardGrid.
 */
export function Card({
  title,
  index,
  action,
  hero,
  bleed,
  fill = false,
  className,
  as: Tag = "section",
  span = 1,
  children,
}: {
  title?: string;
  /** Mono index shown before the title, e.g. "01". */
  index?: string;
  action?: ReactNode | CardLinkAction;
  hero?: ReactNode;
  bleed?: ReactNode;
  /** Fill the cell with ds-card instead of the transparent default. */
  fill?: boolean;
  className?: string;
  as?: "section" | "div";
  span?: 1 | 2 | 3;
  children?: ReactNode;
}) {
  const actionEl = isLinkAction(action) ? (
    <Link
      href={action.href}
      aria-label={action.label}
      title={action.label}
      className={cx(
        "-mr-3 -mt-3 inline-flex size-11 shrink-0 items-center justify-center text-ds-muted transition-colors duration-300 ease-ds hover:text-ds-accent-fg",
        FOCUS,
      )}
    >
      <Icon name="plus" size={20} strokeWidth={1.25} />
    </Link>
  ) : (
    (action as ReactNode)
  );
  const hasHeader = Boolean(title) || index != null || action != null;
  const hasBody = hasHeader || children != null;
  return (
    <Tag
      className={cx(
        "flex flex-col overflow-hidden border border-ds-line",
        fill ? "bg-ds-card" : "bg-transparent",
        SPAN[span],
        className,
      )}
    >
      {hero != null && <div className="bg-ds-invert p-6 text-ds-on-invert lg:p-8">{hero}</div>}
      {hasBody && (
        <div className="flex-1 p-6 lg:p-8">
          {hasHeader && (
            <div className={cx("flex items-start justify-between gap-3", children != null && "mb-5")}>
              {title || index ? (
                <h2 className="flex min-w-0 items-baseline gap-3 ds-caps text-ds-text">
                  {index && <span className="ds-mono font-normal tracking-[0.04em] text-ds-faint">{index}</span>}
                  {title && <span className="min-w-0">{title}</span>}
                </h2>
              ) : (
                <span />
              )}
              {actionEl}
            </div>
          )}
          {children}
        </div>
      )}
      {bleed != null && <div className="overflow-hidden">{bleed}</div>}
    </Tag>
  );
}

/**
 * Card grid: 1 col phone, 2 cols ≥640px, 3 cols ≥1280px, gap-0 with collapsed borders.
 * Collapse method: every direct child gets `-ml-px -mt-px` so neighbouring 1px borders overlap
 * into a single line; the wrapper's `pl-px pt-px` puts the outer edge back on its grid line.
 */
export function CardGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "grid grid-cols-1 gap-0 pl-px pt-px sm:grid-cols-2 xl:grid-cols-3 [&>*]:-ml-px [&>*]:-mt-px",
        className,
      )}
    >
      {children}
    </div>
  );
}
