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

// ---- Shape-only output (F9 T1): key paths + JSON types, never values, ids or names. ----

type ShapeEntry = { types: Set<string>; opt: boolean };
type ShapeMap = Map<string, ShapeEntry>;

/** Keys that look like data themselves (numeric ids, long keys, anything not identifier-like) collapse to `<key>`. */
function safeKey(k: string): string {
  return /^\d+$/.test(k) || k.length > 40 || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(k) ? "<key>" : k;
}
const joinShape = (head: string, rel: string): string => (rel === "" ? head : rel.startsWith("[]") ? head + rel : `${head}.${rel}`);
function add(into: ShapeMap, path: string, e: ShapeEntry): void {
  const cur = into.get(path);
  if (!cur) into.set(path, { types: new Set(e.types), opt: e.opt });
  else {
    for (const t of e.types) cur.types.add(t);
    cur.opt ||= e.opt;
  }
}
function walk(v: unknown, depth: number): ShapeMap {
  const out: ShapeMap = new Map();
  const leaf = (t: string) => out.set("", { types: new Set([t]), opt: false });
  if (v === null) leaf("null");
  else if (Array.isArray(v)) {
    if (v.length === 0) leaf("array(empty)");
    else if (depth > 20) leaf("array(deep)");
    else {
      const seen = new Map<string, number>();
      const merged: ShapeMap = new Map();
      for (const el of v) {
        for (const [p, e] of walk(el, depth + 1)) {
          add(merged, p, e);
          seen.set(p, (seen.get(p) ?? 0) + 1);
        }
      }
      for (const [p, e] of merged) add(out, joinShape("[]", p), { types: e.types, opt: e.opt || (seen.get(p) ?? 0) < v.length });
    }
  } else if (typeof v === "object") {
    const keys = Object.keys(v as object);
    if (keys.length === 0) leaf("object(empty)");
    else if (depth > 20) leaf("object(deep)");
    else for (const k of keys) for (const [p, e] of walk((v as Record<string, unknown>)[k], depth + 1)) add(out, joinShape(safeKey(k), p), e);
  } else leaf(typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? typeof v : "other");
  return out;
}

/**
 * Comma-joined, sorted, de-duplicated `path:type` for every leaf (`a[].b:number`). Keys missing in some
 * array elements get `?`; mixed types join with `|`. Values are never output. Capped at `maxLen` chars.
 */
export function shapeOf(value: unknown, opts: { maxLen?: number } = {}): string {
  const maxLen = opts.maxLen ?? 1500;
  const parts = [...walk(value, 0)]
    .map(([p, e]) => `${p === "" ? "$" : p}:${[...e.types].sort().join("|")}${e.opt ? "?" : ""}`)
    .sort();
  let out = "";
  for (const [i, part] of parts.entries()) {
    const next = out ? `${out},${part}` : part;
    if (next.length > maxLen) return `${out}…+${parts.length - i} more`;
    out = next;
  }
  return out;
}

/** One probe line from a read response: PASS with the body's shape, or FAIL with HTTP status, error code and a short, redacted message (long digit runs → `<id>`). */
export function shapeNote(status: number, body: unknown): { ok: boolean; note: string } {
  if (status === 200 && body && typeof body === "object") return { ok: true, note: shapeOf(body) };
  const err = (body as any)?.error;
  const code = err?.code ?? err?.errors?.[0]?.reason ?? "?";
  const msg = typeof err?.message === "string" ? err.message : typeof body === "string" ? "non-JSON body" : "";
  return { ok: false, note: redact(`HTTP ${status} code ${code}${msg ? `: ${msg.replace(/\d{6,}/g, "<id>").slice(0, 200)}` : ""}`) };
}
