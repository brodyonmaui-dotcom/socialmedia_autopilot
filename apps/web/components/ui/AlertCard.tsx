import type { ReactNode } from "react";
import { cx } from "./cx.js";
import { Icon } from "./Icon.js";

export interface AlertCardProps {
  tone?: "dark" | "light";
  title: string;
  children?: ReactNode;
  /** Usually <Button size="sm">. */
  action?: ReactNode;
  /** Adds role="alert" so screen readers announce it on render. Use for new, urgent banners only. */
  live?: boolean;
  className?: string;
}

/** "Attention" banner: ⚠ + caps title, short body, optional small action. */
export function AlertCard({ tone = "dark", title, children, action, live = false, className }: AlertCardProps) {
  const light = tone === "light";
  return (
    <div
      role={live ? "alert" : undefined}
      className={cx(
        "flex flex-col gap-3 rounded-ds-lg p-5 sm:flex-row sm:items-center sm:justify-between",
        light ? "bg-ds-paper text-ds-ink ring-1 ring-ds-line" : "bg-ds-card ring-1 ring-ds-warn/30 shadow-ds-card",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 ds-caps font-bold">
          <Icon name="alert" size={16} strokeWidth={2} className={light ? "text-ds-accent-lo" : "text-ds-warn"} />
          {title}
        </p>
        {children && (
          <div className={cx("mt-1.5 text-[15px] leading-snug", light ? "text-ds-paper-muted" : "text-ds-muted")}>{children}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
