import { CAPABILITIES } from "@autopilot/core";
import { createQueue } from "./queue.js";
import { registerHealthJob } from "./jobs/health.js";

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
await boss.start();
await registerHealthJob(boss);

console.log(`worker started · dry_run=${process.env.DRY_RUN ?? "true"} · platforms=${Object.keys(CAPABILITIES).join(",")}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await boss.stop();
    process.exit(0);
  });
}
