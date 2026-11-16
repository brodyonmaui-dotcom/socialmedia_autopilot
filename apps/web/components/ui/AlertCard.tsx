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

/** "Attention" card (v3): warn icon + label, short body, optional small action. `tone` is a v2 leftover (both look the same). */
export function AlertCard({ title, children, action, live = false, className }: AlertCardProps) {
  return (
    <div
      role={live ? "alert" : undefined}
      className={cx(
        "flex flex-col gap-3 rounded-ds-lg border border-ds-line bg-ds-card p-4 text-ds-text sm:flex-row sm:items-center sm:justify-between lg:p-5",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 ds-caps">
          <Icon name="alert" size={16} className="text-ds-warn" />
          {title}
        </p>
        {children && (
          <div className="mt-1.5 text-[15px] leading-snug text-ds-muted">{children}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
