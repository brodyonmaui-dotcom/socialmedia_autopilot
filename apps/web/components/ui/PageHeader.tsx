import Link from "next/link";
import type { ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";

/** The app's name as a wordmark: "My Socials" in the display face, 28 px. */
export const APP_NAME = "My Socials";

/** `size="lg"` = 40 px (login card); default 28 px (top bar, sidebar). */
export function Wordmark({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  return <span className={cx("ds-font-display whitespace-nowrap leading-none text-ds-text", size === "lg" ? "text-[40px]" : "text-[28px]", className)}>{APP_NAME}</span>;
}

/**
 * Page title row: display title (40 / 56 px), optional one-line sans subtitle, right-side slot for one
 * Dropdown or one button. `back` adds a small link above the title.
 */
export function PageHeader({
  title,
  subtitle,
  action,
  back,
  id,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  back?: { href: string; label: string };
  id?: string;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pb-5 pt-6 lg:pb-8 lg:pt-10", className)}>
      <div className="min-w-0">
        {back && (
          <Link
            href={back.href}
            className={cx("-ml-1 mb-3 inline-flex min-h-11 items-center gap-1 rounded-ds-sm px-1 text-[14px] font-semibold text-ds-muted hover:text-ds-text lg:min-h-8", FOCUS)}
          >
            <Icon name="chevronLeft" size={16} />
            {back.label}
          </Link>
        )}
        <h1 id={id} className="ds-title text-ds-text">
          {title}
        </h1>
        {subtitle != null && <p className="mt-2 text-[15px] text-ds-muted">{subtitle}</p>}
      </div>
      {action != null && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </header>
  );
}
