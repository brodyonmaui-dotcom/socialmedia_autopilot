// weekly-report skill: metrics snapshots → weekly report + trial-share list (markdown in logs/).
//   pnpm skill:weekly-report [--week YYYY-MM-DD] [--demo | --fixture posts.json]
// Without --demo/--fixture it reads the DB (DATABASE_URL). Read-only. Prints one line.
import { readFileSync } from "node:fs";
import { buildWeeklyReport, loadPostRecords, syntheticPosts, type PostRecord } from "../../packages/analytics/src/index.js";
import { arg, loadEnv, writeLog } from "./lib/io.js";

/** Monday of the last complete week (UTC). */
function lastCompleteWeek(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday - 7);
  return d.toISOString().slice(0, 10);
}

loadEnv();
const argv = process.argv.slice(2);
try {
  const weekStart = arg(argv, "week") ?? lastCompleteWeek(new Date());
  const timeZone = process.env.TZ_CREATOR || "UTC";
  let posts: PostRecord[];
  let source: string;
  if (argv.includes("--demo")) {
    posts = syntheticPosts({ weekStart });
    source = "demo data (invented)";
  } else if (arg(argv, "fixture")) {
    posts = JSON.parse(readFileSync(arg(argv, "fixture")!, "utf8"));
    source = "fixture";
  } else {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (or use --demo / --fixture)");
    const { createPool } = await import("../../packages/db/src/client.js");
    const pool = createPool(process.env.DATABASE_URL);
    posts = await loadPostRecords(pool, new Date(Date.parse(weekStart + "T00:00:00Z") - 28 * 86_400_000));
    await pool.end();
    source = "db";
  }
  const r = buildWeeklyReport(posts, { weekStart, timeZone, now: new Date() });
  const note = timeZone === "UTC" && !process.env.TZ_CREATOR ? "\n_TZ_CREATOR not set: time-of-day groups are in UTC._\n" : "";
  const path = writeLog("weekly-report", `${r.markdown}${note}\n_Source: ${source}._\n`, new Date(weekStart + "T00:00:00Z"));
  const share = r.trials.recommendations.filter((t) => t.verdict === "share").length;
  console.log(
    `weekly-report: OK ${weekStart} · ${r.platforms.reduce((a, p) => a + p.posts, 0)} post(s) · ${r.recommendations.length} recommendation(s) · ${share} trial(s) to share · ${r.dataGaps.length} data gap(s) [${source}] → ${path}`,
  );
} catch (err) {
  console.log(`weekly-report: FAIL ${(err as Error).message}`);
  process.exit(1);
}
