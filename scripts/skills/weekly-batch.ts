// weekly-batch skill: checks a drafted batch file against voice.md + the location boundary,
// and (only with --create) writes it to the DB as a DRAFT batch for approval on the phone.
//   pnpm skill:weekly-batch check <draft.json>
//   pnpm skill:weekly-batch create <draft.json>     needs DATABASE_URL; status stays 'draft'
// Never approves, never publishes. Prints one line; findings go to logs/.
import { readFileSync } from "node:fs";
import { blocklistFromEnv } from "../../packages/research/src/index.js";
import { checkDraft, createDraftBatch, formatFindings, type BatchDraft } from "./lib/batch-draft.js";
import { loadEnv, writeLog } from "./lib/io.js";

loadEnv();
const [mode, file] = process.argv.slice(2);
if ((mode !== "check" && mode !== "create") || !file) {
  console.log("weekly-batch: FAIL usage: weekly-batch check|create <draft.json>");
  process.exit(1);
}

try {
  const draft = JSON.parse(readFileSync(file, "utf8")) as BatchDraft;
  const blocklist = blocklistFromEnv();
  const check = checkDraft(draft, { blocklist });
  const log = writeLog("weekly-batch", `# weekly-batch ${mode} ${draft.weekStart}\n\n${formatFindings(check) || "no findings"}\n`);
  const summary = `${check.posts} post(s), ${check.errors} error(s), ${check.warnings} warning(s)`;

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
    const { batchId, items } = await createDraftBatch(client, draft, { blocklist });
    console.log(`weekly-batch: OK draft batch ${batchId} with ${items} item(s), ${check.warnings} warning(s); approve it on the phone → ${log}`);
  } finally {
    client.release();
    await pool.end();
  }
} catch (err) {
  console.log(`weekly-batch: FAIL ${(err as Error).message}`);
  process.exit(1);
}
