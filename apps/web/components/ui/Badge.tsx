import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";

export type BadgeTone = "neutral" | "accent" | "warn" | "danger" | "solid";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-ds-raised text-ds-muted",
  accent: "bg-ds-accent/15 text-ds-accent-fg",
  warn: "bg-ds-warn/15 text-ds-warn",
  danger: "bg-ds-danger/15 text-ds-danger",
  solid: "bg-ds-accent text-ds-ink",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; children: ReactNode };

/** Small status pill. Warn and danger always carry the alert icon (status is never colour alone). */
export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps) {
  const alert = tone === "warn" || tone === "danger";
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[13px] font-bold leading-none ds-num",
        BADGE_TONE[tone],
        className,
      )}
      {...rest}
    >
      {alert && <Icon name="alert" size={13} strokeWidth={2} />}
      {children}
    </span>
  );
}

export type ChipTone = "neutral" | "accent" | "warn" | "danger";

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "bg-ds-raised text-ds-text",
  accent: "bg-ds-raised text-ds-accent-fg",
  warn: "bg-ds-raised text-ds-warn",
  danger: "bg-ds-raised text-ds-danger",
};

export type ChipProps = HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone; icon?: IconName; children: ReactNode };

/** Rounded rectangle tag (warnings, hashtags, platform). Warn/danger default to the alert icon. */
export function Chip({ tone = "neutral", icon, className, children, ...rest }: ChipProps) {
  const shown: IconName | undefined = icon ?? (tone === "warn" || tone === "danger" ? "alert" : undefined);
  return (
    <span
      className={cx(
        "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ds-sm px-3 text-[14px] leading-none",
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
