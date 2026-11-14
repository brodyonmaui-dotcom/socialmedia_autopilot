import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { TAB_BAR, TAB_GRID, tabGridCell, tabSegment, TabCount } from "./tab-styles.js";

/** Client tabs (role=tablist, arrow keys) live in TabsClient.tsx so this module stays a server module. */
export { Tabs, type TabItem, type TabsProps } from "./TabsClient.js";

export interface TabLinkItem {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}

/**
 * URL tabs (server): a nav of Links, the active one marked aria-current="page".
 * `layout="grid"` (F12/9): for filters with many or long labels. Cells wrap into 2 columns on phones
 * (an odd last cell spans both) and sit in one equal row from lg; 1px lines come from the gap.
 */
export function TabLinks({
  items,
  ariaLabel,
  className,
  layout = "strip",
}: {
  items: TabLinkItem[];
  ariaLabel: string;
  className?: string;
  layout?: "strip" | "grid";
}) {
  return (
    <nav aria-label={ariaLabel} className={cx(layout === "grid" ? TAB_GRID : TAB_BAR, className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cx(tabSegment(item.active), layout === "grid" && tabGridCell(item.active), FOCUS, "focus-visible:-outline-offset-4")}
        >
          {item.label}
          {item.count !== undefined && <TabCount count={item.count} />}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Segmented choice (F12/4): the TabLinks strip with real <button>s (aria-pressed) for settings such as a
 * mode switch. Each button does its own thing (a form submit, or opening a confirm Sheet).
 */
export function SegmentBar({ ariaLabel, className, children }: { ariaLabel: string; className?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={ariaLabel} className={cx(TAB_BAR, className)}>
      {children}
    </div>
  );
}

export function SegmentButton({ active, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="submit"
      aria-pressed={active}
      className={cx(tabSegment(active), FOCUS, "focus-visible:-outline-offset-4", className)}
      {...rest}
    />
  );
}
