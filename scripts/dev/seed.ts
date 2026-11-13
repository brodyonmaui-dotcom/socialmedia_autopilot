// pnpm dev:seed [--week YYYY-MM-DD]
// Loads demo research + analytics rows into a LOCAL Postgres so /research and /analytics can be
// checked without the server. Refuses non-local hosts AND any database that already holds real
// media (on the laptop, localhost:5433 is the tunnel to production). Uses DEV_DATABASE_URL if set,
// else DATABASE_URL. Runs pending migrations on that local DB first. Never deletes; re-running only adds
// the next-week draft batch if it's missing (so older dev DBs pick it up).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPool, migrate } from "../../packages/db/src/index.js";
import { assertLocalDatabaseUrl, assertNoRealData, buildSeedRows, DEMO_HASH_PREFIX } from "./lib/seed.js";

if (existsSync(".env")) process.loadEnvFile(".env");

function mondayOf(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

const wi = process.argv.indexOf("--week");
const week = wi > 0 ? process.argv[wi + 1]! : mondayOf(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error("--week must be YYYY-MM-DD");

/** The one pg client the seed transaction runs on (only what seedDraftBatch needs). */
interface PoolClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}
const addDays = (ymd: string, n: number): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * One draft batch for the week after the seeded one, so the approval screen has something to review:
 * 2 IG, 2 YouTube (with titles), 1 TikTok inbox draft, 1 Snapchat. One caption keeps a {{P/L}} placeholder
 * and one item is already in the past, so the UI has both to flag. Its clips get an r2_key (a "clean file").
 * Skipped when a draft batch for that week already exists. Returns the item count (0 = skipped).
 */
async function seedDraftBatch(client: PoolClient, seededWeek: string): Promise<number> {
  const weekStart = addDays(seededWeek, 7);
  const exists = await client.query("select 1 from batches where week_start = $1 and status = 'draft' limit 1", [weekStart]);
  if (exists.rows.length) return 0;
  const media = (await client.query("select id, content_hash from media where content_hash like $1 order by content_hash limit 6", [`${DEMO_HASH_PREFIX}%`])).rows as Array<{ id: string; content_hash: string }>;
  if (media.length < 6) throw new Error(`need 6 demo clips for the draft batch, found ${media.length}`);
  for (const m of media) await client.query("update media set r2_key = $2 where id = $1", [m.id, `demo/${m.content_hash}.mp4`]);

  // Future slots: the draft week itself, or from tomorrow if --week put it in the past.
  const now = Date.now();
  const startMs = Math.max(Date.parse(`${weekStart}T00:00:00Z`), now + 86_400_000);
  const at = (day: number, hourUtc: number) => new Date(startMs + day * 86_400_000 + hourUtc * 3_600_000).toISOString();
  const items: Array<{ platform: string; caption: string; title: string | null; scheduledFor: string; trial: object | null }> = [
    { platform: "instagram", caption: "Same warm-up, heavier top set. Slow and steady 🙂‍↕️ #gym #hypertrophy", title: null, scheduledFor: at(0, 17), trial: null },
    { platform: "instagram", caption: "Monday recap: {{P/L}} on the day, stuck to the plan. Not financial advice.", title: null, scheduledFor: at(1, 17), trial: null },
    { platform: "youtube", caption: "Full push day, every set.\n\n#gym #gymbro", title: "Full push day, every set", scheduledFor: at(2, 18), trial: null },
    { platform: "youtube", caption: "Meal prep for the week in 60 seconds.\n\n#mealprep", title: "Meal prep in 60 seconds", scheduledFor: new Date(now - 2 * 3_600_000).toISOString(), trial: null },
    { platform: "tiktok", caption: "Leg day, no skipping #gym #legday", title: null, scheduledFor: at(3, 19), trial: { tiktokDraft: true } },
    { platform: "snapchat", caption: "Back day check-in", title: null, scheduledFor: at(4, 18), trial: null },
  ];
  const batch = (await client.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [weekStart])).rows[0].id as string;
  for (const [i, it] of items.entries()) {
    await client.query(
      `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, trial, status)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'draft')`,
      [batch, media[i]!.id, it.platform, it.caption, it.title, it.scheduledFor, it.trial ? JSON.stringify(it.trial) : null],
    );
  }
  return items.length;
}

/**
 * F10: one approved Snapchat item due "now" in the approved demo batch (approved_at on item + batch, clean
 * file set), so /handoff shows a card. Scheduled a minute ago so it lands on today in any zone. Skipped
 * when the batch already holds an approved Snapchat item. Returns 1 when added, 0 when skipped.
 */
async function seedSnapchatToday(client: PoolClient, seededWeek: string): Promise<number> {
  const batch = (await client.query("select id from batches where week_start = $1 and status = 'approved' order by created_at limit 1", [seededWeek])).rows[0]?.id as
    | string
    | undefined;
  if (!batch) return 0;
  const exists = await client.query("select 1 from batch_items where batch_id = $1 and platform = 'snapchat' and status = 'approved' limit 1", [batch]);
  if (exists.rows.length) return 0;
  const m = (await client.query("select id, content_hash from media where content_hash like $1 order by content_hash limit 1", [`${DEMO_HASH_PREFIX}%`])).rows[0] as
    | { id: string; content_hash: string }
    | undefined;
  if (!m) return 0;
  await client.query("update media set r2_key = coalesce(r2_key, $2) where id = $1", [m.id, `demo/${m.content_hash}.mp4`]);
  await client.query("update batches set approved_at = coalesce(approved_at, now()) where id = $1", [batch]);
  await client.query(
    `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status, approved_at)
     values ($1, $2, 'snapchat', $3, now() - interval '1 minute', 'approved', now())`,
    [batch, m.id, "Back day check-in, slow and steady #gym #backday"],
  );
  return 1;
}

const url = process.env.DEV_DATABASE_URL ?? process.env.DATABASE_URL;
try {
  assertLocalDatabaseUrl(url);
} catch (e) {
  console.error(`dev:seed: FAIL ${(e as Error).message.replace(/^dev:seed: /, "")}`);
  process.exit(1);
}

const pool = createPool(url!);
try {
  // Check BEFORE migrating, so a production DB behind a tunnel gets no writes at all.
  const hasMedia = (await pool.query("select to_regclass('public.media') is not null as ok")).rows[0].ok as boolean;
  if (hasMedia) {
    const real = (await pool.query("select count(*)::int n from media where content_hash not like $1", [`${DEMO_HASH_PREFIX}%`])).rows[0].n as number;
    assertNoRealData(real);
  }

  const applied = await migrate(pool, fileURLToPath(new URL("../../packages/db/migrations", import.meta.url)));
  const already = (await pool.query("select count(*)::int n from media where content_hash like $1", [`${DEMO_HASH_PREFIX}%`])).rows[0].n as number;
  if (already > 0) {
    const seeded = (
      await pool.query(
        `select b.week_start::text as w from batches b join batch_items bi on bi.batch_id = b.id join media m on m.id = bi.media_id
         where m.content_hash like $1 and b.status = 'approved' order by b.week_start limit 1`,
        [`${DEMO_HASH_PREFIX}%`],
      )
    ).rows[0]?.w as string | undefined;
    let drafts = 0;
    let snaps = 0;
    if (seeded) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        drafts = await seedDraftBatch(client, seeded);
        snaps = await seedSnapchatToday(client, seeded);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw e;
      } finally {
        client.release();
      }
    }
    console.log(`dev:seed: OK already seeded (${already} demo clips${drafts ? `, added ${drafts} draft items` : ""}${snaps ? ", added 1 snapchat item due now" : ""}); migrations applied: ${applied.length}`);
  } else {
    const rows = buildSeedRows(week);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const batch = (await client.query("insert into batches (week_start, status, approved_at) values ($1, 'approved', now()) returning id", [week])).rows[0].id as string;
      const mediaIds = new Map<string, string>();
      for (const m of rows.media) {
        const r = await client.query(
          "insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status) values ($1, $2, null, $3, 1080, 1920, $4, 'used') returning id",
          [m.hash, `demo/${m.hash}.mp4`, m.durationS, m.pillar],
        );
        mediaIds.set(m.hash, r.rows[0].id);
      }
      for (const it of rows.items) {
        const r = await client.query(
          `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, trial, status, platform_post_id, approved_at)
           values ($1, $2, $3, $4, $5, $6, 'published', 'demo', $5::timestamptz - interval '1 day') returning id`,
          [batch, mediaIds.get(it.hash), it.platform, it.caption, it.scheduledFor, it.trial ? JSON.stringify(it.trial) : null],
        );
        await client.query("insert into post_metrics (batch_item_id, age_hours, metrics) values ($1, 168, $2)", [r.rows[0].id, JSON.stringify(it.metrics)]);
      }
      for (const c of rows.creators) {
        await client.query(
          "insert into creators (platform, handle, pillar, notes, followers) values ($1, $2, $3, $4, $5) on conflict (platform, handle) do nothing",
          [c.platform, c.handle, c.pillar, c.notes, c.followers],
        );
      }
      for (const i of rows.ideas) await client.query("insert into ideas (title, pillar, stage, hook) values ($1, $2, $3, $4)", [i.title, i.pillar, i.stage, i.hook]);
      for (const h of rows.hooks) await client.query("insert into hooks (text, pillar, source) values ($1, $2, $3)", [h.text, h.pillar, h.source]);
      const drafts = await seedDraftBatch(client, week);
      const snaps = await seedSnapchatToday(client, week);
      await client.query("commit");
      console.log(
        `dev:seed: OK week ${week}: ${rows.media.length} demo clips, ${rows.items.length} published items + snapshots, ${drafts} draft items, ${snaps} snapchat due now, ` +
          `${rows.creators.length} creators, ${rows.ideas.length} ideas, ${rows.hooks.length} hooks; migrations applied: ${applied.length}`,
      );
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }
} catch (e) {
  console.error(`dev:seed: FAIL ${(e as Error).message.replace(/^dev:seed: /, "")}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
