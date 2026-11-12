// pnpm schedule-batch <draft.json> [--write] [--week YYYY-MM-DD] [--no-db]
// Assigns scheduledFor to every post in a weekly-batch draft (scripts/skills/fixtures/draft-sample.json
// shape) from the cadence grid: per-platform daily caps, stagger across platforms/days, DST-safe times
// in TZ_CREATOR. Times already in the draft are kept (pinned). Reads cadence settings and existing
// commitments from the DB when DATABASE_URL is set (unless --no-db); never writes to the DB, never
// approves, never posts. Prints one line; without --write it only previews (details in logs/).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { assertTimeZone, assignSlots, DEFAULT_CADENCE, findCapBreaches, normalizeCadence, type CadenceSettings, type ExistingPost, type Platform, type ScheduleItem } from "../packages/core/src/index.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
const flag = (k: string): boolean => argv.includes(`--${k}`);
const opt = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (!file) {
  console.log("schedule-batch: FAIL usage: schedule-batch <draft.json> [--write] [--week YYYY-MM-DD] [--no-db]");
  process.exit(1);
}

interface DraftPost {
  caption: string;
  title?: string;
  scheduledFor?: string;
  tiktokDraft?: boolean;
}
interface Draft {
  weekStart: string;
  items: Array<{ mediaId: string; pillar?: string; label?: string; capturedAt?: string; posts: Partial<Record<Platform, DraftPost>> }>;
}

try {
  const timeZone = assertTimeZone(process.env.TZ_CREATOR);
  const draft = JSON.parse(readFileSync(file, "utf8")) as Draft;
  const weekStart = opt("week") ?? draft.weekStart;

  let cadence: CadenceSettings = DEFAULT_CADENCE;
  let existing: ExistingPost[] = [];
  let source = "defaults";
  if (process.env.DATABASE_URL && !flag("no-db")) {
    const { createPool } = await import("../packages/db/src/client.js");
    const { loadCadence } = await import("../apps/worker/src/jobs/outbox.js");
    const pool = createPool(process.env.DATABASE_URL);
    try {
      cadence = await loadCadence(pool);
      // Everything already on the calendar from the plan's first day on, in any batch, so caps hold across batches.
      const { rows } = await pool.query(
        `select bi.platform, bi.scheduled_for from batch_items bi
         where bi.status not in ('failed') and bi.scheduled_for >= ($1::date - interval '1 day')`,
        [weekStart],
      );
      existing = rows.map((r: { platform: Platform; scheduled_for: Date }) => ({ platform: r.platform, scheduledFor: new Date(r.scheduled_for).toISOString() }));
      source = `db (${existing.length} existing post(s))`;
    } finally {
      await pool.end();
    }
  } else {
    cadence = normalizeCadence({});
  }

  const items: ScheduleItem[] = draft.items.map((it, i) => {
    const platforms = Object.keys(it.posts) as Platform[];
    const pinned: Partial<Record<Platform, string>> = {};
    for (const p of platforms) if (it.posts[p]?.scheduledFor) pinned[p] = it.posts[p]!.scheduledFor!;
    return { key: it.mediaId || it.label || `item-${i + 1}`, pillar: it.pillar, platforms, capturedAt: it.capturedAt, pinned };
  });

  const result = assignSlots({ weekStart, items, cadence, timeZone, existing, now: new Date() });
  const breaches = findCapBreaches([...existing, ...result.assignments], cadence, timeZone);

  for (const a of result.assignments) {
    if (a.pinned) continue;
    const item = draft.items.find((it, i) => (it.mediaId || it.label || `item-${i + 1}`) === a.key);
    const post = item?.posts[a.platform];
    if (post) post.scheduledFor = a.scheduledFor;
  }

  mkdirSync("logs", { recursive: true });
  const logPath = `logs/schedule-batch-${weekStart}.json`;
  writeFileSync(logPath, JSON.stringify({ weekStart, source, assignments: result.assignments.map(({ key, platform, localDate, localTime, pinned }) => ({ key, platform, localDate, localTime, pinned })), unplaced: result.unplaced, warnings: result.warnings, breaches }, null, 2));

  const ok = result.unplaced.length === 0 && breaches.length === 0;
  if (ok && flag("write")) writeFileSync(file, JSON.stringify(draft, null, 2) + "\n");
  const assigned = result.assignments.filter((a) => !a.pinned).length;
  console.log(
    `schedule-batch: ${ok ? "OK" : "FAIL"} ${assigned} time(s) assigned, ${result.assignments.length - assigned} kept, ${result.unplaced.length} unplaced, ${breaches.length} cap breach(es), ${result.warnings.length} warning(s) · cadence from ${source}${ok && flag("write") ? ` · wrote ${file}` : " · preview only (add --write)"} · details ${logPath}`,
  );
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`schedule-batch: FAIL ${(err as Error).message}`);
  process.exit(1);
}
