import Link from "next/link";
import type { ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon, type IconName } from "./Icon.js";
import { PlatformLogo, type Platform } from "./PlatformLogo.js";
import type { Theme } from "./theme.js";

export type NavItem = { id: string; label: string; href: string; icon: IconName; badge?: number };
export type AccountRow = { label: string; value: string; tone?: "accent" | "warn" | "muted"; href?: string; platform?: Platform };

const ACCOUNT_TONE: Record<NonNullable<AccountRow["tone"]>, string> = {
  accent: "text-ds-accent-fg",
  warn: "text-ds-warn",
  muted: "text-ds-muted",
};

/**
 * Page frame: 260px sidebar at ≥1024px, fixed bottom tab bar (first 5 nav items) below.
 * Adds `.ds-root`, a skip link and `<main id="main">`.
 */
export function AppShell({
  nav,
  active,
  accounts,
  primaryAction,
  brand = "runmysocials",
  theme = "dark",
  children,
}: {
  nav: NavItem[];
  active: string;
  accounts?: AccountRow[];
  primaryAction?: { href: string; label: string };
  brand?: string;
  /** From getTheme() (theme-server.ts); ThemeToggle flips it client-side. */
  theme?: Theme;
  children: ReactNode;
}) {
  return (
    <div className="ds-root min-h-dvh" data-theme={theme}>
      <a
        href="#main"
        className={cx(
          "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-ds-md focus:bg-ds-accent focus:px-4 focus:py-3 focus:font-bold focus:text-ds-ink",
          FOCUS,
        )}
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col bg-ds-frame px-5 pb-6 pt-8 lg:flex">
        <div className="px-4 text-[20px] tracking-[-0.01em] text-ds-text">{brand}</div>

        <nav aria-label="Primary" className="mt-8">
          <ul className="flex flex-col gap-1">
            {nav.map((item) => {
              const isActive = item.id === active;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cx(
                      "flex h-12 items-center gap-3 rounded-full px-4 transition-colors duration-[var(--ds-dur)] ease-ds",
                      isActive
                        ? "bg-ds-accent font-bold text-ds-ink shadow-ds-glow"
                        : "text-ds-muted hover:bg-ds-raised hover:text-ds-text",
                      FOCUS,
                    )}
                  >
                    <Icon name={item.icon} size={20} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge != null && item.badge > 0 && (
                      <span
                        className={cx(
                          "ds-num min-w-6 rounded-full px-2 text-center text-[13px] font-bold leading-6",
                          isActive ? "bg-ds-ink/15 text-ds-ink" : "bg-ds-raised text-ds-text",
                        )}
                      >
                        {item.badge}
                        <span className="sr-only"> new</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {accounts && accounts.length > 0 && (
          <section aria-labelledby="ds-accounts-label" className="mt-8">
            <h2 id="ds-accounts-label" className="ds-caps px-4 font-bold text-ds-faint">
              Accounts
            </h2>
            <ul className="mt-2 flex flex-col">
              {accounts.map((a) => {
                const inner = (
                  <>
                    {a.platform && <PlatformLogo platform={a.platform} size={18} className="shrink-0 text-ds-muted" />}
                    <span className="min-w-0 truncate text-ds-muted">{a.label}</span>
                    <span className={cx("ds-num shrink-0 text-[14px]", ACCOUNT_TONE[a.tone ?? "muted"])}>{a.value}</span>
                  </>
                );
                return (
                  <li key={a.label}>
                    {a.href ? (
                      <Link
                        href={a.href}
                        className={cx(
                          "flex min-h-11 items-center gap-2 rounded-full px-4 hover:bg-ds-raised",
                          FOCUS,
                        )}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex min-h-11 items-center gap-2 px-4">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {primaryAction && (
          <div className="mt-auto px-4 pt-6">
            <Link
              href={primaryAction.href}
              aria-label={primaryAction.label}
              title={primaryAction.label}
              className={cx(
                "inline-flex size-14 items-center justify-center rounded-ds-lg bg-ds-accent text-ds-ink shadow-ds-glow transition-colors duration-[var(--ds-dur-fast)] ease-ds hover:bg-ds-accent-hi",
                FOCUS,
              )}
            >
              <Icon name="plus" size={26} strokeWidth={2} />
            </Link>
          </div>
        )}
      </aside>

      {/* Content */}
      <div className="lg:pl-[260px]">
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto max-w-[1200px] px-4 pb-[calc(var(--ds-tabbar-h)+env(safe-area-inset-bottom)+16px)] outline-none lg:px-8 lg:pb-12"
        >
          {children}
        </main>
      </div>

      {/* Phone / tablet bottom tabs */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 h-[calc(var(--ds-tabbar-h)+env(safe-area-inset-bottom))] border-t border-ds-line bg-ds-frame/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="flex h-[var(--ds-tabbar-h)]">
          {nav.slice(0, 5).map((item) => {
            const isActive = item.id === active;
            return (
              <li key={item.id} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cx(
                    "relative flex h-full min-h-11 flex-col items-center justify-center gap-0.5 text-[13px] leading-tight",
                    isActive ? "font-bold text-ds-accent-fg" : "text-ds-faint hover:text-ds-muted",
                    FOCUS,
                  )}
                >
                  {isActive && (
                    <span aria-hidden="true" className="absolute inset-x-1/4 top-0 h-[3px] rounded-b-full bg-ds-accent" />
                  )}
                  <span className="relative">
                    <Icon name={item.icon} size={22} />
                    {item.badge != null && item.badge > 0 && (
                      <span className="ds-num absolute -right-3 -top-1.5 min-w-5 rounded-full bg-ds-accent px-1 text-center text-[13px] font-bold leading-5 text-ds-ink">
                        {item.badge}
                        <span className="sr-only"> new</span>
                      </span>
                    )}
                  </span>
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
