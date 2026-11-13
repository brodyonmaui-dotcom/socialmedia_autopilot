import type { ReactNode } from "react";
import { cx } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";

const TONE = {
  accent: "text-ds-accent-fg",
  neutral: "text-ds-text",
  warn: "text-ds-warn",
} as const;

/** KPI: round icon, big tabular number, muted caption. */
export function StatTile({
  icon,
  value,
  caption,
  tone = "accent",
}: {
  icon: IconName;
  value: string | number;
  caption: string;
  tone?: "accent" | "neutral" | "warn";
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <span className={cx("inline-flex size-10 items-center justify-center rounded-full bg-ds-raised", TONE[tone])}>
        <Icon name={icon} size={20} />
      </span>
      <div>
        <div className="ds-num text-[30px] font-normal leading-none tracking-[-0.01em]">{value}</div>
        <div className="mt-1.5 text-[15px] leading-[1.35] text-ds-muted">{caption}</div>
      </div>
    </div>
  );
}

/** Two StatTiles side by side. */
export function StatPair({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("grid grid-cols-2 gap-4", className)}>{children}</div>;
}
