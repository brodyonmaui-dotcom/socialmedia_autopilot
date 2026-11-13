import Link from "next/link";
import { getPool } from "../../lib/db.js";
import { requireSession } from "../../lib/auth/require.js";

interface MediaRow {
  id: string;
  pillar: string | null;
  duration_s: string | null;
  qa: { warnings?: string[] } | null;
  source_path: string;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export const dynamic = "force-dynamic";

/** Media with ed-qa warnings — flagged for a human look before it goes into a batch, not auto-fixed. */
export default async function TouchUpQueuePage() {
  await requireSession();
  const pool = getPool();
  const { rows } = (await pool.query(
    `select id, pillar, duration_s, qa, source_path from media
     where status = 'ready' and jsonb_array_length(coalesce(qa->'warnings', '[]'::jsonb)) > 0
     order by jsonb_array_length(qa->'warnings') desc, created_at desc
     limit 500`,
  )) as { rows: MediaRow[] };

  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Touch-up queue</h1>
        <Link href="/library" className="text-sm text-neutral-500 underline">
          library
        </Link>
      </div>
      <p className="mt-1 text-sm text-neutral-500">{rows.length} clip(s) with ed-qa warnings — nothing here was auto-fixed.</p>
      <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {rows.map((row) => (
          <li key={row.id} className="p-3 text-sm">
            <div className="font-medium">{basename(row.source_path)}</div>
            <div className="text-neutral-500">
              {row.pillar ?? "—"} · {Number(row.duration_s ?? 0).toFixed(0)}s
            </div>
            <ul className="mt-1 list-inside list-disc text-amber-600 dark:text-amber-400">
              {(row.qa?.warnings ?? []).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </main>
  );
}
