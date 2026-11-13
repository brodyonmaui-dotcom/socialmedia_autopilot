import Link from "next/link";
import { isValidElement, type ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { PlatformLogo, type Platform } from "./PlatformLogo.js";

export type Monogram = { monogram: string; tone?: "accent" | "neutral" };

/** A platform logo on its own (no circle), in the text colour. */
export type PlatformAvatar = { platform: Platform };

function isPlatform(a: unknown): a is PlatformAvatar {
  return typeof a === "object" && a !== null && !isValidElement(a) && "platform" in a;
}

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
  avatar?: PlatformAvatar | Monogram | ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode | string;
  trailingSub?: string;
  href?: string;
}) {
  const avatarEl = isPlatform(avatar) ? (
    <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center text-ds-text">
      <PlatformLogo platform={avatar.platform} size={26} />
    </span>
  ) : isMonogram(avatar) ? (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex size-10 shrink-0 items-center justify-center border text-[12px] font-bold uppercase tracking-[0.12em]",
        avatar.tone === "accent" ? "border-ds-accent text-ds-accent-fg" : "border-ds-line text-ds-text",
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
        <span className="truncate text-[16px] font-medium text-ds-text">{title}</span>
        {subtitle && <span className="mt-0.5 truncate ds-mono text-ds-faint">{subtitle}</span>}
      </span>
      {(trailing != null || trailingSub) && (
        <span className="flex shrink-0 flex-col items-end text-right">
          {trailing != null && <span className="ds-num text-[16px] font-bold">{trailing}</span>}
          {trailingSub && <span className="mt-0.5 ds-mono text-ds-faint">{trailingSub}</span>}
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
            "-mx-2 px-2 transition-colors duration-300 ease-ds hover:bg-ds-raised",
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
