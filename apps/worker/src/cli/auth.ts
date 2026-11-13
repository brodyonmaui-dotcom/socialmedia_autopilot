// Server-side auth admin: `pnpm auth:enroll` mints a one-time enrol code; `pnpm auth:revoke-all`
// signs out every device and revokes every passkey. Run on the VPS via
// `docker compose run --rm worker pnpm auth:enroll`.
import { createEnrollCode, createPool, revokeAllAuth } from "@autopilot/db";

if (process.env.NODE_ENV !== "production") {
  const { existsSync } = await import("node:fs");
  // pnpm --filter runs this from apps/worker; the .env lives at the monorepo root.
  for (const file of [".env", "../../.env"]) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      break;
    }
  }
}

const command = process.argv[2];
if (command !== "enroll" && command !== "revoke-all") {
  console.error("usage: tsx src/cli/auth.ts enroll|revoke-all");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (see .env.example)");
  process.exit(1);
}

const pool = createPool(databaseUrl);
let exitCode = 0;
try {
  if (command === "enroll") {
    const { code } = await createEnrollCode(pool);
    console.log(`Enrol code (valid 15 min, single use): ${code}`);
    console.log(`Open /app/login on the phone → "Add this device".`);
  } else {
    const { sessions, credentials } = await revokeAllAuth(pool);
    console.log(`Revoked ${sessions} session(s) and ${credentials} passkey(s). Run auth:enroll to add a device again.`);
  }
} catch (err) {
  exitCode = 1;
  const code = (err as { code?: string }).code;
  if (code === "42P01") console.error("auth tables missing: apply migration 0006 (docs/runbooks/migrations.md)");
  else console.error(`auth ${command} failed: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await pool.end();
}
process.exit(exitCode);
