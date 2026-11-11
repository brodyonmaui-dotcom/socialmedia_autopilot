// pnpm dev:seed [--week YYYY-MM-DD]
// Loads demo research + analytics rows into a LOCAL Postgres so /research and /analytics can be
// checked without the server. Refuses non-local hosts AND any database that already holds real
// media (on the laptop, localhost:5433 is the tunnel to production). Uses DEV_DATABASE_URL if set,
// else DATABASE_URL. Runs pending migrations on that local DB first. Never deletes; re-running is a no-op.
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
    console.log(`dev:seed: OK already seeded (${already} demo clips); migrations applied: ${applied.length}`);
  } else {
    const rows = buildSeedRows(week);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const batch = (await client.query("insert into batches (week_start, status) values ($1, 'approved') returning id", [week])).rows[0].id as string;
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
          `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, trial, status, platform_post_id)
           values ($1, $2, $3, $4, $5, $6, 'published', 'demo') returning id`,
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
      await client.query("commit");
      console.log(
        `dev:seed: OK week ${week}: ${rows.media.length} demo clips, ${rows.items.length} published items + snapshots, ` +
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
