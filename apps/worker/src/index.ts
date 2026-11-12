import { CAPABILITIES } from "@autopilot/core";
import { createPool } from "@autopilot/db";
import { createQueue } from "./queue.js";
import { registerHealthJob } from "./jobs/health.js";
import { registerOutboxJob } from "./jobs/register-outbox.js";
import { registerTokenHealthJob, tokenHealthConfigFromEnv } from "./jobs/token-health.js";
import { credentialsFromEnv } from "@autopilot/adapters";

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

const dryRun = process.env.DRY_RUN !== "false";
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

const configured = (["instagram", "youtube", "tiktok"] as const).filter((p) => credentials[p]);
console.log(`worker started · dry_run=${dryRun} · platforms=${Object.keys(CAPABILITIES).join(",")} · adapters=${configured.join(",") || "none"}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await boss.stop();
    await pool.end();
    process.exit(0);
  });
}
