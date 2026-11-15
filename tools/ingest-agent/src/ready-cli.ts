// F15 `pnpm ingest:ready`: one pass over INGEST_READY_DIR (the editors' ready-to-post folder).
// Each approved render is <name>.mp4 + <name>.post.json; it becomes DRAFT items in the app (never
// approved here) and the pair moves to _ingested/ once the upload is verified and the DB write is done.
//
//   pnpm ingest:ready             # real run (Task Scheduler, every 10 min)
//   pnpm ingest:ready --dry-run   # validate + plan + print: no upload, no DB writes, no moves
// Exit codes: 0 ok · 1 some file FAILed · 2 configuration missing.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { assertTimeZone } from "@autopilot/core";
import { createPool, loadCadence } from "@autopilot/db";
import { probeLocationTagKeys, runQa, sha256File, touchUp } from "@autopilot/media";
import { blocklistFromEnv, lintText } from "@autopilot/research";
import { createR2Client, uploadToR2 } from "./r2.js";
import { readySummaryLine, runReady } from "./ready/run.js";
import { existingIngestKeys, existingPosts, upsertMedia, writeReadyItems } from "./ready/write.js";
import { withRetry } from "./retry.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const dryRun = process.argv.includes("--dry-run");

const required = ["INGEST_READY_DIR", "TZ_CREATOR", "DATABASE_URL", ...(dryRun ? [] : ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_MEDIA"])];
const missing = required.filter((n) => !process.env[n]);
if (missing.length) {
  console.error(`ingest:ready: missing env ${missing.join(", ")} (see .env.example); nothing done`);
  process.exit(2);
}
const env = (n: string) => process.env[n]!;

let timeZone: string;
try {
  timeZone = assertTimeZone(env("TZ_CREATOR"));
} catch {
  console.error("ingest:ready: TZ_CREATOR is not a valid IANA time zone; nothing done");
  process.exit(2);
}
const dir = env("INGEST_READY_DIR");
if (!existsSync(dir)) {
  console.error("ingest:ready: INGEST_READY_DIR does not exist; nothing done");
  process.exit(2);
}

const bucket = dryRun ? "" : env("R2_BUCKET_MEDIA");
const r2 = dryRun
  ? null
  : createR2Client({ accountId: env("R2_ACCOUNT_ID"), accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), bucket });

const pool = createPool(env("DATABASE_URL"));
// An idle client dying (tunnel dropped) emits 'error' on the pool; the next query surfaces it as a FAIL line.
pool.on("error", () => {});
const blocklist = blocklistFromEnv();

if (dryRun) console.log("DRY RUN: nothing is uploaded, written or moved");

const summary = await runReady({
  dir,
  dryRun,
  timeZone,
  now: () => new Date(),
  fs: {
    list: (d) =>
      readdirSync(d, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name),
    readText: (p) => readFileSync(p, "utf8"),
    exists: (p) => existsSync(p),
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    rename: (from, to) => renameSync(from, to),
  },
  hash: sha256File,
  runQa,
  touchUp,
  locationTagKeys: probeLocationTagKeys,
  upload: (key, cleanPath) =>
    withRetry(() => uploadToR2(r2!, bucket, key, cleanPath), {
      onRetry: (n, err) => console.log(`RETRY ${key} upload attempt ${n + 1} — ${(err as Error).message}`),
    }),
  headObject: async (key) => {
    try {
      const res = await withRetry(() => r2!.send(new HeadObjectCommand({ Bucket: bucket, Key: key })));
      return { size: Number(res.ContentLength ?? 0) };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  },
  tmpDir: () => mkdtempSync(join(tmpdir(), "autopilot-ready-")),
  cleanup: (d) => rmSync(d, { recursive: true, force: true }),
  db: {
    existingKeys: (keys) => existingIngestKeys(pool, keys),
    loadCadence: () => loadCadence(pool),
    existingPosts: (from, to) => existingPosts(pool, from, to),
    upsertMedia: (row) => upsertMedia(pool, row),
    writeItems: (input) => writeReadyItems(pool, input),
  },
  lint: (text, kind, platform) => lintText({ text, kind, platform, blocklist }),
  log: (line) => console.log(line),
});

console.log(readySummaryLine(summary));
await pool.end().catch(() => {});
process.exit(summary.fail ? 1 : 0);
