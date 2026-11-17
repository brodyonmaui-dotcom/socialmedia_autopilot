// Touch-up: re-run QA v2 on clips whose stored QA predates it (loose warning strings that can't be trusted).
// Low rate: at most 5 clips per tick, every 10 minutes, from the clean file in R2. Only media.qa and
// media.qa_checked_at change; the file, status and every other column are left alone.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasBinary, runQa } from "@autopilot/media";
import type PgBoss from "pg-boss";
import type { MediaStorage, Queryable } from "./media-fix.js";

export const MEDIA_RECHECK_QUEUE = "media-recheck";
export const RECHECK_PER_TICK = 5;

export interface MediaRecheckDeps {
  db: Queryable;
  storage: MediaStorage | null;
  hasFfmpeg?: () => Promise<boolean>;
  limit?: number;
  tmpDir?: () => string;
  /** Tests only: consider only these media ids. */
  onlyMediaIds?: string[];
}

export interface RecheckSummary {
  checked: number;
  failed: number;
  skipped: "no-storage" | "no-ffmpeg" | null;
}

/** Legacy = no v2 result yet. Rows that failed before go to the back (qa_checked_at is stamped on failure too). */
export async function runMediaRecheckOnce(d: MediaRecheckDeps): Promise<RecheckSummary> {
  if (!d.storage) return { checked: 0, failed: 0, skipped: "no-storage" };
  if (!(await (d.hasFfmpeg ?? (() => hasBinary("ffmpeg")))())) return { checked: 0, failed: 0, skipped: "no-ffmpeg" };
  const { rows } = await d.db.query(
    `select id, r2_key from media
      where r2_key is not null and r2_key like 'library/%'
        and (qa is null or qa->>'version' is distinct from '2')
        and ($2::uuid[] is null or id = any($2))
      order by qa_checked_at asc nulls first, created_at desc
      limit $1`,
    [Math.min(d.limit ?? RECHECK_PER_TICK, RECHECK_PER_TICK), d.onlyMediaIds ?? null],
  );
  const s: RecheckSummary = { checked: 0, failed: 0, skipped: null };
  for (const row of rows as Array<{ id: string; r2_key: string }>) {
    const tmp = (d.tmpDir ?? (() => mkdtempSync(join(tmpdir(), "autopilot-recheck-"))))();
    try {
      const file = join(tmp, "clip.mp4");
      await d.storage.download(row.r2_key, file);
      const qa = await runQa(file);
      await d.db.query("update media set qa = $2::jsonb, qa_checked_at = now(), updated_at = now() where id = $1", [row.id, JSON.stringify(qa)]);
      s.checked++;
    } catch {
      await d.db.query("update media set qa_checked_at = now() where id = $1", [row.id]);
      s.failed++;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return s;
}

export async function registerMediaRecheckJob(boss: PgBoss, deps: MediaRecheckDeps): Promise<void> {
  await boss.createQueue(MEDIA_RECHECK_QUEUE);
  await boss.work(MEDIA_RECHECK_QUEUE, { batchSize: 1 }, async () => {
    const r = await runMediaRecheckOnce(deps);
    if (r.checked || r.failed) console.log(`[media-recheck] re-checked ${r.checked} clip(s), ${r.failed} failed`);
  });
  await boss.schedule(MEDIA_RECHECK_QUEUE, "*/10 * * * *", undefined, { singletonKey: "media-recheck", expireInSeconds: 60 * 60, retryLimit: 0 });
}
