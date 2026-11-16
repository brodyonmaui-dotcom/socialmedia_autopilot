import Link from "next/link";
import type { ButtonHTMLAttributes, Ref } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";

/** Badge text: 1–99, then "99+". Zero/unknown → no badge. */
export function badgeText(n: number | undefined | null): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return n > 99 ? "99+" : String(Math.floor(n));
}

/** 40 px square (44 px on phones), 8 px radius, hairline border. `bare` drops the border (sidebar / card corners). */
export function iconButtonClasses({ bare = false, size = "md", className }: { bare?: boolean; size?: "md" | "lg"; className?: string } = {}) {
  return cx(
    "relative inline-flex shrink-0 items-center justify-center rounded-ds-sm text-ds-text transition-colors duration-[var(--ds-dur)] ease-ds hover:bg-ds-raised",
    size === "lg" ? "size-11" : "size-11 lg:size-10",
    !bare && "border border-ds-line",
    FOCUS,
    className,
  );
}

function BadgeDot({ n, label }: { n: number | undefined | null; label: string }) {
  const t = badgeText(n);
  if (!t) return null;
  return (
    <span
      aria-hidden="true"
      className="ds-num absolute -right-1.5 -top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ds-accent px-1 text-[11px] font-bold leading-none text-ds-ink ring-2 ring-ds-bg"
      data-badge={label}
    >
      {t}
    </span>
  );
}

/** Accessible name including the count, e.g. "Inbox, 3 waiting". */
export function labelWithCount(label: string, n: number | undefined | null, noun = "new"): string {
  const t = badgeText(n);
  return t ? `${label}, ${t} ${noun}` : label;
}

export type IconButtonProps = {
  icon: IconName;
  /** Accessible name (also the tooltip title). The badge count is appended for screen readers. */
  label: string;
  badge?: number | null;
  /** Word after the count in the accessible name ("3 waiting"). */
  badgeNoun?: string;
  bare?: boolean;
  size?: "md" | "lg";
  ref?: Ref<HTMLButtonElement>;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label">;

/** Icon-only button with an optional count badge. Server- and client-safe (no hooks). */
export function IconButton({ icon, label, badge, badgeNoun, bare, size, className, type = "button", ref, ...rest }: IconButtonProps) {
  return (
    <button ref={ref} type={type} aria-label={labelWithCount(label, badge, badgeNoun)} title={label} className={iconButtonClasses({ bare, size, className })} {...rest}>
      <Icon name={icon} size={20} />
      <BadgeDot n={badge} label={label} />
    </button>
  );
}

/** Same look as IconButton, as a link (e.g. the top-bar Inbox). */
export function IconLink({
  icon,
  label,
  href,
  badge,
  badgeNoun,
  bare,
  className,
}: {
  icon: IconName;
  label: string;
  href: string;
  badge?: number | null;
  badgeNoun?: string;
  bare?: boolean;
  className?: string;
}) {
  return (
    <Link href={href} aria-label={labelWithCount(label, badge, badgeNoun)} title={label} className={iconButtonClasses({ bare, className })}>
      <Icon name={icon} size={20} />
      <BadgeDot n={badge} label={label} />
    </Link>
  );
}
