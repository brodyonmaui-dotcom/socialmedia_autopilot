// pnpm preflight [--facts <file>] [--tracked <file>] [--audit] [--root <dir>]
// Go-live preflight (F13 T1): one PASS/WARN/FAIL line per check, then a summary line; exit 1 iff any
// FAIL. Read-only and never prints an env value. On the VPS run ./infra/preflight.sh, which gathers
// the DB facts and the newest backup key inside the compose stack and passes them via --facts.
// Without --facts the script queries DATABASE_URL itself (one read-only statement, see PREFLIGHT_SQL).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  backupKeyToIso,
  dbFactsFromJson,
  exitCodeFor,
  formatLine,
  leakScanFromOutput,
  parseAudit,
  redactValues,
  REPO_FILES,
  runChecks,
  summaryLine,
  type DbFacts,
  type PreflightInput,
  type RepoFacts,
} from "./lib/preflight.js";
import { readDbFacts } from "./lib/preflight-db.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const root = resolve(arg("root") ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const readText = (rel: string): string | undefined => {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch {
    return undefined;
  }
};

async function main(): Promise<number> {
  const env = process.env as Record<string, string | undefined>;

  // ---- DB facts + newest backup ----
  let db: DbFacts | null = null;
  let lastBackupAt: string | null = null;
  const factsPath = arg("facts");
  if (factsPath) {
    try {
      const facts = JSON.parse(readFileSync(factsPath, "utf8")) as { db?: unknown; backupKey?: string | null };
      db = facts.db ? dbFactsFromJson(facts.db) : null;
      lastBackupAt = backupKeyToIso(facts.backupKey);
    } catch {
      db = null; // unreadable facts file: report as unreachable, never a stack trace
    }
  } else if (env.DATABASE_URL) {
    db = await readDbFacts(env.DATABASE_URL);
  }

  // ---- repo facts ----
  const migrationsDir = join(root, "packages/db/migrations");
  const expectedMigrations = existsSync(migrationsDir) ? readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort() : [];
  const files: RepoFacts["files"] = {};
  for (const rel of Object.values(REPO_FILES)) files[rel] = readText(rel);

  const scan = spawnSync(process.execPath, [join(root, "scripts/check-public-leaks.mjs"), "--root", root], { encoding: "utf8" });
  const leakScan = scan.error || scan.status === null ? null : leakScanFromOutput(scan.status, scan.stdout);

  let trackedFiles: string[] | null = null;
  const trackedPath = arg("tracked");
  if (trackedPath) {
    try {
      trackedFiles = readFileSync(trackedPath, "utf8").split(/\r?\n/).filter(Boolean);
    } catch {
      trackedFiles = null;
    }
  } else {
    const git = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
    trackedFiles = git.error || git.status !== 0 ? null : git.stdout.split(/\r?\n/).filter(Boolean);
  }

  let audit: RepoFacts["audit"];
  if (argv.includes("--audit")) {
    const a = spawnSync("pnpm", ["audit", "--prod", "--json"], { cwd: root, encoding: "utf8", timeout: 60_000 });
    audit = a.error ? null : parseAudit(a.stdout ?? "");
  }

  const input: PreflightInput = {
    env,
    appliedMigrations: db?.appliedMigrations ?? null,
    expectedMigrations,
    passkeyCount: db?.passkeyCount ?? null,
    settings: db?.settings ?? {},
    lastBackupAt,
    researchLog: readText("docs/research.md") ?? "",
    now: new Date(),
    repo: { files, leakScan, trackedFiles, audit },
  };
  const results = runChecks(input);
  for (const r of results) console.log(redactValues(formatLine(r), env));
  console.log(summaryLine(results));
  return exitCodeFor(results);
}

try {
  process.exitCode = await main();
} catch (err) {
  // Never a stack trace (it could carry a connection string): one line, error class only.
  console.log(`FAIL preflight: internal error (${err instanceof Error ? err.name : "unknown"}) -> rerun, then check logs`);
  console.log("preflight: 0 pass · 0 warn · 1 fail");
  process.exitCode = 1;
}
