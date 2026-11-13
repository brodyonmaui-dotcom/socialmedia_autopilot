import Link from "next/link";
import type { NavItem } from "./AppShell.js";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";

/** Phone/tablet bottom navigation (first 5 nav items), hidden at ≥1024px. */
export function TabBar({ nav, active }: { nav: NavItem[]; active: string }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ds-text bg-ds-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-5 divide-x divide-ds-line">
        {nav.slice(0, 5).map((item) => {
          const isActive = item.id === active;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cx(
                  "relative flex h-16 flex-col items-center justify-center gap-1.5",
                  isActive ? "font-bold text-ds-text" : "text-ds-muted hover:text-ds-text",
                  FOCUS,
                )}
              >
                {isActive && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-ds-accent" />}
                <span className="relative">
                  <Icon name={item.icon} size={20} />
                  {item.badge != null && item.badge > 0 && (
                    <span className="ds-num absolute -right-3 -top-1.5 min-w-4 rounded-full bg-ds-accent px-1 text-center text-[10px] font-bold leading-4 text-ds-ink">
                      {item.badge}
                      <span className="sr-only"> new</span>
                    </span>
                  )}
                </span>
                <span className="ds-caps text-[10px]!">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
