// weekly-batch skill: checks a drafted batch file against voice.md + the location boundary,
// and (only with --create) writes it to the DB as a DRAFT batch for approval on the phone.
//   pnpm skill:weekly-batch check <draft.json>
//   pnpm skill:weekly-batch review <draft.json> [--force]  writes <draft>-review.md (clip folder/file, per-platform
//                                                   text, open questions); reads the DB only if reachable
//   pnpm skill:weekly-batch create <draft.json>     needs DATABASE_URL; status stays 'draft'
//   pnpm skill:weekly-batch pending [--week <date>]  draft items with empty caption / YT title (default: next
//                                                   week) → logs/weekly-pending-<week>.json (also the fill template)
//   pnpm skill:weekly-batch fill <file> [--write]    lints [{id, caption, title?}]; only --write stores the text
// Never approves, never publishes. Prints one line; findings go to logs/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertTimeZone } from "../../packages/core/src/index.js";
import { blocklistFromEnv } from "../../packages/research/src/index.js";
import { checkDraft, createDraftBatch, formatFindings, type BatchDraft, type InsertClient } from "./lib/batch-draft.js";
import { buildReview, reviewPathFor, type ClipInfo } from "./lib/batch-review.js";
import { arg, loadEnv, writeLog } from "./lib/io.js";
import { checkFill, formatFillFindings, listPending, loadFillTargets, nextWeekStart, parseFillFile, pendingSummary, weekOf, writeFill } from "./lib/weekly-fill.js";

loadEnv();
const argv = process.argv.slice(2);
const mode = argv[0];
const file = argv[1] ?? "";
const MODES = ["check", "create", "review", "pending", "fill"];
if (!mode || !MODES.includes(mode) || (mode !== "pending" && (!file || file.startsWith("--")))) {
  console.log("weekly-batch: FAIL usage: weekly-batch check|review|create <draft.json> | pending [--week <date>] | fill <file> [--write]");
  process.exit(1);
}

async function withDb<T>(fn: (client: InsertClient) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const { createPool } = await import("../../packages/db/src/client.js");
  const pool = createPool(process.env.DATABASE_URL);
  pool.on("error", () => {});
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

/** TZ_CREATOR when valid, else UTC (said in the summary line; the zone itself is never printed). */
function zone(): { timeZone: string; note: string } {
  try {
    return { timeZone: assertTimeZone(process.env.TZ_CREATOR), note: "" };
  } catch {
    return { timeZone: "UTC", note: ", times in UTC (TZ_CREATOR not set)" };
  }
}

if (mode === "pending") {
  try {
    const { timeZone, note } = zone();
    const raw = arg(argv, "week");
    const week = raw === undefined ? nextWeekStart(new Date(), timeZone) : weekOf(raw);
    if (!week) throw new Error("--week must be a date (YYYY-MM-DD)");
    const items = await withDb((c) => listPending(c, week, timeZone));
    mkdirSync("logs", { recursive: true });
    const out = join("logs", `weekly-pending-${week}.json`);
    writeFileSync(out, JSON.stringify(items, null, 2) + "\n");
    console.log(`weekly-batch: OK week of ${week}: ${pendingSummary(items)}${note} → ${out}`);
    process.exit(0);
  } catch (err) {
    console.log(`weekly-batch: FAIL ${(err as Error).message}`);
    process.exit(1);
  }
}

if (mode === "fill") {
  try {
    const write = argv.includes("--write");
    const entries = parseFillFile(JSON.parse(readFileSync(file, "utf8")));
    const blocklist = blocklistFromEnv();
    console.log(`blocklist: ${blocklist.length} terms`); // count only, never the terms
    const result = await withDb(async (c) => {
      const check = checkFill(entries, await loadFillTargets(c, entries.map((e) => e.id)), { blocklist });
      const written = write && check.ok ? (await writeFill(c, entries, { blocklist })).written : 0;
      return { check, written };
    });
    const { check, written } = result;
    const log = writeLog("weekly-batch-fill", `# weekly-batch fill${write ? " --write" : ""}\n\n${formatFillFindings(check) || "no findings"}\n`);
    const summary = `${check.entries} item(s), ${check.errors} error(s), ${check.warnings} warning(s)`;
    if (!check.ok) console.log(`weekly-batch: FAIL fill ${summary}, nothing written → ${log}`);
    else if (!write) console.log(`weekly-batch: OK fill ${summary}, nothing written (dry check); re-run with --write → ${log}`);
    else console.log(`weekly-batch: OK fill wrote ${written} item(s), ${check.warnings} warning(s); still drafts, approve on the phone → ${log}`);
    process.exit(check.ok ? 0 : 1);
  } catch (err) {
    console.log(`weekly-batch: FAIL ${(err as Error).message}`);
    process.exit(1);
  }
}

try {
  const draft = JSON.parse(readFileSync(file, "utf8")) as BatchDraft;
  const blocklist = blocklistFromEnv();
  console.log(`blocklist: ${blocklist.length} terms`); // F7 B8: count only, never the terms
  const check = checkDraft(draft, { blocklist });
  const log = writeLog("weekly-batch", `# weekly-batch ${mode} ${draft.weekStart}\n\n${formatFindings(check) || "no findings"}\n`);
  const summary = `${check.posts} post(s), ${check.errors} error(s), ${check.warnings} warning(s)`;

  if (mode === "review") {
    // Read-only, best effort: clip folder/duration/status from the library when the DB answers.
    const clips = new Map<string, ClipInfo>();
    let source = "no DATABASE_URL";
    if (process.env.DATABASE_URL) {
      const { createPool } = await import("../../packages/db/src/client.js");
      const pool = createPool(process.env.DATABASE_URL);
      pool.on("error", () => {});
      try {
        const ids = [...new Set(draft.items.map((i) => i.mediaId))];
        const { rows } = await pool.query("select id, source_path, duration_s, status from media where id = any($1::uuid[])", [ids]);
        for (const r of rows) clips.set(r.id, { sourcePath: r.source_path, durationS: r.duration_s == null ? null : Number(r.duration_s), status: r.status });
        source = `${clips.size}/${ids.length} clip(s) from the library`;
      } catch {
        source = "DB not reachable (tunnel down?), folders left blank";
      } finally {
        await pool.end().catch(() => {});
      }
    }
    const out = reviewPathFor(file);
    if (existsSync(out) && !process.argv.includes("--force")) {
      console.log(`weekly-batch: FAIL ${out} exists (may hold hand edits); re-run with --force to replace it`);
      process.exit(1);
    }
    writeFileSync(out, buildReview(draft, check, clips));
    console.log(`weekly-batch: ${check.ok ? "OK" : "FAIL"} review written, ${summary}, ${source} → ${out}`);
    process.exit(check.ok ? 0 : 1);
  }

  if (mode === "check") {
    console.log(`weekly-batch: ${check.ok ? "OK" : "FAIL"} ${summary}${check.ok && !check.creatable ? ", times missing (not creatable yet)" : ""} → ${log}`);
    process.exit(check.ok ? 0 : 1);
  }

  if (!check.creatable) {
    console.log(`weekly-batch: FAIL not created: ${summary}${check.ok ? ", times missing" : ""} → ${log}`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const { createPool } = await import("../../packages/db/src/client.js");
  const pool = createPool(process.env.DATABASE_URL);
  const client = await pool.connect();
  try {
    const { batchId, items, skipped } = await createDraftBatch(client, draft, { blocklist });
    console.log(`weekly-batch: OK draft batch ${batchId} with ${items} item(s), ${skipped} duplicate clip(s) skipped, ${check.warnings} warning(s); approve it on the phone → ${log}`);
  } finally {
    client.release();
    await pool.end();
  }
} catch (err) {
  console.log(`weekly-batch: FAIL ${(err as Error).message}`);
  process.exit(1);
}
