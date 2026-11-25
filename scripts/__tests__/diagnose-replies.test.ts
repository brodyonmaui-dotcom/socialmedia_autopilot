import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../../packages/db/src/client.js";
import { QUEUES } from "../../apps/worker/src/queue.js";

// infra/diagnose-replies.sh (the "replies don't send / Library crashes" script the creator runs on the VPS).
// No Docker here: the SQL heredocs are extracted and run against the scratch DB (read-only / rolled back),
// and the env names, log prefixes and queue name it mirrors are checked against the source.
const repo = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(repo, "infra/diagnose-replies.sh");
const script = readFileSync(SCRIPT, "utf8");
const src = (p: string) => readFileSync(join(repo, p), "utf8");

function sqlBlocks(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/<<'(SQL_[A-Z0-9_]+)'\n([\s\S]*?)\n\1\n/g)) out.set(m[1]!, m[2] ?? "");
  return out;
}
const blocks = sqlBlocks(script);

describe("diagnose-replies.sh (static)", () => {
  it("parses with bash -n, never aborts early, always exits 0", () => {
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
    expect(script).not.toMatch(/^\s*set -[a-z]*e/m);
    expect(script.trimEnd().endsWith("exit 0")).toBe(true);
    expect(script).toContain("== VERDICT");
  });

  it("is read-only: psql in a read-only UTC session, no write statements, /dev/null on non-SQL compose calls", () => {
    expect(script).toContain("default_transaction_read_only=on -c TimeZone=UTC");
    for (const [name, sql] of blocks) expect(sql, name).not.toMatch(/\b(insert|update|delete|drop|alter|truncate|create)\s/i);
    expect(script).toContain("</dev/null");
    for (const line of script.split("\n").filter((l) => /\bdc (ps|logs|exec)\b/.test(l) && !l.trim().startsWith("#") && !l.includes("PGOPTIONS") && !l.includes("sh -c"))) {
      expect(line, line).toContain("</dev/null");
    }
  });

  it("has every SQL block the sections use", () => {
    expect([...blocks.keys()].sort()).toEqual(["SQL_FOLDER", "SQL_MIGRATIONS", "SQL_PGBOSS", "SQL_PGBOSS_FAILED", "SQL_REPLIES", "SQL_SETTINGS"].sort());
  });

  it("never selects comment text, reply text or handles", () => {
    for (const [name, sql] of blocks) expect(sql, name).not.toMatch(/\b(author_handle|draft_reply|a\.text|c\.text|author_id)\b/);
  });

  it("mirrors the source: queue name, env names, log prefixes", () => {
    expect(QUEUES.engagementSend).toBe("engagement-send");
    expect(blocks.get("SQL_PGBOSS")).toContain(`'${QUEUES.engagementSend}'`);
    expect(blocks.get("SQL_PGBOSS_FAILED")).toContain(`'${QUEUES.engagementSend}'`);
    const names = script.match(/^ENV_NAMES="([^"]+)"/m)![1]!.split(" ");
    const reads = [
      src("apps/worker/src/index.ts"),
      src("packages/adapters/src/comments/index.ts"),
      src("apps/worker/src/jobs/register-engagement.ts"),
      src("packages/engagement/src/kill.ts"),
      src("packages/engagement/src/triage-anthropic.ts"),
    ].join("\n");
    const read = new Set([...reads.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]!).concat([...reads.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]!)));
    for (const n of ["DRY_RUN", "WORKER_LIVE"]) expect(names).toContain(n);
    for (const n of read) {
      if (n === "NODE_ENV" || n === "TZ_CREATOR" || n === "PUBLIC_MEDIA_BASE") continue; // not on the reply path
      expect(names, n).toContain(n);
    }
    const send = src("packages/engagement/src/send.ts") + src("apps/worker/src/jobs/register-engagement.ts") + src("apps/worker/src/jobs/engagement-triage.ts");
    for (const p of ["[engage] sent ", "[engage] retry ", "[engage] FAILED ", "[engage] UNKNOWN ", "[engage] skip ", "[engage] hold ", "[engage] cancelled ", "[engage] claim lost ", "[engage] KILL tripped", "[engage] send tick:", "[engage] triage:"]) {
      expect(script, p).toContain(p);
      expect(send, p).toContain(p.replace(/ $/, ""));
    }
    expect(src("apps/worker/src/jobs/register-engagement.ts")).toContain("engagement modes:");
    expect(src("apps/worker/src/jobs/register-engagement.ts")).toContain("triage: rules-only drafts");
  });

  it("redacts and cuts: no handle or reply text columns, redact on every log/error print", () => {
    expect(script).toContain("redact()");
    expect(script).toContain("left(regexp_replace(r.last_error, '\\s+', ' ', 'g'), 120)");
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("diagnose-replies.sh SQL (scratch DB, read-only / rolled back)", () => {
  let pool: ReturnType<typeof createPool>;
  let client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>; release(): void };
  let hasPgboss = false;
  const lines = async (name: string) => (await client.query(blocks.get(name)!)).rows.map((r) => String(Object.values(r)[0]));

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

  it("folder column, replies, classes and the engagement settings, on seeded rows (rolled back)", async () => {
    await client.query("begin");
    try {
      const folder = await lines("SQL_FOLDER");
      expect(folder).toContain("FOLDER_COLUMN yes");

      const comment = async (platform: string, handle: string, text: string) =>
        (await client.query("insert into comments (platform, platform_comment_id, platform_media_id, author_handle, text, commented_at) values ($1, 'diagrp-' || gen_random_uuid(), 'm1', $2, $3, now()) returning id", [platform, handle, text])).rows[0].id as string;
      const action = async (c: string, status: string, origin: string, notBefore: string, err: string | null, pid: string | null) =>
        (await client.query(`insert into engagement_actions (comment_id, kind, text, status, origin, not_before, attempts, last_error, platform_action_id) values ($1, 'reply', 'SECRETREPLYTEXT', $2, $3, ${notBefore}, 1, $4, $5) returning id`, [c, status, origin, err, pid])).rows[0].id as string;
      const stuck = await action(await comment("tiktok", "secrethandle", "SECRETCOMMENTTEXT"), "planned", "auto", "now() - interval '2 hours'", null, null);
      const failed = await action(await comment("youtube", "secrethandle", "x"), "failed", "manual", "now() - interval '1 hour'", "HTTP 403 insufficient permissions " + "e".repeat(200), null);
      const sent = await action(await comment("instagram", "secrethandle", "y"), "sent", "auto", "now() - interval '1 hour'", null, "17900000000");

      const out = await lines("SQL_REPLIES");
      const row = (id: string) => out.find((l) => l.startsWith(`ROW ${id.slice(0, 8)} `))!;
      expect(row(stuck)).toContain(" tiktok planned auto ");
      expect(row(stuck)).toContain("pid=n");
      expect(row(sent)).toContain("pid=y");
      expect(row(failed).split("err=")[1]!.length).toBeLessThanOrEqual(120);
      expect(out.join("\n")).not.toMatch(/SECRET|secrethandle/);
      expect(out.some((l) => /^STUCK\|tiktok\|[1-9]/.test(l))).toBe(true);
      expect(out.some((l) => /^FAILCLS\|youtube\|auth\|[1-9]/.test(l))).toBe(true);
      expect(out.some((l) => /^COUNT instagram sent auto n=[1-9]/.test(l))).toBe(true);

      await client.query("insert into settings (key, value) values ('engagement', $1) on conflict (key) do update set value = excluded.value", [
        JSON.stringify({ mode: { youtube: "live" }, killed: true, killedReason: "test", pings: "hourly", pools: { positive: ["POOLTEXT"] } }),
      ]);
      const set = await lines("SQL_SETTINGS");
      expect(set).toContain("ROW 1");
      expect(set.some((l) => l.startsWith("SET mode=") && l.includes('"youtube": "live"'))).toBe(true);
      expect(set).toContain("SET killed=true");
      expect(set.join("\n")).not.toContain("POOLTEXT");
    } finally {
      await client.query("rollback");
    }
  });
});
