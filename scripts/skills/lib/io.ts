import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** CLAUDE.md working rule: details go to logs/ (gitignored), the terminal gets one line. */
export function writeLog(name: string, body: string, now = new Date()): string {
  mkdirSync("logs", { recursive: true });
  const path = join("logs", `${name}-${now.toISOString().slice(0, 10)}.md`);
  writeFileSync(path, body);
  return path;
}

export function arg(argv: string[], key: string): string | undefined {
  const i = argv.indexOf(`--${key}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function loadEnv(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");
}
