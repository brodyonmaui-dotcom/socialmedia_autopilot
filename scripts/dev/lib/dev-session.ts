import { assertLocalDatabaseUrl } from "./seed.js";

/**
 * dev:session mints a real login session, so it must never run against production:
 * refuses NODE_ENV=production and any non-local database URL. (On the laptop localhost:5433 is
 * the SSH tunnel to production, so the CLI also refuses a target holding real media.)
 */
export function assertDevSessionAllowed(env: Record<string, string | undefined>): string {
  if (env.NODE_ENV === "production") throw new Error("dev:session: refusing in production");
  const url = env.DATABASE_URL;
  assertLocalDatabaseUrl(url);
  return url as string;
}
