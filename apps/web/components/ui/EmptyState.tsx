import type { ReactNode } from "react";
import { cx } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";

export interface EmptyStateProps {
  icon: IconName;
  /** What this is. */
  title: string;
  /** What happens next. */
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cx("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}>
      <span className="flex size-16 items-center justify-center border border-ds-line text-ds-accent-fg">
        <Icon name={icon} size={28} />
      </span>
      <p className="text-[20px] font-bold leading-tight tracking-[-0.02em] text-ds-text">{title}</p>
      {body && <div className="max-w-xs text-[15px] leading-snug text-ds-muted">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
