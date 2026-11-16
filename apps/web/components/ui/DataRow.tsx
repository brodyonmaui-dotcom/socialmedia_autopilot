import Link from "next/link";
import type { ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";

/** Round initial avatar for people (comment authors). Decorative; the name is in the row title. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const ch = (name.replace(/^@/, "").trim()[0] ?? "?").toUpperCase();
  return (
    <span aria-hidden="true" className={cx("inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-ds-raised text-[14px] font-semibold text-ds-text", className)}>
      {ch}
    </span>
  );
}

/**
 * One row of a list card: leading icon / thumb / avatar, title (one line), meta (one muted line),
 * optional body below (e.g. a comment and its drafted reply), and a right-side value or action.
 * `href` makes the title row a link (the trailing slot stays outside the link so its buttons work).
 * Rows are separated by the list's own dividers: wrap them in `DataList`.
 */
export function DataRow({
  icon,
  leading,
  title,
  meta,
  trailing,
  href,
  children,
  className,
}: {
  icon?: IconName;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  children?: ReactNode;
  className?: string;
}) {
  const lead =
    leading ??
    (icon ? (
      <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-ds-sm bg-ds-raised text-ds-text">
        <Icon name={icon} size={18} />
      </span>
    ) : null);
  const head = (
    <>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold text-ds-text">{title}</span>
        {meta != null && <span className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-ds-muted">{meta}</span>}
      </span>
    </>
  );
  return (
    <li className={cx("flex flex-col gap-3 py-3 first:pt-0 last:pb-0", className)}>
      <div className="flex min-h-11 items-center gap-3">
        {href ? (
          <Link href={href} className={cx("-mx-1.5 flex min-w-0 flex-1 items-center gap-3 rounded-ds-sm px-1.5 py-1 hover:bg-ds-raised", FOCUS)}>
            {head}
          </Link>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">{head}</div>
        )}
        {trailing != null && <div className="ds-num flex shrink-0 items-center gap-2 text-[15px] font-semibold text-ds-text">{trailing}</div>}
      </div>
      {children != null && <div className="flex min-w-0 flex-col gap-3">{children}</div>}
    </li>
  );
}

/** The list wrapper for DataRows: rows split by the list's own hairline dividers. */
export function DataList({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className={cx("flex flex-col divide-y divide-ds-line", className)}>
      {children}
    </ul>
  );
}

export type NoticeTone = "info" | "warn" | "danger";

/** One-line strip (a note after an action, or "Snapchat: today's Spotlight is ready"). Optional link on the right. */
export function InlineNotice({
  tone = "info",
  children,
  href,
  linkLabel,
  live = false,
  className,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  href?: string;
  linkLabel?: string;
  /** role="status" (info) / "alert" (warn, danger) so a post-action note is announced. */
  live?: boolean;
  className?: string;
}) {
  const icon: IconName = tone === "info" ? "check" : "alert";
  const color = tone === "info" ? "text-ds-accent-fg" : tone === "warn" ? "text-ds-warn" : "text-ds-danger";
  return (
    <div
      role={live ? (tone === "info" ? "status" : "alert") : undefined}
      className={cx("flex min-h-12 items-center gap-3 rounded-ds-lg border border-ds-line bg-ds-card px-4 py-2", className)}
    >
      <Icon name={icon} size={18} className={cx("shrink-0", color)} />
      <p className="min-w-0 flex-1 text-[15px] text-ds-text">{children}</p>
      {href && linkLabel && (
        <Link href={href} className={cx("-mr-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-ds-sm px-2 text-[14px] font-semibold text-ds-accent-fg hover:bg-ds-raised lg:min-h-9", FOCUS)}>
          {linkLabel}
          <Icon name="chevronRight" size={16} />
        </Link>
      )}
    </div>
  );
}
