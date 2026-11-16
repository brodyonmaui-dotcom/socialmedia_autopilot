import type { ReactNode } from "react";
import { acknowledgeAction } from "../app/alerts/actions.js";
import { logoutAction } from "../app/login/actions.js";
import { kindLabel, listAlerts, type AlertView } from "../lib/alerts/queries.js";
import { isUrgent, shownMessage } from "../lib/alerts/view.js";
import { getPool } from "../lib/db.js";
import { relativeTime } from "../lib/engagement/queries.js";
import { activeState, badgeOf, inboxBadge, sidebarNav, type FrameCounts } from "./app-nav.js";
import { loadFrameCounts } from "./frame-counts.js";
import { AppShell, type NotificationItem } from "./ui/index.js";
import { getTheme } from "./ui/theme-server.js";

export type { FrameCounts } from "./app-nav.js";
/** What a page passes as `active`: a v3 nav id ("home", "calendar", "analytics/youtube", "library/touch-up", "platforms/snapchat", "settings", "notifications"…) or a v2 id (mapped). */
export type Section = string;

/** Pop-over rows from open alerts (newest first). Pure. */
export function notificationItems(alerts: AlertView[], now: Date): NotificationItem[] {
  return alerts.map((a) => ({
    id: a.id,
    kind: kindLabel(a.kind) ?? a.kind,
    message: shownMessage(a.message),
    age: relativeTime(a.createdAt, now),
    urgent: isUrgent(a.kind),
  }));
}

/**
 * The frame every signed-in page uses: the v3 AppShell (top bar + sidebar + main) with the real nav,
 * badge counts and the newest open alerts. Pages still call requireSession() themselves first.
 *
 * - `active`: the nav id of the page (see Section).
 * - `counts`: pass them if the page already queried them, to skip the frame's own count queries.
 * - `footer`, `cta`: v2 props, ignored (v3 has no footer band and no header CTA).
 */
export async function AppFrame({
  active,
  children,
  counts,
}: {
  active: Section;
  children: ReactNode;
  footer?: ReactNode;
  cta?: { href: string; label: string };
  counts?: FrameCounts;
}) {
  const pool = getPool();
  const now = new Date();
  const [theme, c, alerts] = await Promise.all([
    getTheme(),
    counts ? Promise.resolve(counts) : loadFrameCounts(pool),
    listAlerts(pool, { state: "open", now, limit: 6 }).catch(() => [] as AlertView[]),
  ]);
  const nav = sidebarNav(c);
  const state = activeState(nav, active);
  return (
    <AppShell
      theme={theme}
      nav={nav}
      currentHref={state.linkHref}
      openGroups={state.openGroups}
      inboxCount={inboxBadge(c)}
      notifications={notificationItems(alerts, now)}
      openAlerts={badgeOf(c.openAlerts) ?? 0}
      ackAction={acknowledgeAction}
      logoutAction={logoutAction}
    >
      {children}
    </AppShell>
  );
}
