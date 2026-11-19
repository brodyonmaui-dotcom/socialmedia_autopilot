import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAPABILITIES } from "../../packages/core/src/index.js";
import { createPool } from "../../packages/db/src/client.js";
import { QUEUES } from "../../apps/worker/src/queue.js";
import { PgOutboxStore } from "../../apps/worker/src/jobs/outbox.js";

// infra/diagnose-posting.sh (the "approved posts didn't go out" script the creator runs on the VPS).
// No Docker here, so: the SQL heredocs are extracted from the script and run against the scratch DB in
// a read-only transaction; the "why not due" label is checked against the real PgOutboxStore.listDue;
// the log prefixes / env names / queue name the script greps for are checked against the source.
const repo = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(repo, "infra/diagnose-posting.sh");
const script = readFileSync(SCRIPT, "utf8");
const src = (p: string) => readFileSync(join(repo, p), "utf8");

function sqlBlocks(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/<<'(SQL_[A-Z0-9_]+)'\n([\s\S]*?)\n\1\n/g)) out.set(m[1]!, m[2] ?? "");
  return out;
}
const blocks = sqlBlocks(script);

/** Runs one shell function from the script (sourced by extraction, so main never runs) on stdin. */
function runFn(fn: string, input: string, env: Record<string, string> = {}): string {
  const body = script.match(new RegExp(`^${fn}\\(\\) \\{[\\s\\S]*?^\\}`, "m"))?.[0];
  if (!body) throw new Error(`no function ${fn} in the script`);
  const r = spawnSync("bash", ["-c", `export LC_ALL=C\n${body}\n${fn}`], { input, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

describe("diagnose-posting.sh (static)", () => {
  it("parses with bash -n, never aborts early, always exits 0", () => {
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
    expect(script).not.toMatch(/^\s*set -[a-z]*e/m);
    expect(script.trimEnd().endsWith("exit 0")).toBe(true);
  });

  it("has every SQL block the sections use", () => {
    expect([...blocks.keys()].sort()).toEqual(["SQL_ALERTS", "SQL_MIGRATIONS", "SQL_PGBOSS", "SQL_PGBOSS_FAILED", "SQL_POSTS"]);
    // psql runs read-only, like infra/preflight.sh.
    expect(script).toContain("PGOPTIONS='-c default_transaction_read_only=on");
  });

  it("greps outbox log prefixes that still exist in the worker/engine source", () => {
    const code = ["packages/core/src/outbox/engine.ts", "apps/worker/src/jobs/outbox.ts", "apps/worker/src/jobs/register-outbox.ts", "apps/worker/src/index.ts"].map(src).join("\n");
    const patterns = [...script.matchAll(/^\s*outcome "[^"]+" "([^"]+)"$/gm)].map((m) => m[1]);
    expect(patterns.length).toBeGreaterThan(10);
    for (const p of patterns) expect(code, p).toContain(p);
    const runMode = src("apps/worker/src/run-mode.ts") + src("apps/worker/src/index.ts") + src("apps/worker/src/jobs/register-engagement.ts");
    for (const p of ["live refused", "TZ_CREATOR is not set", "TZ_CREATOR not set", "DATABASE_URL is not set", "worker started ·", "engagement modes:", " · live="]) expect(runMode, p).toContain(p);
  });

  it("checks every credential name credentialsFromEnv reads", () => {
    const fn = src("packages/adapters/src/registry.ts").match(/export function credentialsFromEnv[\s\S]*?\n\}/)?.[0] ?? "";
    const names = new Set([...fn.matchAll(/env\.([A-Z0-9_]+)/g)].map((m) => m[1]));
    expect(names.size).toBeGreaterThan(5);
    const listed = (script.match(/^ENV_NAMES="([^"]*)"/m)?.[1] ?? "") + " " + [...script.matchAll(/^CRED_[A-Z]+="([^"]*)"/gm)].map((m) => m[1]).join(" ");
    for (const n of names) expect(listed.split(/\s+/), n).toContain(n);
  });

  it("uses the real queue name and the engine's native/assisted platforms", () => {
    expect(blocks.get("SQL_PGBOSS")).toContain(`name = '${QUEUES.outboxTick}'`);
    const native = Object.entries(CAPABILITIES).filter(([, c]) => c.scheduling === "native").map(([p]) => `'${p}'`).sort();
    expect(native).toEqual(["'tiktok'", "'youtube'"]);
    expect(blocks.get("SQL_POSTS")).toContain(`bi.platform in (${native.slice().reverse().join(", ")})`);
    expect(Object.entries(CAPABILITIES).filter(([, c]) => c.scheduling === "none").map(([p]) => p)).toEqual(["snapchat"]);
  });

  it("mirrors the listDue predicate that is still in outbox.ts", () => {
    const outbox = src("apps/worker/src/jobs/outbox.ts");
    expect(outbox).toContain("where b.status = 'approved' and bi.approved_at is not null and m.r2_key is not null");
    expect(outbox).toContain("and (bi.status = 'approved' or (bi.status = 'queued' and (bi.next_attempt_at is null or bi.next_attempt_at <= $1)))");
  });

  it("redact() strips tokens, URLs, IPs, emails, paths and long secrets but keeps env names", () => {
    const out = runFn(
      "redact",
      [
        "boom token=abc123SECRET Bearer eyJhbGciOiJIUzI1NiJ9xyz https://media.example.test/a?b=c at /app/apps/worker/src/x.ts:1",
        '"access_token":"EAAB123" key=zzz&x=1 user@mail.test 203.0.113.9 ' + "sk_" + "live_" + "0123456789abcdef0123456789",
        "item 3f2a9b1c-1234-4abc-9def-0123456789ab ZERNIO_TIKTOK_ACCOUNT_ID default_transaction_read_only",
        "Authorization: Token hdr-secret-1",
        "the Instagram token expires in 6 days",
      ].join("\n") + "\n",
    );
    expect(out).not.toContain("hdr-secret-1");
    expect(out).toContain("the Instagram token expires in 6 days");
    for (const leak of ["abc123SECRET", "eyJhbG", "example.test", "?b=c", "/app/", "EAAB123", "zzz", "mail.test", "203.0.113.9", "sk_live", "0123456789ab"]) expect(out).not.toContain(leak);
    expect(out).toContain("item 3f2a9b1c ZERNIO_TIKTOK_ACCOUNT_ID default_transaction_read_only");
  });

  it("scrub_env_values() replaces any env-file value, URL host, zone city and blocklist term", () => {
    const dir = mkdtempSync(join(tmpdir(), "diag-"));
    try {
      const envFile = join(dir, "fake-env");
      writeFileSync(envFile, "DRY_RUN=true\nTZ_CREATOR=Pacific/Fakeland_City\nPUBLIC_MEDIA_BASE=https://media.fake.test/m\nZERNIO_API_KEY='zk_fake_value_1'\nPRIVACY_BLOCKLIST=Fakeville, Otherplace\n");
      const out = runFn("scrub_env_values", "a Pacific/Fakeland_City Fakeland City media.fake.test zk_fake_value_1 Fakeville Otherplace true autopilot-worker-1\n", { ENV_FILE: envFile });
      for (const leak of ["Fakeland", "fake.test", "zk_fake", "Fakeville", "Otherplace"]) expect(out).not.toContain(leak);
      expect(out).toContain("true autopilot-worker-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("diagnose-posting.sh SQL (scratch DB, read-only / rolled back)", () => {
  let pool: ReturnType<typeof createPool>;
  let client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>; release(): void };
  let hasPgboss = false;

  beforeAll(async () => {
    pool = createPool(url ?? "");
    client = await pool.connect();
    hasPgboss = (await client.query("select to_regclass('pgboss.job') is not null as ok")).rows[0].ok;
  });
  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  it("every block parses and runs in a read-only transaction (pgboss blocks only if the schema exists)", async () => {
    for (const [name, sql] of blocks) {
      if (name.startsWith("SQL_PGBOSS") && !hasPgboss) continue;
      await client.query("begin transaction read only");
      try {
        const res = await client.query(sql);
        expect(Array.isArray(res.rows), name).toBe(true);
      } finally {
        await client.query("rollback");
      }
    }
  });

  it("labels why-not-due like listDue: approved item in approved batch = due, draft = item not approved (rolled back)", async () => {
    await client.query("begin");
    try {
      const now: Date = (await client.query("select now() as t")).rows[0].t;
      const media = async (r2: string | null) =>
        (await client.query("insert into media (content_hash, r2_key) values ('diag-test-' || gen_random_uuid(), $1) returning id", [r2])).rows[0].id as string;
      const batch = async (status: string) =>
        (await client.query("insert into batches (week_start, status, approved_at) values ('2099-01-05', $1, case when $1 = 'approved' then now() end) returning id", [status])).rows[0].id as string;
      const item = async (b: string, m: string, platform: string, status: string, approved: boolean, nextAttempt: string | null = null) =>
        (
          await client.query(
            `insert into batch_items (batch_id, media_id, platform, scheduled_for, status, approved_at, next_attempt_at)
             values ($1, $2, $3, now(), $4, case when $5 then now() end, $6::timestamptz) returning id`,
            [b, m, platform, status, approved, nextAttempt],
          )
        ).rows[0].id as string;
      const clean = await media("diag-test/clean.mp4");
      const bare = await media(null);
      const approvedBatch = await batch("approved");
      const draftBatch = await batch("draft");
      const ids = {
        due: await item(approvedBatch, clean, "tiktok", "approved", true),
        draft: await item(approvedBatch, clean, "tiktok", "draft", false),
        batchDraft: await item(draftBatch, clean, "youtube", "approved", true),
        noStamp: await item(approvedBatch, clean, "youtube", "approved", false),
        noR2: await item(approvedBatch, bare, "youtube", "approved", true),
        backoff: await item(approvedBatch, clean, "tiktok", "queued", true, new Date(now.getTime() + 3_600_000).toISOString()),
        retryNow: await item(approvedBatch, clean, "tiktok", "queued", true, new Date(now.getTime() - 60_000).toISOString()),
        published: await item(approvedBatch, clean, "youtube", "published", true),
      };

      const lines = (await client.query(blocks.get("SQL_POSTS")!)).rows.map((r) => r.line as string);
      const why = new Map<string, string>();
      for (const l of lines.filter((x) => x.startsWith("ITEM "))) why.set(l.split(" ")[1] ?? "", l.split(" | why=")[1] ?? "");
      const label = (id: string) => why.get(id.slice(0, 8));
      expect(label(ids.due)).toBe("due");
      expect(label(ids.draft)).toBe("item not approved");
      expect(label(ids.batchDraft)).toBe("batch not approved");
      expect(label(ids.noStamp)).toBe("no approved_at");
      expect(label(ids.noR2)).toBe("media has no r2_key");
      expect(label(ids.backoff)).toBe("in backoff");
      expect(label(ids.retryNow)).toBe("due");
      expect(label(ids.published)).toBe("already terminal");
      // No caption ever reaches the output.
      expect(lines.join("\n")).not.toMatch(/caption/i);
      expect(lines.some((l) => l.startsWith(`WHY|tiktok|due|`))).toBe(true);

      // Cross-check every row in the window (seeded ones too) against the real listDue at the same instant.
      const store = new PgOutboxStore({ query: (sql, params) => client.query(sql, params as unknown[]) }, "https://media.invalid", () => {});
      const lo = now.getTime() - 36 * 3_600_000;
      const hi = now.getTime() + 36 * 3_600_000;
      const dueIds = new Set(
        (await store.listDue(now))
          .filter((p) => Date.parse(p.scheduledFor) >= lo && Date.parse(p.scheduledFor) <= hi)
          .map((p) => p.id.slice(0, 8)),
      );
      expect(why.size).toBeGreaterThanOrEqual(8);
      for (const [short, w] of why) expect(w === "due", `${short}: ${w}`).toBe(dueIds.has(short));
    } finally {
      await client.query("rollback");
    }
  });
});
