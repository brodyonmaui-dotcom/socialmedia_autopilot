// `pnpm ingest:posters`: backfill poster frames for media rows that have none (poster_key is null).
// Reads each clip's ORIGINAL from the laptop library (where it was ingested from, or ready/_ingested/),
// checks its content hash, makes a small metadata-free JPEG, uploads it to R2 and sets poster_key.
// Originals are only read, never changed or moved.
//
//   pnpm ingest:posters           # dry run (default): counts only, nothing made, uploaded or written
//   pnpm ingest:posters --write   # make + upload + update
// Exit codes: 0 ok · 1 some posters failed · 2 configuration missing.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool } from "@autopilot/db";
import { makePoster, sha256File } from "@autopilot/media";
import { backfillSummaryLine, runPosterBackfill, type PosterRow } from "./poster.js";
import { createR2Client, uploadToR2 } from "./r2.js";
import { withRetry } from "./retry.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const write = process.argv.includes("--write");
const required = ["DATABASE_URL", ...(write ? ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_MEDIA"] : [])];
const missing = required.filter((n) => !process.env[n]);
if (missing.length) {
  console.error(`posters: missing env ${missing.join(", ")} (see .env.example); nothing done`);
  process.exit(2);
}
const env = (n: string) => process.env[n]!;

const bucket = write ? env("R2_BUCKET_MEDIA") : "";
const r2 = write ? createR2Client({ accountId: env("R2_ACCOUNT_ID"), accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), bucket }) : null;

const pool = createPool(env("DATABASE_URL"));
pool.on("error", () => {});

const rows: PosterRow[] = (
  await pool.query(`select id, content_hash, source_path, r2_key, duration_s from media where poster_key is null order by created_at`)
).rows.map((r) => ({ id: r.id, contentHash: r.content_hash, sourcePath: r.source_path, r2Key: r.r2_key ?? null, durationS: r.duration_s === null ? null : Number(r.duration_s) }));

const summary = await runPosterBackfill({
  write,
  rows,
  exists: (p) => existsSync(p),
  hash: sha256File,
  makePoster,
  uploadPoster: (key, jpgPath) => withRetry(() => uploadToR2(r2!, bucket, key, jpgPath, "image/jpeg")),
  update: async (id, posterKey) => {
    await pool.query(`update media set poster_key = $2, updated_at = now() where id = $1 and poster_key is null`, [id, posterKey]);
  },
  tmpDir: () => mkdtempSync(join(tmpdir(), "autopilot-poster-")),
  cleanup: (d) => rmSync(d, { recursive: true, force: true }),
  log: (line) => console.log(line),
});

console.log(backfillSummaryLine(summary, write));
await pool.end().catch(() => {});
process.exit(summary.failed ? 1 : 0);
