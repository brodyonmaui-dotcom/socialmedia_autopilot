import { existsSync } from "node:fs";
import { createPool } from "@autopilot/db";
import type { Pool } from "pg";

// Local dev runs `next dev` from apps/web, so the monorepo root .env isn't picked up automatically.
const rootEnv = "../../.env";
if (process.env.NODE_ENV !== "production" && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

let pool: Pool | undefined;

/** One pool per process — Next.js dev-mode module reloads would otherwise leak connections. */
export function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is not set");
    pool = createPool(databaseUrl);
  }
  return pool;
}
