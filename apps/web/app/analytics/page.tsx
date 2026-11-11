import Link from "next/link";
import { buildWeeklyReport, fmtInt, fmtPct, fmtX, loadPostRecords, syntheticPosts, type PostRecord } from "@autopilot/analytics";
import { firstLine } from "@autopilot/research";
import { getPool } from "../../lib/db.js";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Monday of the last complete week (UTC), same rule as the weekly-report skill. */
function lastCompleteWeek(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7);
  return d.toISOString().slice(0, 10);
}
const shiftWeek = (w: string, days: number) => new Date(Date.parse(w + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);

const NAME: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", snapchat: "Snapchat" };

const VERDICT = {
  share: { label: "share", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  wait: { label: "wait", cls: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" },
  "dont-share": { label: "don't share", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
} as const;

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const weekParam = typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : undefined;
  const week = weekParam ?? lastCompleteWeek(new Date());
  const demo = sp.demo === "1";

  let posts: PostRecord[];
  if (demo) posts = syntheticPosts({ weekStart: week });
  else posts = await loadPostRecords(getPool(), new Date(Date.parse(week + "T00:00:00Z") - 28 * 86_400_000));

  const r = buildWeeklyReport(posts, { weekStart: week, timeZone: process.env.TZ_CREATOR || "UTC", now: new Date() });
  const q = (w: string) => `/analytics?week=${w}${demo ? "&demo=1" : ""}`;

  return (
    <main className="mx-auto max-w-md p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Weekly report</h1>
        <Link href="/" className="text-sm text-neutral-500 underline">
          dashboard
        </Link>
      </div>
      <div className="mt-1 flex items-center justify-between text-sm text-neutral-500">
        <Link href={q(shiftWeek(week, -7))} className="underline">
          ← prev
        </Link>
        <span>
          {r.weekStart} → {shiftWeek(r.weekEnd, -1)}
        </span>
        <Link href={q(shiftWeek(week, 7))} className="underline">
          next →
        </Link>
      </div>
      {demo && (
        <p className="mt-3 rounded border border-amber-400 p-2 text-sm text-amber-700 dark:text-amber-300">
          Demo: invented numbers, not your account. <Link href={`/analytics?week=${week}`} className="underline">Real data</Link>
        </p>
      )}

      <section className="mt-4 space-y-2">
        {r.platforms.length === 0 && (
          <p className="text-sm text-neutral-500">
            No published posts with this week in range yet.{" "}
            {!demo && (
              <Link href={q(week) + "&demo=1"} className="underline">
                See a demo
              </Link>
            )}
          </p>
        )}
        {r.platforms.map((p) => (
          <div key={p.platform} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{NAME[p.platform] ?? p.platform}</span>
              <span className="text-neutral-500">
                {p.posts} post(s) · {fmtInt(p.views)} views {p.weekOverWeek !== null && `(${fmtX(p.weekOverWeek)} wk/wk)`}
              </span>
            </div>
            <ol className="mt-1 space-y-0.5 text-neutral-600 dark:text-neutral-400">
              {p.top.map((t) => (
                <li key={t.batchItemId} className="truncate">
                  {fmtInt(t.views)} · {fmtPct(t.er)} · {t.hook}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>

      <h2 className="mt-6 text-sm font-semibold">What worked (last 28 days)</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {r.recommendations.map((rec) => (
          <li key={rec.text} className="flex gap-2">
            <span className={rec.kind === "more" ? "text-emerald-600" : "text-amber-600"}>{rec.kind === "more" ? "▲" : "▼"}</span>
            <span>{rec.text}</span>
          </li>
        ))}
        {r.recommendations.length === 0 && <li className="text-neutral-500">Nothing stands out yet.</li>}
        {r.tooEarly.length > 0 && <li className="text-neutral-500">Too early to tell on {r.tooEarly.join(", ")}.</li>}
      </ul>
      <p className="mt-1 text-xs text-neutral-500">Sample sizes in brackets. Correlations, not causes.</p>

      <h2 className="mt-6 text-sm font-semibold">Trial reels</h2>
      <p className="text-xs text-neutral-500">You share these yourself in the Instagram app.</p>
      <ul className="mt-2 divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
        {r.trials.recommendations.map((t) => (
          <li key={t.batchItemId} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{firstLine(t.caption)}</span>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${VERDICT[t.verdict].cls}`}>{VERDICT[t.verdict].label}</span>
            </div>
            <div className="text-neutral-500">
              {t.ageHours} h · {fmtInt(t.views)} views · {t.reason}
            </div>
          </li>
        ))}
        {r.trials.recommendations.length === 0 && <li className="p-3 text-neutral-500">No unshared trial reels.</li>}
      </ul>

      {r.dataGaps.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold">Data gaps</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-neutral-500">
            {r.dataGaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
