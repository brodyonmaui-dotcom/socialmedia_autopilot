// Loads the repo's .env for the ingest CLIs.
// `pnpm --filter @autopilot/ingest-agent …` runs with cwd = this package folder, so a plain
// loadEnvFile(".env") misses the repo-root .env. pnpm sets INIT_CWD to where it was started.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function envFilePath(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  return resolve(env.INIT_CWD ?? cwd, ".env");
}

export function loadRepoEnv(): void {
  const file = envFilePath();
  if (existsSync(file)) process.loadEnvFile(file);
}
