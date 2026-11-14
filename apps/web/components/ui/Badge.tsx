import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";

export type BadgeTone = "neutral" | "accent" | "warn" | "danger" | "solid";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "border border-ds-line-strong text-ds-text",
  accent: "border border-ds-accent bg-ds-accent text-ds-ink",
  warn: "border border-ds-warn text-ds-warn",
  danger: "border border-ds-danger text-ds-danger",
  solid: "border border-ds-invert bg-ds-invert text-ds-on-invert",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; children: ReactNode };

/** Small status pill (rounded-full is allowed on badges). Warn and danger always carry the alert icon (status is never colour alone). */
export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps) {
  const alert = tone === "warn" || tone === "danger";
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 ds-caps text-[10px] leading-none ds-num",
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

export type ChipProps = HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone; icon?: IconName; children: ReactNode };

/** Sharp 1px-line tag (warnings, hashtags, platform). Warn/danger default to the alert icon. */
export function Chip({ tone = "neutral", icon, className, children, ...rest }: ChipProps) {
  const shown: IconName | undefined = icon ?? (tone === "warn" || tone === "danger" ? "alert" : undefined);
  return (
    <span
      className={cx(
        "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap border bg-ds-card px-3 text-[13px] leading-none",
        CHIP_TONE[tone],
        className,
      )}
      {...rest}
    >
      {shown && <Icon name={shown} size={14} />}
      {children}
    </span>
  );
}
