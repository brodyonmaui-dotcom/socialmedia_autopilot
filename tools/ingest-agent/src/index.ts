// Windows ingest agent. Scans the configured "ready to post" folders, dedupes by content hash,
// strips metadata + normalizes loudness, uploads the clean copy to R2, and records it in the
// media library (Postgres). Requires DATABASE_URL to reach the VPS (see docs for the SSH tunnel).
//
//   pnpm --filter @autopilot/ingest-agent ingest
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool } from "@autopilot/db";
import { runQa, sha256File, touchUp } from "@autopilot/media";
import { parseIngestRoots } from "./config.js";
import { createR2Client, uploadToR2 } from "./r2.js";
import { findVideoFiles } from "./scan.js";

if (existsSync(".env")) process.loadEnvFile(".env");

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set (see .env.example)`);
    process.exit(1);
  }
  return v;
}

const roots = parseIngestRoots(need("INGEST_ROOTS"));
const databaseUrl = need("DATABASE_URL");
const r2 = createR2Client({
  accountId: need("R2_ACCOUNT_ID"),
  accessKeyId: need("R2_ACCESS_KEY_ID"),
  secretAccessKey: need("R2_SECRET_ACCESS_KEY"),
  bucket: need("R2_BUCKET_MEDIA"),
});
const bucket = need("R2_BUCKET_MEDIA");

const pool = createPool(databaseUrl);
const files = findVideoFiles(roots);
console.log(`found ${files.length} candidate file(s) across ${roots.length} root(s)`);

let ingested = 0;
let skipped = 0;
let failed = 0;

for (const file of files) {
  const base = file.path.split(/[\\/]/).pop();
  try {
    const hash = await sha256File(file.path);
    const existing = await pool.query("select 1 from media where content_hash = $1", [hash]);
    if (existing.rows.length) {
      console.log(`SKIP dup ${base}`);
      skipped++;
      continue;
    }

    const qa = await runQa(file.path, "reels");
    const tmp = mkdtempSync(join(tmpdir(), "autopilot-ingest-"));
    const cleanPath = join(tmp, "clean.mp4");
    try {
      await touchUp(file.path, { outPath: cleanPath });
      const key = `library/${hash}.mp4`;
      await uploadToR2(r2, bucket, key, cleanPath);
      await pool.query(
        `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, qa, captured_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'ready', $8, $9)`,
        [
          hash,
          file.path,
          key,
          qa.probe.durationS,
          qa.probe.width,
          qa.probe.height,
          file.pillar,
          JSON.stringify(qa),
          qa.probe.capturedAt ?? null,
        ],
      );
      console.log(`INGESTED ${base} · ${file.pillar} · ${qa.probe.durationS.toFixed(1)}s · ${qa.warnings.length} warning(s)`);
      ingested++;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } catch (err) {
    console.log(`ERROR ${base} — ${(err as Error).message}`);
    failed++;
  }
}

console.log(`ingest: ${ingested} ingested, ${skipped} skipped (dup), ${failed} failed`);
await pool.end();
process.exit(failed ? 1 : 0);
