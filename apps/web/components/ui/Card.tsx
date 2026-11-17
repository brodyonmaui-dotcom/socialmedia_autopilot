import Link from "next/link";
import { isValidElement, type ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";

export type CardLinkAction = { href: string; label: string };

function isLinkAction(a: unknown): a is CardLinkAction {
  return typeof a === "object" && a !== null && !isValidElement(a) && "href" in a && "label" in a;
}

const SPAN: Record<1 | 2 | 3, string> = {
  1: "",
  2: "sm:col-span-2",
  3: "sm:col-span-2 xl:col-span-3",
};

/** Small text link used as a card's corner action ("See all"). */
export function CardLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cx(
        "-my-2 -mr-2 inline-flex min-h-11 shrink-0 items-center rounded-ds-sm px-2 text-[14px] font-semibold text-ds-accent-fg hover:bg-ds-raised lg:min-h-9",
        FOCUS,
        className,
      )}
    >
      {children}
    </Link>
  );
}

/**
 * v3 card: card fill, 1 px hairline, 12 px radius, no shadow; padding 16 phone / 20 desktop.
 * Header = display title (22 / 24 px) + optional right-side action (a CardLink, a Dropdown, a Menu or
 * `{ href, label }`). The card stretches to its row's height (`h-full`), so a row's cards are equal.
 * `bleed` = content flush to the card's edges under the body (charts, tables). `footer` = a bottom row.
 * Legacy v2 props (`index`, `hero`, `fill`, `span`) still compile; `index` is ignored.
 */
export function Card({
  title,
  titleId,
  subtitle,
  action,
  footer,
  hero,
  bleed,
  className,
  bodyClassName,
  as: Tag = "section",
  span = 1,
  children,
}: {
  title?: string;
  /** id on the title (for aria-labelledby). Defaults to none. */
  titleId?: string;
  /** One short muted line under the title. */
  subtitle?: ReactNode;
  action?: ReactNode | CardLinkAction;
  footer?: ReactNode;
  /** @deprecated v2 inverted band; rendered as a plain top block. */
  hero?: ReactNode;
  bleed?: ReactNode;
  /** @deprecated v2: index labels are gone in v3. */
  index?: string;
  /** @deprecated v2: v3 cards are always filled. */
  fill?: boolean;
  className?: string;
  bodyClassName?: string;
  as?: "section" | "div" | "article" | "li";
  span?: 1 | 2 | 3;
  children?: ReactNode;
}) {
  const actionEl = isLinkAction(action) ? <CardLink href={action.href}>{action.label}</CardLink> : (action as ReactNode);
  const hasHeader = Boolean(title) || action != null;
  return (
    <Tag
      aria-labelledby={Tag === "section" && titleId ? titleId : undefined}
      className={cx("flex h-full min-w-0 flex-col overflow-hidden rounded-ds-lg border border-ds-line bg-ds-card text-ds-text", SPAN[span], className)}
    >
      {hero != null && <div className="border-b border-ds-line p-4 lg:p-5">{hero}</div>}
      {(hasHeader || children != null) && (
        <div className={cx("flex flex-1 flex-col p-4 lg:p-5", bodyClassName)}>
          {hasHeader && (
            <div className={cx("flex items-start justify-between gap-3", children != null && "mb-4")}>
              <div className="min-w-0">
                {title && (
                  <h2 id={titleId} className="ds-heading text-ds-text">
                    {title}
                  </h2>
                )}
                {subtitle != null && <p className="mt-1 text-[13px] text-ds-muted">{subtitle}</p>}
              </div>
              {actionEl != null && <div className="flex shrink-0 items-center gap-1">{actionEl}</div>}
            </div>
          )}
          {children}
        </div>
      )}
      {bleed != null && <div className="overflow-hidden">{bleed}</div>}
      {footer != null && <div className="border-t border-ds-line px-4 py-3 lg:px-5">{footer}</div>}
    </Tag>
  );
}

/** Card grid (v3): cards never share borders. 1 col phone, 2 ≥ 640 px, 3 ≥ 1280 px; gap 12 / 16. */
export function CardGrid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-3", className)}>{children}</div>;
}
