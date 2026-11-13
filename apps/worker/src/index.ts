import { CAPABILITIES } from "@autopilot/core";
import { createPool } from "@autopilot/db";
import { createQueue } from "./queue.js";
import { resolveRunMode } from "./run-mode.js";
import { registerHealthJob } from "./jobs/health.js";
import { registerOutboxJob } from "./jobs/register-outbox.js";
import { registerTokenHealthJob, tokenHealthConfigFromEnv } from "./jobs/token-health.js";
import { analyticsSourcesFromEnv, analyticsStartupLine, registerAnalyticsIngestJob } from "./jobs/analytics-ingest.js";
import { buildCommentSources, commentCredentialsFromEnv, createInstagramDmSource, credentialsFromEnv } from "@autopilot/adapters";
import { killEnvFromEnv } from "@autopilot/engagement";
import { PgEngagementStore } from "./jobs/engagement-store.js";
import { blocklistFromEnv, engagementStartupLine, registerEngagementJobs, triageClientFromEnv } from "./jobs/register-engagement.js";

if (process.env.NODE_ENV !== "production") {
  const { existsSync } = await import("node:fs");
  if (existsSync(".env")) process.loadEnvFile(".env");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const boss = createQueue(databaseUrl);
const pool = createPool(databaseUrl);
await boss.start();
await registerHealthJob(boss);

// One decision for the whole worker: live only with DRY_RUN=false AND the live key (see run-mode.ts).
const runMode = resolveRunMode(process.env, process.argv);
if (runMode.reason) console.log(runMode.reason);
const dryRun = runMode.dryRun;
const live = runMode.live;
const credentials = credentialsFromEnv(process.env);
const timeZone = process.env.TZ_CREATOR; // .env only, never committed; required for a live run
if (!timeZone) {
  if (!dryRun) {
    console.error("TZ_CREATOR is not set: refusing a live outbox (daily caps are per creator-local day)");
    process.exit(1);
  }
  console.log("[outbox] TZ_CREATOR not set: dry-run counts cap days in UTC");
}
await registerOutboxJob(boss, pool, {
  dryRun,
  timeZone,
  publicMediaBase: process.env.PUBLIC_MEDIA_BASE ?? "",
  credentials,
});
await registerTokenHealthJob(boss, pool, tokenHealthConfigFromEnv(process.env));
// Analytics ingest (F9): read-only, so it runs regardless of DRY_RUN / the live key.
const analyticsCfg = analyticsSourcesFromEnv(process.env);
await registerAnalyticsIngestJob(boss, pool, analyticsCfg);

// Engagement (F3): same run mode as the outbox.
const commentCreds = commentCredentialsFromEnv(process.env);
const commentSources = buildCommentSources(commentCreds);
const dmSource = commentCreds.instagram ? createInstagramDmSource(commentCreds.instagram) : null;
const triage = triageClientFromEnv(process.env);
await registerEngagementJobs(boss, pool, {
  sources: commentSources,
  dmSource,
  igUserId: commentCreds.instagram?.igUserId ?? null,
  triage,
  dmTriage: process.env.ANTHROPIC_API_KEY?.trim() ? triage : null,
  blocklist: blocklistFromEnv(process.env),
  dryRun,
  live,
});
const engagementSettings = await new PgEngagementStore(pool).loadSettings();

const configured = (["instagram", "youtube", "tiktok"] as const).filter((p) => credentials[p]);
console.log(`worker started · dry_run=${dryRun} · platforms=${Object.keys(CAPABILITIES).join(",")} · adapters=${configured.join(",") || "none"}`);
console.log(analyticsStartupLine(analyticsCfg));
console.log(`${engagementStartupLine(engagementSettings, live, killEnvFromEnv(process.env))} · comment sources=${[...commentSources.keys()].join(",") || "none"} · dm=${dmSource ? "read-only" : "none"}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await boss.stop();
    await pool.end();
    process.exit(0);
  });
}
