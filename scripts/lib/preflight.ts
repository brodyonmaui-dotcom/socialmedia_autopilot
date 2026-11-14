// Go-live preflight (F13 T1): pure core. No console, no process.env reads, no network, no file reads:
// the CLI (scripts/preflight.ts) or the VPS wrapper (infra/preflight.sh) gathers every fact and passes
// it in. Each check reports env NAMES only, never a value; formatLine/redactValues are the last guard.
import { assertTimeZone, normalizeCadence } from "../../packages/core/src/index.js";
import { credentialsFromEnv } from "../../packages/adapters/src/registry.js";
import { isValidMediaBase } from "../../apps/worker/src/jobs/outbox.js";
import { resolveRunMode } from "../../apps/worker/src/run-mode.js";

export type CheckStatus = "PASS" | "WARN" | "FAIL";
export interface CheckResult {
  id: string;
  status: CheckStatus;
  summary: string;
  /** Required on FAIL: the exact command or runbook to run next. */
  next?: string;
}

export interface AuditSummary {
  info: number;
  low: number;
  moderate: number;
  high: number;
  critical: number;
}

/** Repo facts for the pre-launch security checks. Absent → those checks are skipped. */
export interface RepoFacts {
  /** Repo-relative path → file text (missing file = undefined). Keys: see REPO_FILES. */
  files: Record<string, string | undefined>;
  /** scripts/check-public-leaks.mjs result; null = the scanner could not run. */
  leakScan: { ok: boolean; files: string[] } | null;
  /** `git ls-files`; null = git not available here. */
  trackedFiles: string[] | null;
  /** undefined = audit not requested (--audit); null = requested but it failed to run (offline). */
  audit?: AuditSummary | null;
}

export interface PreflightInput {
  env: Record<string, string | undefined>; // names only are reported, never values
  appliedMigrations: string[] | null; // null = DB unreachable
  expectedMigrations: string[]; // file names in packages/db/migrations
  passkeyCount: number | null;
  settings: { cadence?: unknown; restoreDrillAt?: string };
  lastBackupAt: string | null; // ISO, from the wrapper; null = unknown
  researchLog: string; // text of docs/research.md
  now: Date;
  repo?: RepoFacts;
}

/** Files the static checks read (the CLI reads exactly these, relative to the repo root). */
export const REPO_FILES = {
  session: "apps/web/lib/auth/session.ts",
  authConfig: "apps/web/lib/auth/config.ts",
  requireAuth: "apps/web/lib/auth/require.ts",
  rateLimit: "apps/web/lib/auth/rate-limit.ts",
  webauthn: "apps/web/lib/auth/webauthn.ts",
  loginActions: "apps/web/app/login/actions.ts",
  caddyfile: "infra/Caddyfile",
  nextConfig: "apps/web/next.config.mjs",
} as const;

/**
 * The preflight's only SQL: one read-only statement returning one JSON row. infra/preflight.sh runs
 * the same text through psql (a test keeps the two identical).
 */
export const PREFLIGHT_SQL =
  "select json_build_object('migrations', (select coalesce(json_agg(id order by id), '[]'::json) from schema_migrations), 'passkeys', (select count(*) from auth_credentials where revoked_at is null), 'settings', (select coalesce(json_object_agg(key, value), '{}'::json) from settings where key in ('cadence', 'posting_windows', 'restore_drill_at'))) as facts";

export interface DbFacts {
  appliedMigrations: string[];
  passkeyCount: number;
  settings: PreflightInput["settings"];
}

/** Shapes the PREFLIGHT_SQL row (or the wrapper's psql output) into PreflightInput fields; cadence merged like loadCadence. */
export function dbFactsFromJson(raw: unknown): DbFacts {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (o.settings && typeof o.settings === "object" ? o.settings : {}) as Record<string, unknown>;
  const overrides = s.cadence && typeof s.cadence === "object" ? (s.cadence as Record<string, unknown>) : {};
  const windows = Array.isArray(s.posting_windows) && s.posting_windows.length ? { windows: s.posting_windows } : {};
  const settings: PreflightInput["settings"] = { cadence: { ...overrides, ...windows } };
  if (typeof s.restore_drill_at === "string") settings.restoreDrillAt = s.restore_drill_at;
  return {
    appliedMigrations: Array.isArray(o.migrations) ? o.migrations.map(String) : [],
    passkeyCount: Number(o.passkeys ?? 0),
    settings,
  };
}

/** `autopilot-20261114T030000Z.sql.gz` (infra/backup.sh) → ISO, else null. */
export function backupKeyToIso(key: string | null | undefined): string | null {
  const m = /autopilot-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(key ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/** `pnpm audit --prod --json` stdout → counts by severity, or null when it isn't an audit report. */
export function parseAudit(stdout: string): AuditSummary | null {
  try {
    const v = (JSON.parse(stdout) as { metadata?: { vulnerabilities?: Record<string, unknown> } }).metadata?.vulnerabilities;
    if (!v || typeof v !== "object") return null;
    const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : 0);
    return { info: n("info"), low: n("low"), moderate: n("moderate"), high: n("high"), critical: n("critical") };
  } catch {
    return null;
  }
}

/** `file:line: rule` lines from the leak scanner → unique file names (it never prints the matched text). */
export function leakScanFromOutput(code: number | null, stdout: string): { ok: boolean; files: string[] } {
  const files = [...new Set(stdout.split(/\r?\n/).map((l) => /^(.+?):\d+: [\w-]+$/.exec(l)?.[1]).filter((f): f is string => !!f))];
  return { ok: code === 0, files };
}

// ---------------------------------------------------------------------------------------------
// env names

/**
 * Adapter env names, derived from credentialsFromEnv itself (not a copied list): every name it reads,
 * and which of them a platform needs (dropping it unconfigures the platform; e.g. META_GRAPH_VERSION doesn't).
 */
export function adapterEnvNames(): { all: string[]; required: string[] } {
  const seen = new Set<string>();
  const filled = new Proxy({} as Record<string, string | undefined>, {
    get(_t, k) {
      if (typeof k === "string") seen.add(k);
      return "x";
    },
  });
  const configured = (c: ReturnType<typeof credentialsFromEnv>) => [!!c.instagram, !!c.youtube, !!c.tiktok].join();
  const full = configured(credentialsFromEnv(filled));
  const all = [...seen];
  const required = all.filter((name) => {
    const env: Record<string, string | undefined> = Object.fromEntries(all.map((n) => [n, n === name ? undefined : "x"]));
    return configured(credentialsFromEnv(env)) !== full;
  });
  return { all, required };
}

const CORE_REQUIRED = ["DATABASE_URL", "PUBLIC_MEDIA_BASE", "TZ_CREATOR", "DRY_RUN"];
const VAPID = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
const set = (env: PreflightInput["env"], k: string) => typeof env[k] === "string" && env[k]!.trim() !== "";

export function requiredEnvNames(): string[] {
  return [...CORE_REQUIRED, ...adapterEnvNames().required];
}

// ---------------------------------------------------------------------------------------------
// checks

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DB_NEXT = "check DATABASE_URL in .env, then `docker compose ps db` (infra/)";
const ageText = (ms: number) => (ms < 2 * DAY ? `${Math.round(ms / HOUR)} h` : `${Math.round(ms / DAY)} d`);
const pass = (id: string, summary: string): CheckResult => ({ id, status: "PASS", summary });
const warn = (id: string, summary: string, next?: string): CheckResult => ({ id, status: "WARN", summary, ...(next ? { next } : {}) });
const fail = (id: string, summary: string, next: string): CheckResult => ({ id, status: "FAIL", summary, next });

function checkEnv(env: PreflightInput["env"]): CheckResult {
  const missing = requiredEnvNames().filter((k) => !set(env, k));
  return missing.length ? fail("env", `not set: ${missing.join(", ")}`, "add them to .env (see .env.example), then restart the stack") : pass("env", `${requiredEnvNames().length} required names set`);
}

function checkMediaBase(env: PreflightInput["env"]): CheckResult {
  return isValidMediaBase(env.PUBLIC_MEDIA_BASE)
    ? pass("media-base", "PUBLIC_MEDIA_BASE is an absolute https URL")
    : fail("media-base", "PUBLIC_MEDIA_BASE missing or invalid (https, no query, no credentials)", "fix it in .env, then `docker compose up -d worker` (infra/)");
}

function checkTz(env: PreflightInput["env"]): CheckResult {
  try {
    assertTimeZone(env.TZ_CREATOR?.trim() || undefined);
    return pass("tz", "TZ_CREATOR is a valid IANA zone");
  } catch {
    return fail("tz", set(env, "TZ_CREATOR") ? "TZ_CREATOR is not a valid IANA zone" : "TZ_CREATOR not set", "set TZ_CREATOR in .env (IANA Area/City)");
  }
}

function checkMigrations(i: PreflightInput): CheckResult {
  if (i.appliedMigrations === null) return fail("migrations", "database unreachable", DB_NEXT);
  const applied = new Set(i.appliedMigrations);
  const missing = i.expectedMigrations.filter((f) => !applied.has(f));
  const range = i.expectedMigrations.length ? `${i.expectedMigrations[0]!.slice(0, 4)}-${i.expectedMigrations.at(-1)!.slice(0, 4)}` : "none";
  return missing.length
    ? fail("migrations", `${missing.length} of ${i.expectedMigrations.length} not applied: ${missing.join(", ")}`, "docs/runbooks/migrations.md")
    : pass("migrations", `${range} applied`);
}

function checkPasskey(i: PreflightInput): CheckResult {
  if (i.passkeyCount === null) return fail("passkey", "database unreachable", DB_NEXT);
  return i.passkeyCount >= 1 ? pass("passkey", `${i.passkeyCount} enrolled`) : fail("passkey", "none enrolled", "docs/runbooks/login.md");
}

function checkRunMode(env: PreflightInput["env"]): CheckResult {
  const mode = resolveRunMode(env, []);
  if (mode.live) return warn("run-mode", "LIVE: DRY_RUN=false and WORKER_LIVE=1, approved posts publish for real", "switch back after the first-real-post check (DRY_RUN=true)");
  return pass("run-mode", mode.reason ? "dry-run: nothing publishes (only one of the two live keys is set)" : "dry-run: nothing publishes");
}

function checkVapid(env: PreflightInput["env"]): CheckResult {
  const missing = VAPID.filter((k) => !set(env, k));
  return missing.length ? warn("vapid", `push alerts off, not set: ${missing.join(", ")}`, "docs/runbooks/alerts-push.md") : pass("vapid", "all three VAPID names set");
}

function checkBackup(i: PreflightInput): CheckResult {
  const t = i.lastBackupAt ? Date.parse(i.lastBackupAt) : NaN;
  if (Number.isNaN(t)) return warn("backup", "newest backup unknown (run via ./infra/preflight.sh on the VPS)", "./infra/preflight.sh");
  const age = i.now.getTime() - t;
  return age < DAY ? pass("backup", `newest backup ${ageText(age)} old`) : fail("backup", `newest backup ${ageText(age)} old (limit 24 h)`, "docs/runbooks/restore.md");
}

function checkRestoreDrill(i: PreflightInput): CheckResult {
  if (i.appliedMigrations === null) return fail("restore-drill", "database unreachable (settings unknown)", DB_NEXT);
  const t = i.settings.restoreDrillAt ? Date.parse(i.settings.restoreDrillAt) : NaN;
  if (Number.isNaN(t)) return fail("restore-drill", "no restore drill recorded", "./infra/restore-test.sh (docs/runbooks/restore.md)");
  return pass("restore-drill", `last drill ${ageText(Math.max(0, i.now.getTime() - t))} ago`);
}

function checkCadence(i: PreflightInput): CheckResult {
  if (i.appliedMigrations === null) return fail("cadence", "database unreachable (settings unknown)", DB_NEXT);
  try {
    const c = normalizeCadence(i.settings.cadence);
    const caps = Object.values(c.dailyCaps).reduce((a, b) => a + b, 0);
    return pass("cadence", `${c.windows.length} windows, ${c.slotsPerDay} slots/day, ${caps} posts/day across caps`);
  } catch (err) {
    return fail("cadence", `settings invalid: ${err instanceof Error ? err.message : "parse error"}`, "fix it in the dashboard Settings page");
  }
}

const PROBE_PLATFORMS: Array<{ key: "ig" | "yt" | "tiktok"; re: RegExp }> = [
  { key: "ig", re: /\b(instagram|ig)\b/i },
  { key: "yt", re: /\b(youtube|yt)\b/i },
  { key: "tiktok", re: /\b(tiktok|zernio)\b/i },
];

/** Newest `(YYYY-MM-DD` in a markdown heading naming the platform (OQ4), or null. */
export function newestProbeDate(researchLog: string, platform: "ig" | "yt" | "tiktok"): Date | null {
  const re = PROBE_PLATFORMS.find((p) => p.key === platform)!.re;
  let best: number | null = null;
  for (const line of researchLog.split(/\r?\n/)) {
    if (!/^#{1,6}\s/.test(line) || !re.test(line)) continue;
    for (const m of line.matchAll(/\((\d{4}-\d{2}-\d{2})/g)) {
      const t = Date.parse(`${m[1]}T00:00:00Z`);
      if (!Number.isNaN(t) && (best === null || t > best)) best = t;
    }
  }
  return best === null ? null : new Date(best);
}

function checkProbeLog(i: PreflightInput): CheckResult[] {
  return PROBE_PLATFORMS.map(({ key }) => {
    const id = `probe-log ${key}`;
    const d = newestProbeDate(i.researchLog, key);
    const next = `./infra/probe.sh ${key}, then log it in docs/research.md`;
    if (!d) return warn(id, "no dated entry in docs/research.md", next);
    const age = i.now.getTime() - d.getTime();
    return age < 30 * DAY ? pass(id, `newest entry ${d.toISOString().slice(0, 10)}`) : warn(id, `newest entry ${Math.floor(age / DAY)} d old (limit 30 d)`, next);
  });
}

// ---- pre-launch security checks (static, read-only) ----

/** True for a tracked path that must never be in git: .env files (not .env.example) and anything under .secrets/. */
export function isForbiddenTracked(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  const base = p.split("/").pop() ?? "";
  if (p.startsWith(".secrets/") || p.includes("/.secrets/")) return true;
  return (base === ".env" || base.startsWith(".env.")) && base !== ".env.example";
}

function checkSecretsGit(r: RepoFacts): CheckResult {
  const tracked = r.trackedFiles?.filter(isForbiddenTracked) ?? [];
  const leaks = r.leakScan?.ok === false ? r.leakScan.files : [];
  if (tracked.length || leaks.length) {
    const parts = [tracked.length ? `tracked secret files: ${tracked.join(", ")}` : "", leaks.length ? `leak scan hits in: ${leaks.join(", ")}` : ""].filter(Boolean);
    return fail("secrets-git", parts.join("; "), tracked.length ? "git rm --cached <file>, rotate what it held" : "node scripts/check-public-leaks.mjs");
  }
  if (!r.leakScan || !r.trackedFiles) return warn("secrets-git", `${!r.leakScan ? "leak scanner" : "git ls-files"} did not run here`, "node scripts/check-public-leaks.mjs && git ls-files");
  return pass("secrets-git", "leak scan ok, no .env or secrets folder tracked");
}

/** Body of `function <name>(` up to the next top-level `export` (good enough for these hand-written files). */
function fnBody(src: string, name: string): string | null {
  const i = src.search(new RegExp(`function\\s+${name}\\s*\\(`));
  if (i < 0) return null;
  const rest = src.slice(i + 1);
  const j = rest.search(/\nexport\s/);
  return j < 0 ? rest : rest.slice(0, j);
}

function checkSessionCookie(r: RepoFacts): CheckResult {
  const body = fnBody(r.files[REPO_FILES.session] ?? "", "sessionCookieOptions");
  const next = REPO_FILES.session;
  if (!body) return fail("session-cookie", "sessionCookieOptions not found", next);
  const ret = /return\s*\{([\s\S]*?)\}/.exec(body)?.[1] ?? "";
  const missing: string[] = [];
  if (!/\bhttpOnly\s*:\s*true\b/.test(ret)) missing.push("httpOnly");
  if (!/\bsecure\b/.test(ret)) missing.push("secure");
  if (!/\bsameSite\s*:\s*["'](lax|strict)["']/i.test(ret)) missing.push("sameSite lax|strict");
  if (!/\bpath\s*:\s*["']\/[^"'\s]+["']/.test(ret)) missing.push("path (scoped, not /)");
  // secure must be on in production: DOMAIN set → secureCookie true, and the cookie setter uses it.
  if (!/if\s*\(\s*domain\s*\)[^\n]*secureCookie\s*:\s*true/.test(r.files[REPO_FILES.authConfig] ?? "")) missing.push("secure in production (config.ts)");
  if (!/sessionCookieOptions\(\s*authConfigFromEnv\(\)\.secureCookie\s*\)/.test(r.files[REPO_FILES.requireAuth] ?? "")) missing.push("setter uses sessionCookieOptions (require.ts)");
  return missing.length ? fail("session-cookie", `missing: ${missing.join(", ")}`, next) : pass("session-cookie", "httpOnly, secure in production, sameSite, path scoped");
}

function checkLoginRateLimit(r: RepoFacts): CheckResult {
  const rl = r.files[REPO_FILES.rateLimit] ?? "";
  const wa = r.files[REPO_FILES.webauthn] ?? "";
  const actions = r.files[REPO_FILES.loginActions] ?? "";
  const missing: string[] = [];
  if (!/export\s+const\s+MAX_FAILURES\s*=\s*10\b/.test(rl)) missing.push("MAX_FAILURES = 10");
  if (!/export\s+const\s+FAILURE_WINDOW_MS\s*=\s*(15\s*\*\s*60_?000|15\s*\*\s*60\s*\*\s*1_?000|900_?000)\b/.test(rl)) missing.push("FAILURE_WINDOW_MS = 15 min");
  if (!/export\s+async\s+function\s+assertNotRateLimited\b/.test(rl)) missing.push("assertNotRateLimited");
  if (!/export\s+async\s+function\s+recordAuthFailure\b/.test(rl)) missing.push("recordAuthFailure");
  for (const fn of ["beginLogin", "finishLogin"]) {
    if (!/assertNotRateLimited\s*\(/.test(fnBody(wa, fn) ?? "")) missing.push(`${fn} calls assertNotRateLimited`);
  }
  if (!/recordAuthFailure\s*\(/.test(wa)) missing.push("webauthn records failures");
  for (const fn of ["beginLogin", "finishLogin"]) {
    if (!new RegExp(`\\b${fn}\\s*\\(`).test(actions) || !new RegExp(`import[^;]*\\b${fn}\\b[^;]*from\\s*["'][^"']*auth/webauthn`).test(actions)) missing.push(`login actions call ${fn}`);
  }
  return missing.length ? fail("login-rate-limit", `missing: ${missing.join(", ")}`, REPO_FILES.rateLimit) : pass("login-rate-limit", "10 failures / 15 min, wired into login actions");
}

const HEADERS: Array<[string, RegExp]> = [
  ["Strict-Transport-Security", /Strict-Transport-Security/i],
  ["X-Content-Type-Options nosniff", /X-Content-Type-Options["'\s:,]+(value\s*:\s*)?["']?nosniff/i],
  ["Referrer-Policy", /Referrer-Policy/i],
  ["X-Frame-Options or CSP frame-ancestors", /X-Frame-Options|frame-ancestors/i],
];

function checkSecurityHeaders(r: RepoFacts): CheckResult {
  const text = `${r.files[REPO_FILES.caddyfile] ?? ""}\n${r.files[REPO_FILES.nextConfig] ?? ""}`;
  const missing = HEADERS.filter(([, re]) => !re.test(text)).map(([n]) => n);
  return missing.length
    ? warn("security-headers", `missing: ${missing.join(", ")}`, `${REPO_FILES.caddyfile} header block`)
    : pass("security-headers", "HSTS, nosniff, Referrer-Policy, frame restriction set");
}

/** Top-level site blocks of a Caddyfile: address line + body. The global options block `{` has address "". */
export function caddySites(src: string): Array<{ address: string; body: string }> {
  const lines = src.replace(/#[^\n]*/g, "").split(/\r?\n/);
  const out: Array<{ address: string; body: string }> = [];
  let depth = 0;
  let cur: { address: string; body: string } | null = null;
  for (const line of lines) {
    const bare = line.replace(/\{[$a-z][^{}\s]*\}/gi, "_"); // placeholders like {$DOMAIN}, {host} aren't blocks
    const realOpens = (bare.match(/\{/g) ?? []).length;
    const realCloses = (bare.match(/\}/g) ?? []).length;
    if (depth === 0 && realOpens > 0) {
      cur = { address: line.slice(0, line.lastIndexOf("{")).trim(), body: "" };
    } else if (cur) cur.body += `${line}\n`;
    depth += realOpens - realCloses;
    if (depth <= 0 && cur && realCloses > 0) {
      out.push({ address: cur.address, body: cur.body.replace(/\}\s*$/, "") }); // drop the closing brace line
      cur = null;
      depth = 0;
    }
  }
  return out;
}

function checkHttps(r: RepoFacts, env: PreflightInput["env"]): CheckResult {
  const src = r.files[REPO_FILES.caddyfile];
  const next = REPO_FILES.caddyfile;
  if (src === undefined) return fail("https", "infra/Caddyfile not found", next);
  const sites = caddySites(src);
  const problems: string[] = [];
  const global = sites.find((s) => s.address === "");
  if (global && /\bauto_https\s+(off|disable_certs)\b/.test(global.body)) problems.push("auto_https disabled");
  const named = sites.filter((s) => s.address !== "");
  if (!named.some((s) => s.address.split(/[\s,]+/).some((a) => /^(https:\/\/)?\{\$DOMAIN\}(:443)?$/.test(a)))) problems.push("no site block on {$DOMAIN}");
  for (const s of named) {
    const plain = s.address.split(/[\s,]+/).some((a) => /^http:\/\//i.test(a) || /:80$/.test(a));
    const onlyRedirect = s.body.split(/\n/).map((l) => l.trim()).filter(Boolean).every((l) => /^redir\b/.test(l));
    if (plain && !onlyRedirect) problems.push("plain http:// site block serves content");
  }
  if (/\btls\s+internal\b/.test(src)) problems.push("tls internal (self-signed)");
  if (!set(env, "DOMAIN")) problems.push("DOMAIN not set");
  if (set(env, "WEB_ORIGIN") && !/^https:\/\//i.test(env.WEB_ORIGIN!.trim())) problems.push("WEB_ORIGIN is not https://");
  return problems.length ? fail("https", problems.join("; "), `${next} and .env (DOMAIN, WEB_ORIGIN)`) : pass("https", "site on {$DOMAIN} with automatic HTTPS; WEB_ORIGIN https or unset");
}

function checkAudit(r: RepoFacts): CheckResult {
  if (r.audit === undefined) return warn("deps-audit", "audit not run (add --audit)", "pnpm preflight --audit");
  if (r.audit === null) return warn("deps-audit", "audit not run (pnpm audit failed, offline?)", "pnpm audit --prod");
  const a = r.audit;
  const counts = `critical ${a.critical}, high ${a.high}, moderate ${a.moderate}, low ${a.low}`;
  return a.critical + a.high > 0 ? warn("deps-audit", counts, "pnpm audit --prod") : pass("deps-audit", counts);
}

export function runChecks(i: PreflightInput): CheckResult[] {
  const out: CheckResult[] = [
    checkEnv(i.env),
    checkMediaBase(i.env),
    checkTz(i.env),
    checkMigrations(i),
    checkPasskey(i),
    checkRunMode(i.env),
    checkVapid(i.env),
    checkBackup(i),
    checkRestoreDrill(i),
    checkCadence(i),
    ...checkProbeLog(i),
  ];
  if (i.repo) {
    out.push(checkSecretsGit(i.repo), checkSessionCookie(i.repo), checkLoginRateLimit(i.repo), checkSecurityHeaders(i.repo), checkHttps(i.repo, i.env), checkAudit(i.repo));
  }
  return out;
}

export function formatLine(r: CheckResult): string {
  return `${r.status} ${r.id}: ${r.summary}${r.next ? ` -> ${r.next}` : ""}`;
}

export function summaryLine(results: CheckResult[]): string {
  const n = (s: CheckStatus) => results.filter((r) => r.status === s).length;
  return `preflight: ${n("PASS")} pass · ${n("WARN")} warn · ${n("FAIL")} fail`;
}

export function exitCodeFor(results: CheckResult[]): 0 | 1 {
  return results.some((r) => r.status === "FAIL") ? 1 : 0;
}

/** Belt and braces: replaces any env value (>= 6 chars, not a plain flag) that slipped into a line. Pass the real env. */
export function redactValues(line: string, env: PreflightInput["env"]): string {
  let out = line;
  for (const [k, v] of Object.entries(env)) {
    if (/^(npm_|PNPM_|COREPACK_)/i.test(k)) continue; // package-manager bookkeeping (e.g. the script name), not config
    const val = v?.trim();
    if (!val || val.length < 6 || /^(true|false)$/i.test(val)) continue;
    out = out.split(val).join("[redacted]");
  }
  return out;
}
