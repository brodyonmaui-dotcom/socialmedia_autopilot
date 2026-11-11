import Link from "next/link";
import { getPool } from "../../lib/db.js";
import { sourceFileStatus } from "./file-status.js";

interface MediaRow {
  id: string;
  pillar: string | null;
  duration_s: string | null;
  width: number | null;
  height: number | null;
  status: string;
  qa: { warnings?: string[] } | null;
  source_path: string;
  created_at: string;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export const dynamic = "force-dynamic"; // always reflect the latest ingest, never cache stale library state

export default async function LibraryPage() {
  const pool = getPool();
  const { rows } = (await pool.query(
    "select id, pillar, duration_s, width, height, status, qa, source_path, created_at from media order by created_at desc limit 500",
  )) as { rows: MediaRow[] };
  const fileStatus = new Map(rows.map((r) => [r.id, sourceFileStatus(r.source_path)]));
  const missing = [...fileStatus.values()].filter((s) => s === "missing").length;

  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Library</h1>
        <Link href="/" className="text-sm text-neutral-500 underline">
          dashboard
        </Link>
      </div>
      <p className="mt-1 text-sm text-neutral-500">{rows.length} ingested clip(s).
        {missing > 0 && ` ${missing} source file(s) missing on this machine (R2 copy kept).`}
      </p>
      <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {rows.map((row) => {
          const warnings = row.qa?.warnings ?? [];
          return (
            <li key={row.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{basename(row.source_path)}</div>
                <div className="text-neutral-500">
                  {row.pillar ?? "—"} · {Number(row.duration_s ?? 0).toFixed(0)}s · {row.width}×{row.height}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">{row.status}</span>
                {fileStatus.get(row.id) === "missing" && (
                  <span
                    className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
                    title="The original file is no longer at its source path. The cleaned copy in R2 is kept."
                  >
                    file missing
                  </span>
                )}
                {warnings.length > 0 && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    {warnings.length} warning{warnings.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
