import type { ReactNode } from "react";
import { cx } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";

const TONE = {
  accent: "text-ds-accent-fg",
  neutral: "text-ds-text",
  warn: "text-ds-warn",
} as const;

/** KPI (v2): caps caption row with an 18px icon, then a big Inter 900 tabular number. No circle. */
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
      <div className="flex items-center gap-2 ds-caps text-ds-muted">
        <Icon name={icon} size={18} className={cx("shrink-0", TONE[tone])} />
        <span>{caption}</span>
      </div>
      <div className="ds-num text-[40px] font-black leading-none tracking-[-0.04em] text-ds-text">{value}</div>
    </div>
  );
}

/** Two StatTiles side by side. */
export function StatPair({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("grid grid-cols-2 gap-6", className)}>{children}</div>;
}
