// One-off: schedules the IG-but-not-yet-YouTube/TikTok backlog (Workout Vlogs/Full Logs + Short Reels)
// at a 2-3/day catch-up cadence across the configured posting windows.
//   pnpm exec tsx scripts/schedule-catchup.mjs            preview only, no DB writes
//   pnpm exec tsx scripts/schedule-catchup.mjs --create    creates batch+batch_items as status='draft'
//   pnpm exec tsx scripts/schedule-catchup.mjs --approve <batchId>   flips a draft batch to approved
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
const { createPool } = await import("../packages/db/src/client.ts");
const { getSetting, generateCatchUpSlots } = await import("../packages/core/src/index.ts");

const SEP = String.fromCharCode(92);
const ALREADY_POSTED_TODAY = ["log-11.10-legs.mp4", "log-11.10-legs-final.mp4", "11.9 Mashup (2).mp4"];
const SLOTS_PER_DAY = 3;
const TIME_ZONE = process.env.TZ_CREATOR;

const MASHUP_LINES = [
  "Quick physique check, staying consistent is all 🙂‍↕️",
  "Definitely due for a bull again…",
  "Just stacking days is all 🙂‍↕️…",
];

function humanizeFilename(filename) {
  let name = filename.replace(/\.(mp4|mov|m4v)$/i, "");
  name = name.replace(/-(?:set\d+|a\d+|c\d+|side\d+|angle\d+)?-?\d{3,4}$/i, "");
  name = name.replace(/^set-/i, "");
  name = name.replace(/[-_]+/g, " ").trim().replace(/\s+/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function captionFor(filename, index) {
  const isMashup = /mash.?up/i.test(filename);
  const core = isMashup ? MASHUP_LINES[index % MASHUP_LINES.length] : humanizeFilename(filename) + "…";
  return {
    youtube: { title: core.length <= 60 ? core : core.slice(0, 57) + "...", description: `${core}\n\n#gym #gymbro #hypertrophy` },
    tiktok: { caption: `${core} #gym #gymbro #physique #hypertrophy` },
  };
}

async function main() {
  const pool = createPool(process.env.DATABASE_URL);
  const args = new Set(process.argv.slice(2));

  if (args.has("--approve")) {
    const batchId = process.argv[process.argv.indexOf("--approve") + 1];
    await pool.query("update batches set status = 'approved', updated_at = now() where id = $1", [batchId]);
    await pool.query("update batch_items set status = 'approved', updated_at = now() where batch_id = $1 and status = 'draft'", [batchId]);
    console.log(`batch ${batchId} approved`);
    await pool.end();
    return;
  }

  if (!TIME_ZONE) {
    console.error("TZ_CREATOR is not set in .env — required to resolve the posting windows to real times");
    process.exit(1);
  }
  const windows = await getSetting(pool, "posting_windows");
  if (!windows?.length) {
    console.error("no posting_windows setting found — run the 0002_settings.sql migration first");
    process.exit(1);
  }

  const r = await pool.query(
    `select id, source_path from media
     where (position($1 in source_path) > 0 or position($2 in source_path) > 0) and status = 'ready'
     order by created_at`,
    [`${SEP}Full Logs${SEP}`, `${SEP}Short Reels${SEP}`],
  );
  const candidates = r.rows.filter((row) => !ALREADY_POSTED_TODAY.includes(row.source_path.split(SEP).pop()));
  console.log(`${candidates.length} catch-up candidates (${r.rows.length - candidates.length} excluded, already posted everywhere today)`);

  const slots = generateCatchUpSlots({ count: candidates.length, slotsPerDay: SLOTS_PER_DAY, windows, timeZone: TIME_ZONE, startFrom: new Date() });
  const lastSlot = slots[slots.length - 1];
  console.log(`cadence: ${SLOTS_PER_DAY}/day -> ${candidates.length} items clears by ${lastSlot?.toISOString()} (${Math.ceil(candidates.length / SLOTS_PER_DAY)} days)`);

  console.log("\n--- sample captions (first 5 + 2 mashups) ---");
  const mashupSample = candidates.filter((c) => /mash.?up/i.test(c.source_path)).slice(0, 2);
  for (const row of [...candidates.slice(0, 5), ...mashupSample]) {
    const base = row.source_path.split(SEP).pop();
    const idx = candidates.indexOf(row);
    const c = captionFor(base, idx);
    console.log(`${base}\n  YT title: ${c.youtube.title}\n  TikTok:   ${c.tiktok.caption}\n`);
  }

  if (!args.has("--create")) {
    console.log("(preview only — pass --create to actually write the batch)");
    await pool.end();
    return;
  }

  const batch = await pool.query("insert into batches (week_start, status) values (current_date, 'draft') returning id", []);
  const batchId = batch.rows[0].id;
  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    const base = row.source_path.split(SEP).pop();
    const c = captionFor(base, i);
    const scheduledFor = slots[i].toISOString();
    await pool.query(
      `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status) values ($1,$2,'youtube',$3,$4,$5,'draft')`,
      [batchId, row.id, c.youtube.description, c.youtube.title, scheduledFor],
    );
    await pool.query(
      `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status) values ($1,$2,'tiktok',$3,$4,'draft')`,
      [batchId, row.id, c.tiktok.caption, scheduledFor],
    );
  }
  console.log(`\ncreated batch ${batchId}: ${candidates.length * 2} batch_items (draft). Approve with:`);
  console.log(`  pnpm exec tsx scripts/schedule-catchup.mjs --approve ${batchId}`);
  await pool.end();
}

await main();
