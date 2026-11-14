import type { ReactNode } from "react";
import { cx } from "./cx.js";

/** Sharp frosted panel for overlays on images: caps title left, optional mono code (e.g. "ID 0047") right. */
export function GlassCard({
  title,
  code,
  children,
  className,
}: {
  title?: string;
  code?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("border border-ds-line bg-ds-card/60 p-4 backdrop-blur-md", className)}>
      {(title || code) && (
        <div className="mb-3 flex items-baseline justify-between gap-4">
          {title && <p className="ds-caps text-ds-text">{title}</p>}
          {code && <p className="ds-mono ml-auto text-ds-muted">{code}</p>}
        </div>
      )}
      {children}
    </div>
  );
}
