import Link from "next/link";
import { CAPABILITIES } from "@autopilot/core";
import { getPool } from "../lib/db.js";
import { requireSession } from "../lib/auth/require.js";
import { logoutAction, logoutEverywhereAction } from "./login/actions.js";
import { handoffContext, listHandoff } from "../lib/handoff/store.js";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireSession();
  const pool = getPool();
  const [batchRows, alertRows, flaggedRows] = await Promise.all([
    pool.query("select status, count(*)::int as n from batches group by status"),
    pool.query("select count(*)::int as n from alerts where acknowledged_at is null"),
    pool.query("select count(*)::int as n from comment_triage where bucket in ('flag', 'hide_flag') and handled_at is null"),
  ]);
  const flagged = (flaggedRows.rows[0]?.n as number | undefined) ?? 0;
  const batchCount = (s: string) => (batchRows.rows as Array<{ status: string; n: number }>).find((r) => r.status === s)?.n ?? 0;
  const openAlerts = (alertRows.rows[0]?.n as number | undefined) ?? 0;
  const platforms = Object.entries(CAPABILITIES);
  // F10: Snapchat items due today (null when TZ_CREATOR is unset: no guessing "today").
  const snapCtx = handoffContext();
  const snapToday = snapCtx.timeZone ? (await listHandoff(pool, new Date(), snapCtx.timeZone, snapCtx.blocklist)).today.length : null;

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-xl font-semibold">autopilot</h1>

      <Link
        href="/batches"
        className="mt-4 flex min-h-11 items-center justify-between rounded-xl border border-neutral-200 p-3 text-base dark:border-neutral-800"
      >
        <span className="font-semibold">Batches</span>
        <span className="text-neutral-500">
          {batchCount("draft")} draft · {batchCount("approved")} approved
        </span>
      </Link>
      <Link
        href="/inbox"
        className="mt-2 flex min-h-11 items-center justify-between rounded-xl border border-neutral-200 p-3 text-base dark:border-neutral-800"
      >
        <span className="font-semibold">Inbox</span>
        <span className={flagged ? "font-medium text-red-700 dark:text-red-300" : "text-neutral-500"}>{flagged} flagged</span>
      </Link>
      <Link
        href="/handoff"
        className="mt-2 flex min-h-11 items-center justify-between rounded-xl border border-neutral-200 p-3 text-base dark:border-neutral-800"
      >
        <span className="font-semibold">Snapchat</span>
        <span className={snapToday ? "font-medium text-amber-800 dark:text-amber-300" : "text-neutral-500"}>
          {snapToday === null ? "TZ_CREATOR not set" : `${snapToday} to share today`}
        </span>
      </Link>
      <p className={`mt-2 text-sm ${openAlerts ? "font-medium text-red-700 dark:text-red-300" : "text-neutral-500"}`}>
        {openAlerts} open alert{openAlerts === 1 ? "" : "s"}
      </p>

      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <Link href="/library" className="underline">
          library
        </Link>
        <Link href="/touch-up" className="underline">
          touch-up queue
        </Link>
        <Link href="/research" className="underline">
          research
        </Link>
        <Link href="/analytics" className="underline">
          analytics
        </Link>
      </div>
      <ul className="mt-6 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {platforms.map(([platform, cap]) => (
          <li key={platform} className="flex items-center justify-between p-3 text-sm">
            <span className="font-medium capitalize">{platform}</span>
            <span className="text-neutral-500">{cap.route}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8 space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <form action={logoutAction}>
          <button className="min-h-11 rounded-lg border border-neutral-300 px-4 text-base dark:border-neutral-700">Log out</button>
        </form>
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-neutral-500">Lost a phone?</summary>
          <p className="mt-1 text-sm text-neutral-500">
            Signs out every device and revokes every passkey. You&apos;ll need to re-enrol on the server afterwards.
          </p>
          <form action={logoutEverywhereAction} className="mt-2">
            <button className="min-h-11 rounded-lg border border-red-300 px-4 text-base text-red-700 dark:border-red-800 dark:text-red-300">
              Log out everywhere
            </button>
          </form>
        </details>
      </div>
    </main>
  );
}
