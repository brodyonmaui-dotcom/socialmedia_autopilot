import Link from "next/link";
import { isValidElement, type ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";

export type Monogram = { monogram: string; tone?: "accent" | "neutral" };

function isMonogram(a: unknown): a is Monogram {
  return typeof a === "object" && a !== null && !isValidElement(a) && "monogram" in a;
}

/** One list item (<li>): avatar, one-line title + muted subtitle, right-aligned tabular trailing value. */
export function ListRow({
  avatar,
  title,
  subtitle,
  trailing,
  trailingSub,
  href,
}: {
  avatar?: Monogram | ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode | string;
  trailingSub?: string;
  href?: string;
}) {
  const avatarEl = isMonogram(avatar) ? (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-ds-raised text-[13px] font-bold uppercase tracking-[0.06em]",
        avatar.tone === "accent" ? "text-ds-accent ring-1 ring-ds-accent/60" : "text-ds-text",
      )}
    >
      {avatar.monogram}
    </span>
  ) : avatar != null ? (
    <span className="inline-flex shrink-0">{avatar as ReactNode}</span>
  ) : null;

  const inner = (
    <>
      {avatarEl}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        {subtitle && <span className="truncate text-[14px] text-ds-muted">{subtitle}</span>}
      </span>
      {(trailing != null || trailingSub) && (
        <span className="flex shrink-0 flex-col items-end text-right">
          {trailing != null && <span className="ds-num text-[17px]">{trailing}</span>}
          {trailingSub && <span className="ds-num text-[13px] text-ds-muted">{trailingSub}</span>}
        </span>
      )}
    </>
  );

  const base = "flex min-h-14 items-center gap-3 py-3";
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className={cx(
            base,
            "-mx-2 rounded-ds-md px-2 transition-colors duration-[var(--ds-dur)] ease-ds hover:bg-ds-raised",
            FOCUS,
          )}
        >
          {inner}
        </Link>
      ) : (
        <div className={base}>{inner}</div>
      )}
    </li>
  );
}

/** <ul> wrapper for ListRow items with hairline separators. */
export function ListRows({ className, label, children }: { className?: string; label?: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className={cx("divide-y divide-ds-line", className)}>
      {children}
    </ul>
  );
}
