import Link from "next/link";
import { cx, FOCUS } from "./cx.js";
import { TAB_BAR, tabSegment, TabCount } from "./tab-styles.js";

/** Client tabs (role=tablist, arrow keys) live in TabsClient.tsx so this module stays a server module. */
export { Tabs, type TabItem, type TabsProps } from "./TabsClient.js";

export interface TabLinkItem {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}

/** URL tabs (server): a nav of Links, the active one marked aria-current="page". */
export function TabLinks({ items, ariaLabel, className }: { items: TabLinkItem[]; ariaLabel: string; className?: string }) {
  return (
    <nav aria-label={ariaLabel} className={cx(TAB_BAR, className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cx(tabSegment(item.active), FOCUS, "focus-visible:-outline-offset-4")}
        >
          {item.label}
          {item.count !== undefined && <TabCount count={item.count} />}
        </Link>
      ))}
    </nav>
  );
}
