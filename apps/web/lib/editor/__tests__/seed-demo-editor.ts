// pnpm tsx apps/web/lib/editor/__tests__/seed-demo-editor.ts
// Dev-only helper (F15): two demo editor renders as drafts in this week's batch, so the "From your
// editors" card has something to show locally. LOCAL Postgres only (same guard as pnpm dev:seed), demo
// clips only (content_hash demo-*; it adds demo-ed-a/b), idempotent via the ingest_key unique index (demo:<platform>,
// demo-b:<platform>). Never deletes, never approves.
import pg from "pg";
import { assertLocalDatabaseUrl } from "../../../../../scripts/dev/lib/seed.js";

const url = process.env.DEV_DATABASE_URL ?? process.env.DATABASE_URL;
const u = assertLocalDatabaseUrl(url);
if (u.port === "5433") throw new Error("localhost:5433 is the tunnel to production: refusing");

function mondayOf(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const real = (await pool.query("select count(*)::int as n from media where content_hash not like 'demo-%' and content_hash not like 'f15test-%' and content_hash not like 'test-%'")).rows[0].n as number;
    if (real > 0) throw new Error("this DB holds non-demo media: refusing");
    const week = mondayOf(new Date());
    const batch = (await pool.query("select id from batches where week_start = $1 order by created_at limit 1", [week])).rows[0]?.id as string | undefined;
    if (!batch) throw new Error(`no batch for week ${week}: run pnpm dev:seed first`);
    // Two demo clips of its own (content_hash demo-ed-*, a fake clean file), so the drafts don't collide with the weekly demo items.
    const clip = async (hash: string, name: string, durationS: number, pillar: string): Promise<{ id: string }> =>
      (
        await pool.query(
          `insert into media (content_hash, source_path, r2_key, duration_s, pillar, status)
           values ($1, $2, $3, $4, $5, 'ingested')
           on conflict (content_hash) do update set source_path = excluded.source_path returning id`,
          [hash, `demo/${name}.mp4`, `demo/${hash}.mp4`, durationS, pillar],
        )
      ).rows[0];
    const media = [await clip("demo-ed-a", "squat-cues", 38, "tip"), await clip("demo-ed-b", "sunday-prep", 29, "meal")];

    const now = Date.now();
    const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
    const editor = (flags: string[], pillar: string) => ({ source: "CapCut", pillar, when: "today", earliest: null, approvedInEditor: new Date(now).toISOString(), flags });
    const rows = [
      // Render A: clean on IG + YouTube; TikTok needs a caption and its sound added in the app; Snapchat has no slot today.
      { key: "demo:instagram", m: 0, platform: "instagram", caption: "Three cues that fixed my squat depth.\nSave it for leg day. #gym #squat #form", title: null, at: at(150), trial: { editor: editor([], "tip") } },
      { key: "demo:youtube", m: 0, platform: "youtube", caption: "Three cues that fixed my squat depth. #shorts #gym", title: "Three cues for squat depth", at: at(180), trial: { editor: editor([], "tip") } },
      { key: "demo:tiktok", m: 0, platform: "tiktok", caption: "", title: null, at: at(210), trial: { tiktokDraft: true, editor: editor(["needs-caption", "add-sound-in-app"], "tip") } },
      { key: "demo:snapchat", m: 0, platform: "snapchat", caption: "Squat cues", title: null, at: null, trial: { editor: editor(["no-slot"], "tip") } },
      // Render B: all clear, IG + TikTok.
      { key: "demo-b:instagram", m: 1, platform: "instagram", caption: "Sunday prep, four boxes, twenty minutes. #mealprep #protein #prep", title: null, at: at(240), trial: { editor: editor([], "meal") } },
      { key: "demo-b:tiktok", m: 1, platform: "tiktok", caption: "Four boxes, twenty minutes #mealprep #protein #prep", title: null, at: at(270), trial: { editor: editor([], "meal") } },
    ];
    let added = 0;
    for (const r of rows) {
      const res = await pool.query(
        `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, trial, status, origin, ingest_key)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'draft', 'editor', $8)
         on conflict (ingest_key) where ingest_key is not null do nothing returning id`,
        [batch, media[r.m]!.id, r.platform, r.caption, r.title, r.at, JSON.stringify(r.trial), r.key],
      );
      added += res.rowCount ?? 0;
    }
    console.log(`seed-demo-editor: OK week ${week}, added ${added} of ${rows.length} (existing keys skipped)`);
  } finally {
    await pool.end();
  }
}

main().catch((err: Error) => {
  console.error(`seed-demo-editor: FAIL ${err.message}`);
  process.exitCode = 1;
});
