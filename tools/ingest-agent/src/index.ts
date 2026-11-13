// Windows ingest agent. Scans the configured "ready to post" folders, dedupes by content hash,
// strips metadata + normalizes loudness, re-checks the clean copy for location tags, uploads it to R2, and records it in the
// media library (Postgres). Requires DATABASE_URL to reach the VPS (see docs for the SSH tunnel).
//
//   pnpm --filter @autopilot/ingest-agent ingest            # real run
//   pnpm --filter @autopilot/ingest-agent ingest --dry-run  # scan + hash + dedupe check only:
//                                                           # no QA, no upload, no DB writes
// Exit codes: 0 ok · 1 some files failed · 2 stopped because the DB connection was lost (re-run).
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool } from "@autopilot/db";
import { probeLocationTagKeys, runQa, sha256File, touchUp } from "@autopilot/media";
import { parseIngestRoots } from "./config.js";
import { createIngestFile } from "./ingest-file.js";
import { createR2Client, uploadToR2 } from "./r2.js";
import { withRetry } from "./retry.js";
import { runIngest, summaryLine } from "./run.js";
import { findVideoFiles } from "./scan.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const dryRun = process.argv.includes("--dry-run");

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
const bucket = dryRun ? "" : need("R2_BUCKET_MEDIA");
const r2 = dryRun
  ? null
  : createR2Client({
      accountId: need("R2_ACCOUNT_ID"),
      accessKeyId: need("R2_ACCESS_KEY_ID"),
      secretAccessKey: need("R2_SECRET_ACCESS_KEY"),
      bucket,
    });

const pool = createPool(databaseUrl);
// An idle client dying (tunnel dropped between files) emits 'error' on the pool; without a
// listener Node crashes the process. The next query surfaces it and runIngest handles it.
pool.on("error", () => {});

const files = findVideoFiles(roots);
console.log(`${dryRun ? "DRY RUN: " : ""}found ${files.length} candidate file(s) across ${roots.length} root(s)`);

const summary = await runIngest({
  files,
  dryRun,
  hash: sha256File,
  exists: async (hash) => (await pool.query("select 1 from media where content_hash = $1", [hash])).rows.length > 0,
  ping: async () => {
    await pool.query("select 1");
  },
  log: (line) => console.log(line),
  ingest: createIngestFile({
    runQa,
    touchUp,
    locationTagKeys: probeLocationTagKeys,
    upload: (key, cleanPath) =>
      withRetry(() => uploadToR2(r2!, bucket, key, cleanPath), {
        onRetry: (n, err) => console.log(`RETRY ${key} upload attempt ${n + 1} — ${(err as Error).message}`),
      }),
    insert: async (params) => {
      await pool.query(
        `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, qa, captured_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'ready', $8, $9)`,
        params,
      );
    },
    tmpDir: () => mkdtempSync(join(tmpdir(), "autopilot-ingest-")),
    cleanup: (dir) => rmSync(dir, { recursive: true, force: true }),
  }),
});

console.log(summaryLine(summary, dryRun));
await pool.end().catch(() => {});
process.exit(summary.stopped ? 2 : summary.failed ? 1 : 0);
