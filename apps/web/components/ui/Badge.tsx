import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";

export type BadgeTone = "neutral" | "accent" | "warn" | "danger" | "solid";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "border border-ds-line bg-ds-raised text-ds-text",
  accent: "border border-ds-accent bg-ds-accent text-ds-ink",
  warn: "border border-ds-warn/60 text-ds-warn",
  danger: "border border-ds-danger/60 text-ds-danger",
  solid: "border border-ds-invert bg-ds-invert text-ds-on-invert",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; children: ReactNode };

/** Small status pill (rounded-full is allowed on badges). Warn and danger always carry the alert icon (status is never colour alone). */
export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps) {
  const alert = tone === "warn" || tone === "danger";
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold leading-none ds-num",
        BADGE_TONE[tone],
        className,
      )}
      {...rest}
    >
      {alert && <Icon name="alert" size={12} strokeWidth={2} />}
      {children}
    </span>
  );
}

export type ChipTone = "neutral" | "accent" | "warn" | "danger";

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "border-ds-line text-ds-text",
  accent: "border-ds-accent text-ds-accent-fg",
  warn: "border-ds-warn/60 text-ds-warn",
  danger: "border-ds-danger/60 text-ds-danger",
};

export type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: ChipTone;
  icon?: IconName;
  /** Sentence-length chip: wraps onto more lines (min 32 px tall, icon top-aligned) instead of nowrap. */
  wrap?: boolean;
  /** `sm`: a quiet 24 px tag for dense grids (library cards); 12 px text, no icon unless given. */
  size?: "md" | "sm";
  children: ReactNode;
};

/** 8 px-radius hairline tag (warnings, triage reason, "No sound yet"). Warn/danger default to the alert icon. */
export function Chip({ tone = "neutral", icon, wrap = false, size = "md", className, children, ...rest }: ChipProps) {
  const shown: IconName | undefined = icon ?? (tone === "warn" || tone === "danger" ? "alert" : undefined);
  const sm = size === "sm" && !wrap;
  return (
    <span
      className={cx(
        "inline-flex rounded-ds-sm border bg-ds-card",
        sm ? "h-6 max-w-full gap-1 px-2 text-[12px]" : "gap-1.5 px-2.5 text-[13px]",
        wrap ? "min-h-8 max-w-full items-start py-[8px] leading-[16px] [overflow-wrap:anywhere]" : cx(sm ? "min-w-0" : "h-8 shrink-0", "items-center whitespace-nowrap leading-none"),
        CHIP_TONE[tone],
        className,
      )}
      {...rest}
    >
      {shown && <Icon name={shown} size={sm ? 12 : 14} className={wrap ? "mt-px shrink-0" : "shrink-0"} />}
      {wrap ? <span className="min-w-0">{children}</span> : sm ? <span className="min-w-0 overflow-hidden text-ellipsis">{children}</span> : children}
    </span>
  );
}

/**
 * Filter chip as a link (URL filters such as "From creators"). 44 px tall on phones, 36 px from lg; the
 * current one is a raised well with an ink hairline and aria-current. Optional tabular count.
 */
export function ChipLink({ href, current = false, count, className, children }: { href: string; current?: boolean; count?: number; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(
        "inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ds-sm border px-3 text-[14px] font-semibold transition-colors duration-[var(--ds-dur)] ease-ds lg:h-9",
        current ? "border-ds-text bg-ds-raised text-ds-text" : "border-ds-line bg-ds-card text-ds-muted hover:bg-ds-raised hover:text-ds-text",
        FOCUS,
        className,
      )}
    >
      {children}
      {count !== undefined && <span className="ds-num font-normal">{count}</span>}
    </Link>
  );
}
