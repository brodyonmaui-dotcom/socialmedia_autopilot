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
 * Grouped block: bg-ds-card, 16px radius, no border. `hero` = full-width accent band on top,
 * `bleed` = content flush to the bottom/left/right edges (charts). `span` widens it in a CardGrid.
 */
export function Card({
  title,
  action,
  hero,
  bleed,
  className,
  as: Tag = "section",
  span = 1,
  children,
}: {
  title?: string;
  action?: ReactNode | CardLinkAction;
  hero?: ReactNode;
  bleed?: ReactNode;
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
        "-mr-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-ds-md text-ds-muted transition-colors duration-[var(--ds-dur)] ease-ds hover:text-ds-text",
        FOCUS,
      )}
    >
      <Icon name="plus" size={22} strokeWidth={1.25} />
    </Link>
  ) : (
    (action as ReactNode)
  );
  const hasHeader = Boolean(title) || action != null;
  const hasBody = hasHeader || children != null;
  return (
    <Tag className={cx("flex flex-col overflow-hidden rounded-ds-lg bg-ds-card shadow-ds-card", SPAN[span], className)}>
      {hero != null && <div className="rounded-t-ds-lg bg-ds-accent p-5 text-ds-ink">{hero}</div>}
      {hasBody && (
        <div className="flex-1 p-5">
          {hasHeader && (
            <div className={cx("flex items-start justify-between gap-3", children != null && "mb-4")}>
              {title ? <h2 className="min-w-0 text-[18px] font-bold leading-[1.25]">{title}</h2> : <span />}
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

/** Card grid: 1 col phone, 2 cols ≥640px, 3 cols ≥1280px; 16/20px gaps. */
export function CardGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-5 xl:grid-cols-3", className)}>{children}</div>
  );
}
