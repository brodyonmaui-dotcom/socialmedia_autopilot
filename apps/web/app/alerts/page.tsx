import Link from "next/link";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { ACK_WINDOW_DAYS, countByKind, kindLabel, listAlerts, parseKind, parseState, type AlertState } from "../../lib/alerts/queries.js";
import { relativeTime } from "../../lib/engagement/queries.js";
import { countActiveSubscriptions } from "../../lib/push/subscriptions.js";
import { AckAllSheet } from "./ui/AckAllSheet.js";
import { AlertCard } from "./ui/AlertCard.js";
import { EnablePush } from "./ui/EnablePush.js";
import { isVapidPublicKey } from "./ui/push-client.js";
import { KindChips, alertsHref } from "./ui/KindChips.js";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Tabs({ current, open }: { current: AlertState; open: number }) {
  const tabs: Array<[AlertState, string]> = [
    ["open", `Open ${open}`],
    ["acknowledged", "Acknowledged"],
  ];
  return (
    <nav className="mt-2 grid grid-cols-2 gap-1">
      {tabs.map(([key, label]) => (
        <Link
          key={key}
          href={alertsHref(key)}
          className={`inline-flex min-h-11 items-center justify-center rounded-lg px-1 text-[15px] ${key === current ? "bg-neutral-900 font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900" : "border border-neutral-300 dark:border-neutral-700"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export default async function AlertsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const state = parseState(sp.state);
  const kind = parseKind(sp.kind); // unknown value → unfiltered
  const pool = getPool();
  const now = new Date();
  const [counts, openCounts, alerts, devices] = await Promise.all([
    countByKind(pool, state, now),
    state === "open" ? null : countByKind(pool, "open", now),
    listAlerts(pool, { state, kind, now }),
    countActiveSubscriptions(pool),
  ]);
  // Runtime env (not NEXT_PUBLIC_*): the public key is safe to send; the private key never leaves the worker.
  const vapid = process.env.VAPID_PUBLIC_KEY?.trim();
  const openTotal = Object.values(openCounts ?? counts).reduce((a, n) => a + (n ?? 0), 0);

  return (
    <main className="mx-auto max-w-md p-4 pb-16 text-base">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Alerts</h1>
        <Link href="/" className="inline-flex min-h-11 items-center text-neutral-500 underline">
          dashboard
        </Link>
      </div>
      <Tabs current={state} open={openTotal} />
      {state === "acknowledged" ? <p className="mt-2 text-sm text-neutral-500">Acknowledged in the last {ACK_WINDOW_DAYS} days.</p> : null}
      <KindChips state={state} current={kind} counts={counts} />

      {state === "open" ? <AckAllSheet ids={alerts.map((a) => a.id)} scope={kind ? `All open “${kindLabel(kind)}” alerts on this page` : "All open alerts on this page"} /> : null}

      {alerts.length === 0 ? (
        <p className="mt-6 text-neutral-500">{state === "open" ? "No open alerts. Anything that needs you shows up here." : "Nothing acknowledged recently."}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {alerts.map((a) => (
            <AlertCard key={a.id} alert={a} when={relativeTime(a.createdAt, now)} ackWhen={a.acknowledgedAt ? relativeTime(a.acknowledgedAt, now) : undefined} />
          ))}
        </ul>
      )}

      <EnablePush vapidPublicKey={isVapidPublicKey(vapid) ? vapid : null} activeCount={devices} />
    </main>
  );
}
