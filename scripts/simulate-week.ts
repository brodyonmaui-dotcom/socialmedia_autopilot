// pnpm simulate-week [--tz <IANA zone>] [--week YYYY-MM-DD] [--days 7] [--slots 4]
// Full 7-day × 4-slot dry run of the scheduler + outbox over fakes: no network, no DB, nothing posted.
// Prints one line (OK/FAIL) and writes logs/simulate-week.json; exits 1 on any double-post, cap breach
// or failed invariant. The zone comes from --tz, else TZ_CREATOR (.env), else a labelled fixture zone.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { simulateWeek } from "../packages/core/src/sim/simulate-week.js";
import { assertTimeZone } from "../packages/core/src/time.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** Fixture zone when TZ_CREATOR isn't set (CI, cloud sessions): observes DST, says nothing about the creator. */
const FIXTURE_ZONE = "Europe/London";
const fromEnv = process.env.TZ_CREATOR;
const timeZone = assertTimeZone(arg("tz") ?? fromEnv ?? FIXTURE_ZONE, "--tz");
const zoneNote = arg("tz") ? "zone from --tz" : fromEnv ? "zone from TZ_CREATOR" : `fixture zone ${FIXTURE_ZONE} (TZ_CREATOR not set)`;

const report = await simulateWeek({
  timeZone,
  weekStart: arg("week"),
  days: arg("days") ? Number(arg("days")) : undefined,
  cadence: arg("slots") ? { slotsPerDay: Number(arg("slots")) } : undefined,
  keepLog: true,
});

mkdirSync("logs", { recursive: true });
const out = "logs/simulate-week.json";
writeFileSync(out, JSON.stringify({ ...report, zoneNote, finalPosts: report.finalPosts.map((p) => ({ id: p.id, status: p.status, attempts: p.attempts, scheduledFor: p.scheduledFor, lastError: p.lastError })) }, null, 2));
console.log(`${report.summary} · ${zoneNote} · details ${out}`);
process.exit(report.ok ? 0 : 1);
