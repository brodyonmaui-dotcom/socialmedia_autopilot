import Link from "next/link";
import { AppFrame } from "../../components/AppFrame.js";
import { ButtonLink, Card, EmptyState, FOCUS, PageHeader, TabLinks, cx } from "../../components/ui/index.js";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { ACK_WINDOW_DAYS, countByKind, kindLabel, listAlerts, parseKind, parseState } from "../../lib/alerts/queries.js";
import { ackAllCopy, alertsHref, plural, stateTabs, total } from "../../lib/alerts/view.js";
import { relativeTime } from "../../lib/engagement/queries.js";
import { AckAllSheet } from "../../components/notifications/AckAllSheet.js";
import { AlertRow } from "../../components/notifications/AlertRow.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications · My Socials" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Notifications (replaces /alerts): Open / Acknowledged, one row per alert, Acknowledge all via confirm; push setup lives in Settings. */
export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const state = parseState(sp.state);
  const kind = parseKind(sp.kind); // unknown value → unfiltered
  const pool = getPool();
  const now = new Date();
  const [counts, openCounts, alerts] = await Promise.all([
    countByKind(pool, state, now),
    state === "open" ? null : countByKind(pool, "open", now),
    listAlerts(pool, { state, kind, now }),
  ]);
  const openTotal = total(openCounts ?? counts);
  // "Acknowledge all" sends exactly the ids rendered below (alerts that arrive later stay open).
  const shownIds = state === "open" ? alerts.map((a) => a.id) : [];
  const subtitle =
    state === "open"
      ? openTotal === 0
        ? "Nothing needs you right now."
        : `${plural(openTotal, "open alert")}. Acknowledging keeps them for ${ACK_WINDOW_DAYS} days; nothing is deleted.`
      : `Acknowledged in the last ${ACK_WINDOW_DAYS} days.`;

  return (
    <AppFrame active="notifications">
      <PageHeader title="Notifications" subtitle={subtitle} action={shownIds.length > 1 ? <AckAllSheet ids={shownIds} copy={ackAllCopy(shownIds.length, kind)} /> : undefined} />

      <div className="flex flex-col gap-3 lg:gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <TabLinks ariaLabel="Alert state" items={stateTabs(state, openTotal)} className="w-full sm:w-auto sm:min-w-80" />
          {kind ? (
            <ButtonLink href={alertsHref(state)} variant="ghost" size="sm">
              Showing {kindLabel(kind)} only · Show all
            </ButtonLink>
          ) : null}
        </div>

        <Card>
          {alerts.length === 0 ? (
            <EmptyState
              icon={state === "open" ? "check" : "bell"}
              title={state === "open" ? "You're all caught up" : "Nothing acknowledged recently"}
              body={state === "open" ? "Failed posts, token problems and anything else that needs you land here." : `Acknowledged alerts stay here for ${ACK_WINDOW_DAYS} days.`}
              action={
                state === "open" ? (
                  <ButtonLink href="/" variant="outline" size="sm">
                    Back to Home
                  </ButtonLink>
                ) : (
                  <ButtonLink href={alertsHref("open")} variant="outline" size="sm">
                    See open alerts
                  </ButtonLink>
                )
              }
              className="py-8"
            />
          ) : (
            <ol aria-label={state === "open" ? "Open alerts" : "Acknowledged alerts"} className="flex flex-col divide-y divide-ds-line">
              {alerts.map((a) => (
                <AlertRow key={a.id} alert={a} when={relativeTime(a.createdAt, now)} ackWhen={a.acknowledgedAt ? relativeTime(a.acknowledgedAt, now) : undefined} />
              ))}
            </ol>
          )}
        </Card>

        <p className="text-[15px] text-ds-muted">
          Phone notifications:{" "}
          <Link href="/settings#push" className={cx("inline-flex min-h-11 items-center rounded-ds-sm font-semibold text-ds-accent-fg underline-offset-4 hover:underline lg:min-h-9", FOCUS)}>
            Settings
          </Link>
        </p>
      </div>
    </AppFrame>
  );
}
