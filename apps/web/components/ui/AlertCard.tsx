import type { ReactNode } from "react";
import { cx } from "./cx.js";
import { Icon } from "./Icon.js";

export interface AlertCardProps {
  tone?: "dark" | "light";
  title: string;
  children?: ReactNode;
  /** Usually <Button size="sm">. In the dark (inverted) band use variant="accent" or "white": a solid button would vanish into it. */
  action?: ReactNode;
  /** Adds role="alert" so screen readers announce it on render. Use for new, urgent banners only. */
  live?: boolean;
  className?: string;
}

/** "Attention" banner (sharp, 1px line): ⚠ + caps title, short body, optional small action. Dark = inverted band. */
export function AlertCard({ tone = "dark", title, children, action, live = false, className }: AlertCardProps) {
  const light = tone === "light";
  return (
    <div
      role={live ? "alert" : undefined}
      className={cx(
        "flex flex-col gap-3 border p-5 sm:flex-row sm:items-center sm:justify-between",
        light ? "border-ds-line bg-ds-card text-ds-text" : "border-ds-invert bg-ds-invert text-ds-on-invert",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 ds-caps">
          <Icon name="alert" size={16} strokeWidth={2} className={light ? "text-ds-warn" : "text-ds-accent"} />
          {title}
        </p>
        {children && (
          <div className={cx("mt-1.5 text-[15px] leading-snug", light ? "text-ds-muted" : "text-ds-on-invert/80")}>{children}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
