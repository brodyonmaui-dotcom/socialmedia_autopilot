import { CAPABILITIES } from "@autopilot/core";
import { createPool } from "@autopilot/db";
import { createQueue } from "./queue.js";
import { registerHealthJob } from "./jobs/health.js";
import { registerOutboxJob } from "./jobs/register-outbox.js";

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
await registerOutboxJob(boss, pool, {
  dryRun,
  publicMediaBase: process.env.PUBLIC_MEDIA_BASE ?? "",
  youtube:
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN
      ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, refreshToken: process.env.YT_REFRESH_TOKEN }
      : undefined,
  tiktok:
    process.env.ZERNIO_API_KEY && process.env.ZERNIO_TIKTOK_ACCOUNT_ID
      ? { apiKey: process.env.ZERNIO_API_KEY, accountId: process.env.ZERNIO_TIKTOK_ACCOUNT_ID }
      : undefined,
});

console.log(`worker started · dry_run=${dryRun} · platforms=${Object.keys(CAPABILITIES).join(",")}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await boss.stop();
    await pool.end();
    process.exit(0);
  });
}
