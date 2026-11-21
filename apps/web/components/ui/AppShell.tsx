import Link from "next/link";
import type { ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";
import { IconLink } from "./IconButton.js";
import { NotificationsPopover, type NotificationItem } from "./NotificationsPopover.js";
import { Wordmark } from "./PageHeader.js";
import { MenuButton, Sidebar, SidebarProvider, type SidebarEntry } from "./Sidebar.js";
import type { Theme } from "./theme.js";

type Action = (fd: FormData) => void | Promise<void>;

/**
 * The v3 top bar (56 px, sticky, page colour, hairline below). Left: menu button + "My Socials" (Home).
 * Right: two icon buttons: Inbox (badge), Notifications (badge).
 */
export function TopBar({
  inboxCount,
  notifications,
  openAlerts,
  ackAction,
}: {
  inboxCount?: number;
  notifications: NotificationItem[];
  openAlerts: number;
  ackAction: Action;
}) {
  return (
    <header className="sticky top-0 z-40 h-[var(--ds-topbar-h)] border-b border-ds-line bg-ds-bg">
      <div className="flex h-full items-center gap-1 px-[var(--ds-gutter)]">
        <MenuButton className="-ml-2.5" />
        <Link href="/" className={cx("rounded-ds-sm px-1 py-1", FOCUS)} aria-label="My Socials, home">
          <Wordmark />
        </Link>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <IconLink href="/inbox" icon="inbox" label="Inbox" badge={inboxCount} badgeNoun="waiting" />
          <NotificationsPopover items={notifications} openCount={openAlerts} ackAction={ackAction} />
        </div>
      </div>
    </header>
  );
}

/**
 * Page frame (v3): `.ds-root` + skip link + TopBar + Sidebar (overlay) + `<main id="main">` holding a
 * centred 1280 px content column with the page gutter. No tab bar, grid lines, noise or footer band.
 */
export function AppShell({
  theme = "light",
  nav,
  currentHref,
  openGroups,
  inboxCount,
  notifications,
  openAlerts,
  ackAction,
  logoutAction,
  children,
}: {
  theme?: Theme;
  nav: SidebarEntry[];
  currentHref: string | null;
  openGroups: string[];
  inboxCount?: number;
  notifications: NotificationItem[];
  openAlerts: number;
  ackAction: Action;
  logoutAction: Action;
  children: ReactNode;
}) {
  return (
    <div className="ds-root relative min-h-dvh overflow-x-clip" data-theme={theme}>
      <a
        href="#main"
        className={cx(
          "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-[80] focus:rounded-ds-sm focus:bg-ds-invert focus:px-4 focus:py-3 focus:font-semibold focus:text-ds-on-invert",
          FOCUS,
        )}
      >
        Skip to content
      </a>
      <SidebarProvider>
        <TopBar inboxCount={inboxCount} notifications={notifications} openAlerts={openAlerts} ackAction={ackAction} />
        <Sidebar nav={nav} currentHref={currentHref} openGroups={openGroups} logoutAction={logoutAction} />
      </SidebarProvider>
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="mx-auto w-full max-w-[var(--ds-max)] px-[var(--ds-gutter)] pb-16">{children}</div>
      </main>
    </div>
  );
}
