// Windows ingest agent. Scans the configured "ready to post" folders, dedupes by content hash,
// strips metadata + normalizes loudness, re-checks the clean copy for location tags, uploads it to R2, and records it in the
// media library (Postgres). Requires DATABASE_URL to reach the VPS (see docs for the SSH tunnel).
//
//   pnpm --filter @autopilot/ingest-agent ingest            # real run
//   pnpm --filter @autopilot/ingest-agent ingest --dry-run  # scan + hash + dedupe check only:
//                                                           # no QA, no upload, no DB writes
//   ... --folder "Week of Nov 23"      # label every NEW clip with a library folder
//   ... --folder-from week             # label each NEW clip "Week of <Mon DD>" from its captured date
//   ... --folder "<label>" --retag     # also re-label clips already in the library (matched by hash)
// Exit codes: 0 ok · 1 some files failed · 2 stopped because the DB connection was lost (re-run).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRepoEnv } from "./load-env.js";
import { assertTimeZone, fingerprintFromFrames } from "@autopilot/core";
import { createPool } from "@autopilot/db";
import { grabFingerprintFrames, makePoster, probeLocationTagKeys, runQa, sha256File, touchUp } from "@autopilot/media";
import { parseIngestRoots } from "./config.js";
import { folderForClip, parseIngestFlags } from "./folder-flags.js";
import { createIngestFile } from "./ingest-file.js";
import { createR2Client, uploadToR2 } from "./r2.js";
import { withRetry } from "./retry.js";
import { runIngest, summaryLine } from "./run.js";
import { findVideoFiles } from "./scan.js";

loadRepoEnv();

const parsed = parseIngestFlags(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`ingest: ${parsed.error}`);
  process.exit(1);
}
const { dryRun, retag } = parsed.flags;
const folderZone = (() => {
  try {
    return process.env.TZ_CREATOR ? assertTimeZone(process.env.TZ_CREATOR) : "UTC";
  } catch {
    return "UTC";
  }
})();

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
  retag: retag
    ? async (hash) => ((await pool.query("update media set folder = $2 where content_hash = $1 and folder is distinct from $2", [hash, parsed.flags.folder])).rowCount ?? 0) > 0
    : undefined,
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
    makePoster,
    uploadPoster: (key, jpgPath) => withRetry(() => uploadToR2(r2!, bucket, key, jpgPath, "image/jpeg")),
    log: (line) => console.log(line),
    folderFor: (capturedAt) => folderForClip(parsed.flags, capturedAt, folderZone),
    insert: async (params) => {
      // The folder column needs migration 0016, so it is only named when a folder flag gave this clip one.
      const withFolder = params.length > 10;
      await pool.query(
        `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, qa, captured_at, poster_key, qa_checked_at${withFolder ? ", folder" : ""})
         values ($1, $2, $3, $4, $5, $6, $7, 'ready', $8, $9, $10, now()${withFolder ? ", $11" : ""})`,
        params,
      );
    },
    tmpDir: () => mkdtempSync(join(tmpdir(), "autopilot-ingest-")),
    cleanup: (dir) => rmSync(dir, { recursive: true, force: true }),
    // F26 A: needs migration 0018; before it (or on any error) the worker's backfill tick fills it from R2 instead.
    fingerprint: async (hash, cleanPath, durationS) => {
      const g = await grabFingerprintFrames(cleanPath, { durationS });
      const fp = fingerprintFromFrames(g.durationS, g.frames);
      if (fp) await pool.query("update media set fingerprint = coalesce(fingerprint, $2), fingerprint_at = now() where content_hash = $1", [hash, fp]);
    },
  }),
});

console.log(summaryLine(summary, dryRun));
await pool.end().catch(() => {});
process.exit(summary.stopped ? 2 : summary.failed ? 1 : 0);
