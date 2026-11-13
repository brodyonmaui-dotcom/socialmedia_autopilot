import Link from "next/link";
import type { ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { CONTAINER } from "./GridLines.js";
import { Icon, type IconName } from "./Icon.js";
import { PILL_CTA } from "./SiteHeader.js";

/** `href` → link; without it a submit button (for use inside a form). `icon` is a v1 leftover (shown before the label). */
export type TopBarAction = { href?: string; label: string; icon?: IconName };

function ActionEl({ action }: { action: TopBarAction }) {
  const cls = cx(PILL_CTA, "gap-2", FOCUS);
  const inner = (
    <>
      {action.icon && <Icon name={action.icon} size={16} strokeWidth={2} />}
      {action.label}
    </>
  );
  return action.href ? (
    <Link href={action.href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="submit" className={cls}>
      {inner}
    </button>
  );
}

/**
 * Page-title band for non-home pages: mono index ("01 /"), a big Inter 900 <h1> with an optional serif
 * italic word, caps meta and one pill action on the right. v1 props (subtitle, search, extra) still work.
 */
export function TopBar({
  index,
  title,
  serif,
  meta,
  action,
  subtitle,
  search,
  extra,
}: {
  index?: string;
  title: string;
  /** One italic word appended to the title. */
  serif?: string;
  meta?: string;
  action?: TopBarAction;
  /** @deprecated v1: shown as body text under the title. */
  subtitle?: string;
  /** @deprecated v1: renders a search link next to the action. */
  search?: { href: string };
  /** Small secondary control(s) left of the action. */
  extra?: ReactNode;
}) {
  return (
    <header className="border-b border-ds-line">
      <div className={cx(CONTAINER, "flex flex-col gap-6 py-8 lg:flex-row lg:items-end lg:justify-between lg:py-12")}>
        <div className="min-w-0">
          {index && <p className="ds-mono mb-3 text-ds-muted">{index} /</p>}
          <h1 className="text-[40px] font-black leading-[0.95] tracking-[-0.04em] lg:text-[72px]">
            {title}
            {serif && (
              <>
                {" "}
                <span className="ds-serif font-normal">{serif}</span>
              </>
            )}
          </h1>
          {subtitle && <p className="mt-3 max-w-prose text-[16px] text-ds-muted">{subtitle}</p>}
        </div>
        {(meta || action || search || extra) && (
          <div className="flex shrink-0 flex-wrap items-center gap-3 lg:justify-end">
            {meta && <p className="ds-caps mr-auto text-ds-muted lg:mr-3">{meta}</p>}
            {extra}
            {search && (
              <Link
                href={search.href}
                aria-label="Search"
                title="Search"
                className={cx(
                  "inline-flex size-11 items-center justify-center border border-ds-line text-ds-text hover:bg-ds-raised",
                  FOCUS,
                )}
              >
                <Icon name="search" size={20} />
              </Link>
            )}
            {action && <ActionEl action={action} />}
          </div>
        )}
      </div>
    </header>
  );
}
