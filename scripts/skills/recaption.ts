// recaption skill (F26 B): re-composes the captions of DRAFT items in a week that fail the judge.
//   pnpm skill:recaption --week <monday> [--apply] [--ai]
// Dry run by default: prints a table, writes nothing. --apply updates the caption of those DRAFT items only (never an
// approved, queued or published one; status, time and approval stamps are untouched). Templates unless --ai and
// ANTHROPIC_API_KEY (then the $5/month cap from the settings table applies). Never approves, never publishes.
import { assertTimeZone } from "../../packages/core/src/index.js";
import { blocklistFromEnv, composeCaption } from "../../packages/research/src/index.js";
import { arg, loadEnv, writeLog } from "./lib/io.js";
import { formatRecaptionTable, loadRecaptionItems, loadRecentCaptions, planRecaption } from "./lib/recaption.js";
import { checkFill, loadFillTargets, nextWeekStart, weekOf, writeFill } from "./lib/weekly-fill.js";

loadEnv();
const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const useAi = argv.includes("--ai");

try {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  let timeZone = "UTC";
  try {
    timeZone = assertTimeZone(process.env.TZ_CREATOR);
  } catch {
    /* UTC fallback, same as weekly-batch */
  }
  const raw = arg(argv, "week");
  const week = raw === undefined ? nextWeekStart(new Date(), timeZone) : weekOf(raw);
  if (!week) throw new Error("--week must be a date (YYYY-MM-DD)");
  const { createPool } = await import("../../packages/db/src/client.js");
  const pool = createPool(process.env.DATABASE_URL);
  pool.on("error", () => {});
  const client = await pool.connect();
  try {
    const now = new Date();
    const blocklist = blocklistFromEnv();
    const items = await loadRecaptionItems(client, week, timeZone);
    const recent = await loadRecentCaptions(client, now, items.map((i) => i.id));
    const apiKey = useAi ? process.env.ANTHROPIC_API_KEY?.trim() || undefined : undefined;
    if (useAi && !apiKey) console.log("recaption: --ai given but ANTHROPIC_API_KEY is not set, using templates");
    const rows = await planRecaption(
      items,
      recent,
      (i) => composeCaption(i, { apiKey, db: client, now, blocklist, log: (l) => console.log(l) }),
      { blocklist },
    );
    const table = formatRecaptionTable(rows);
    const changes = rows.filter((r) => r.caption);
    const hand = rows.filter((r) => r.source === "none").length;
    let written = 0;
    if (apply && changes.length) {
      const entries = changes.map((r) => ({ id: r.id, caption: r.caption! }));
      const check = checkFill(entries, await loadFillTargets(client, entries.map((e) => e.id)), { blocklist });
      if (!check.ok) throw new Error(`${check.errors} error(s) in the new captions, nothing written`);
      written = (await writeFill(client, entries, { blocklist })).written;
    }
    const log = writeLog("recaption", `# recaption week of ${week}${apply ? " --apply" : ""}\n\n\`\`\`\n${table}\n\`\`\`\n`);
    console.log(table);
    console.log(
      `recaption: OK week of ${week}: ${items.length} draft(s), ${changes.length} to recaption, ${hand} need a hand, ${apply ? `wrote ${written}; still drafts, approve on the phone` : "nothing written (dry run); re-run with --apply"} → ${log}`,
    );
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
} catch (err) {
  console.log(`recaption: FAIL ${(err as Error).message}`);
  process.exit(1);
}
