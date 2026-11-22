import type { ReactNode } from "react";
import { acknowledgeAction } from "../app/alerts/actions.js";
import { logoutAction } from "../app/login/actions.js";
import { kindLabel, listAlerts, sourceLabel, type AlertView } from "../lib/alerts/queries.js";
import { liveRows, type LiveRow } from "../lib/alerts/live.js";
import { describeAlert, isUrgent } from "../lib/alerts/view.js";
import { creatorZone } from "../lib/calendar/load.js";
import { loadInboxGroups } from "../lib/inbox/groups.js";
import { getPool } from "../lib/db.js";
import { relativeTime } from "../lib/engagement/queries.js";
import { activeState, badgeOf, inboxBadge, sidebarNav, type FrameCounts } from "./app-nav.js";
import { loadFrameCounts } from "./frame-counts.js";
import { AppShell, type NotificationItem } from "./ui/index.js";
import { getTheme } from "./ui/theme-server.js";

export type { FrameCounts } from "./app-nav.js";
/** What a page passes as `active`: a v3 nav id ("home", "calendar", "analytics/youtube", "library/touch-up", "platforms/snapchat", "settings", "notifications"…) or a v2 id (mapped). */
export type Section = string;

/**
 * Pop-over rows (F20): live Inbox rows first ("7 replies drafted to your Instagram comments"), then open
 * event alerts as F19 describes them. Each row links to its target; only events can be acknowledged. Pure.
 */
export function notificationItems(alerts: AlertView[], now: Date, live: LiveRow[] = [], timeZone = "UTC"): NotificationItem[] {
  const inbox: NotificationItem[] = live.map((r) => ({
    id: r.id,
    kind: sourceLabel(r.platform),
    message: r.title,
    age: r.at ? relativeTime(r.at, now) : "now",
    urgent: false,
    href: r.href,
    action: r.action,
    ackable: false,
  }));
  const events: NotificationItem[] = alerts.map((a) => {
    const link = describeAlert(a, now, timeZone).actions.find((x) => x.kind === "link");
    return {
      id: a.id,
      kind: kindLabel(a.kind) ?? a.kind,
      message: describeAlert(a, now, timeZone).title,
      age: relativeTime(a.createdAt, now),
      urgent: isUrgent(a.kind),
      href: link?.href ?? "/notifications",
      ...(link ? { action: link.label } : {}),
      ackable: true,
    };
  });
  return [...inbox, ...events];
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
  const [theme, c, alerts, groups] = await Promise.all([
    getTheme(),
    counts ? Promise.resolve(counts) : loadFrameCounts(pool),
    listAlerts(pool, { state: "open", now, limit: 6, excludeInbox: true }).catch(() => [] as AlertView[]),
    loadInboxGroups(pool).catch(() => []),
  ]);
  const live = liveRows(groups);
  const nav = sidebarNav(c);
  const state = activeState(nav, active);
  return (
    <AppShell
      theme={theme}
      nav={nav}
      currentHref={state.linkHref}
      openGroups={state.openGroups}
      inboxCount={inboxBadge(c)}
      notifications={notificationItems(alerts, now, live, creatorZone().timeZone)}
      openAlerts={live.length + (badgeOf(c.openAlerts) ?? 0)}
      ackAction={acknowledgeAction}
      logoutAction={logoutAction}
    >
      {children}
    </AppShell>
  );
}
