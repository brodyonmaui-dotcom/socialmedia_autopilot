import Link from "next/link";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";
import { PgBatchStore } from "../../lib/batches/pg-store.js";
import { weekLabel, summaryCounts } from "../../lib/batches/view-model.js";
import { Banner, StatusPill } from "./ui/WarningChip.js";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BatchesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error.slice(0, 200) : undefined;
  const batches = await new PgBatchStore(getPool()).listBatches(30);

  return (
    <main className="mx-auto max-w-2xl p-4 text-base">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Batches</h1>
        <Link href="/" className="inline-flex min-h-11 items-center text-neutral-500 underline">
          dashboard
        </Link>
      </div>
      <Banner kind="error" text={error} />
      {batches.length === 0 ? (
        <p className="mt-4 text-neutral-500">No batches yet. Draft one with the weekly-batch skill in a Claude Code session.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {batches.map((b) => {
            const c = summaryCounts(b.counts);
            return (
              <li key={b.id}>
                <Link
                  href={`/batches/${b.id}`}
                  className="block min-h-11 rounded-xl border border-neutral-200 p-3 active:bg-neutral-50 dark:border-neutral-800 dark:active:bg-neutral-900"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Week of {weekLabel(b.weekStart, new Date())}</span>
                    <StatusPill status={b.status} />
                  </div>
                  <div className="mt-1 text-sm text-neutral-500">
                    {c.draft} draft · {c.approved} approved · {c.published} published · {c.rejected} rejected
                    {c.other ? ` · ${c.other} other` : ""}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
