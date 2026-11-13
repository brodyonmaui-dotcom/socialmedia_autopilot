// Shared helpers for M0 probes. Rules: one-line summaries on stdout, details to logs/,
// secrets never printed, nothing public without --live (and DRY_RUN=false).
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sanitizeForLog } from "../../packages/core/src/log/sanitize.js";

if (existsSync(".env")) process.loadEnvFile(".env");

export const args = new Set(process.argv.slice(2));
export function argValue(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/** True only when both the env switch and the explicit flag allow a real, public action. */
export const LIVE = args.has("--live") && process.env.DRY_RUN === "false";

const SECRET_KEYS = /token|secret|key|password|authorization/i;
const secretValues = Object.entries(process.env)
  .filter(([k, v]) => SECRET_KEYS.test(k) && v && v.length > 8)
  .map(([, v]) => v as string);

/** Env secret values cut out literally first, then the shared shape rules (Bearer, *_token=, EAA…, ya29., 1//…, sk_…, long runs). */
export function redact(text: string): string {
  let out = text;
  for (const s of secretValues) out = out.split(s).join("[REDACTED]");
  out = out.replace(/(access_token=)[^&\s"]+/g, "$1[REDACTED]");
  return sanitizeForLog(out);
}

const logDir = "logs";
mkdirSync(logDir, { recursive: true });
let logFile = "";
export function startLog(name: string): string {
  logFile = join(logDir, `probe-${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  return logFile;
}
export function log(obj: unknown): void {
  if (!logFile) startLog("misc");
  appendFileSync(logFile, redact(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)) + "\n");
}

type Result = { ok: boolean; step: string; note: string };
const results: Result[] = [];
export function record(step: string, ok: boolean, note = ""): void {
  results.push({ step, ok, note });
  log({ step, ok, note });
}
/** Prints one summary line per step and a final line. Exit code 1 if any step failed. */
export function summary(probe: string): never {
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${probe}.${r.step}${r.note ? " — " + redact(r.note) : ""}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${probe}: ${results.length - failed}/${results.length} ok · ${LIVE ? "LIVE" : "dry-run"} · log ${logFile}`);
  process.exit(failed ? 1 : 0);
}

export function need<K extends string>(...names: K[]): Record<K, string> {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.log(`SKIP missing env: ${missing.join(", ")} (see .env.example)`);
    process.exit(2);
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n] as string])) as Record<K, string>;
}

export async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  log({ request: redact(url), method: init.method ?? "GET", status: res.status, body });
  return { status: res.status, body };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
