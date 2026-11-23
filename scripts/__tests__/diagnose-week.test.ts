import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../../packages/db/src/client.js";
import { QUEUES } from "../../apps/worker/src/queue.js";
import { isEligibleClip, loadLibraryClips, RECENT_USE_DAYS } from "../../apps/worker/src/jobs/weekly-draft.js";

// infra/diagnose-week.sh (the "empty next week / duplicated or stuck clips" script the creator runs on the VPS).
// No Docker here, so: the SQL heredocs are extracted and run against the scratch DB (read-only / rolled back),
// the library-eligibility SQL is cross-checked against the real loadLibraryClips + isEligibleClip, and the
// queue names / constants it mirrors are checked against the source.
const repo = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(repo, "infra/diagnose-week.sh");
const script = readFileSync(SCRIPT, "utf8");
const src = (p: string) => readFileSync(join(repo, p), "utf8");

function sqlBlocks(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/<<'(SQL_[A-Z0-9_]+)'\n([\s\S]*?)\n\1\n/g)) out.set(m[1]!, m[2] ?? "");
  return out;
}
const blocks = sqlBlocks(script);

describe("diagnose-week.sh (static)", () => {
  it("parses with bash -n, never aborts early, always exits 0", () => {
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
    expect(script).not.toMatch(/^\s*set -[a-z]*e/m);
    expect(script.trimEnd().endsWith("exit 0")).toBe(true);
  });

  it("is read-only: psql in a read-only UTC session, no write statements, /dev/null on non-SQL compose calls", () => {
    expect(script).toContain("default_transaction_read_only=on -c TimeZone=UTC");
    for (const [name, sql] of blocks) expect(sql, name).not.toMatch(/\b(insert|update|delete|drop|alter|truncate|create)\s/i);
    expect(script).toContain("</dev/null");
  });

  it("has every SQL block the sections use", () => {
    expect([...blocks.keys()].sort()).toEqual(
      ["SQL_BATCHES", "SQL_CADENCE", "SQL_DUPES", "SQL_ITEMS", "SQL_JOBS", "SQL_LIBRARY", "SQL_READY", "SQL_STUCK", "SQL_TZ", "SQL_WINDOW"].sort(),
    );
  });

  it("mirrors the jobs: queue names, 28-day window, eligibility predicate, covered-day query, default caps", () => {
    expect(blocks.get("SQL_JOBS")).toContain(`'${QUEUES.weeklyDraft}'`);
    expect(blocks.get("SQL_JOBS")).toContain(`'${QUEUES.dailyInstagram}'`);
    expect(RECENT_USE_DAYS).toBe(28);
    expect(blocks.get("SQL_LIBRARY")).toContain(`interval '${RECENT_USE_DAYS} days'`);
    const weekly = src("apps/worker/src/jobs/weekly-draft.ts");
    expect(weekly).toContain("select distinct media_id from batch_items where status <> 'rejected' and scheduled_for is not null and scheduled_for >= $1::timestamptz");
    expect(weekly).toContain("hk.status = 'kept'");
    expect(weekly).toContain("hf.status in ('queued','running','done','discarded','failed')");
    expect(weekly).toContain("r.status !== \"archived\" && !!r.r2Key");
    expect(src("apps/worker/src/jobs/daily-instagram.ts")).toContain('new Set(["trade-recap", "trading"])');
    expect(blocks.get("SQL_LIBRARY")).toContain("('trade-recap', 'trading')");
    expect(src("packages/core/src/cadence.ts")).toContain("dailyCaps: { instagram: 6, youtube: 10, tiktok: 7, snapchat: 1 }");
    expect(blocks.get("SQL_CADENCE")).toContain("when 'instagram' then 6 when 'youtube' then 10 when 'tiktok' then 7 else 1");
    expect(src("packages/core/src/daily-min.ts")).toContain("INSTAGRAM_DAILY_MIN_DEFAULT = 2");
  });

  it("never prints the zone name, a title, or more than 40 caption chars", () => {
    expect(script).not.toMatch(/echo[^\n]*\$DIAG_TZ|echo[^\n]*\$z\b/);
    expect(blocks.get("SQL_ITEMS")).toContain("left(regexp_replace(bi.caption, '\\s+', ' ', 'g'), 40)");
    expect(blocks.get("SQL_ITEMS")).toContain("case when coalesce(bi.title, '') = '' then 'n' else 'y' end");
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("diagnose-week.sh SQL (scratch DB, read-only / rolled back)", () => {
  let pool: ReturnType<typeof createPool>;
  let client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>; release(): void };
  let hasPgboss = false;
  const lines = async (name: string, tz = "UTC") => {
    await client.query(`select set_config('diag.tz', $1, false)`, [tz]);
    return (await client.query(blocks.get(name)!)).rows.map((r) => String(Object.values(r)[0]));
  };

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
      if ((name === "SQL_JOBS" || name === "SQL_TZ") && !hasPgboss) continue;
      await client.query("begin transaction read only");
      try {
        const res = await client.query(sql);
        expect(Array.isArray(res.rows), name).toBe(true);
      } finally {
        await client.query("rollback");
      }
    }
  });

  it("next week, duplicates, stuck drafts, library eligibility and caption cut, on seeded rows (rolled back)", async () => {
    await client.query("begin");
    try {
      const weekStart = (await lines("SQL_WINDOW")).find((l) => l.startsWith("WEEK_START "))!.split(" ")[1]!;
      const dow = (await client.query(`select extract(isodow from $1::date)::int as d`, [weekStart])).rows[0].d;
      expect(dow).toBe(1); // a Monday, strictly after today

      const media = async (r2: string | null, status = "ingested", pillar: string | null = "gym") =>
        (await client.query("insert into media (content_hash, r2_key, status, pillar) values ('diagwk-' || gen_random_uuid(), $1, $2, $3) returning id", [r2, status, pillar])).rows[0].id as string;
      const clean = await media("diagwk/clean.mp4");
      const bare = await media(null);
      const archived = await media("diagwk/old.mp4", "archived");
      const usedClip = await media("diagwk/used.mp4");
      const trading = await media("diagwk/t.mp4", "ingested", "trading");
      const batch = (await client.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [weekStart])).rows[0].id as string;
      const longCaption = "x".repeat(60);
      const item = async (m: string, platform: string, status: string, whenSql: string, caption: string, title: string | null = null, origin: string | null = "weekly") =>
        (
          await client.query(
            `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, origin) values ($1, $2, $3, $4, $5, ${whenSql}, $6, $7) returning id`,
            [batch, m, platform, caption, title, status, origin],
          )
        ).rows[0].id as string;
      const posted = await item(clean, "youtube", "published", "now() - interval '2 days'", "c", "t");
      const stuckPosted = await item(clean, "youtube", "draft", "now() + interval '1 day'", "", "");
      const dupA = await item(usedClip, "instagram", "draft", "now() + interval '1 day'", longCaption);
      const dupB = await item(usedClip, "instagram", "draft", "now() + interval '3 days'", "short caption");
      await item(trading, "instagram", "rejected", "now() + interval '2 days'", "rejected one");
      void posted;

      const items = (await lines("SQL_ITEMS")).filter((l) => l.startsWith("ITEM "));
      const capLine = items.find((l) => l.startsWith(`ITEM ${dupA.slice(0, 8)} `))!;
      expect(capLine).toContain(`cap=${"x".repeat(40)}`);
      expect(capLine).not.toContain("x".repeat(41));
      expect(capLine).toContain("title=n");
      expect(items.find((l) => l.startsWith(`ITEM ${stuckPosted.slice(0, 8)} `))).toContain("cap=(empty)");

      const dupes = await lines("SQL_DUPES");
      expect(dupes.some((l) => l.startsWith("PAIR ") && l.includes(dupA.slice(0, 8)) && l.includes(dupB.slice(0, 8)))).toBe(true);
      // dupA/dupB, plus the published clip (2 days ago) against its still-scheduled draft on the same platform.
      // (the scratch DB may hold other rows, so counts are lower bounds; the pair lines are matched by id)
      expect(Number(dupes.find((l) => l.startsWith("COUNT "))?.split(" ")[1])).toBeGreaterThanOrEqual(2);
      expect(dupes.some((l) => l.startsWith("PAIR ") && l.includes(`m=${clean.slice(0, 8)} youtube`))).toBe(true);

      const stuck = await lines("SQL_STUCK");
      expect(stuck.some((l) => l.startsWith(`STUCK ${stuckPosted.slice(0, 8)} `) && l.includes("missing=caption+title") && l.endsWith("posted=y"))).toBe(true);
      expect(Number(stuck.find((l) => l.startsWith("POSTED "))?.split(" ")[1])).toBeGreaterThanOrEqual(1);

      // Library: cross-check with the real loadLibraryClips + isEligibleClip + the 28-day recently-used query.
      const lib = await lines("SQL_LIBRARY");
      const kv = (k: string) => Number(lib.find((l) => l.startsWith(`${k} `))?.split(" ")[1]);
      const rows = await loadLibraryClips({ query: (s, p) => client.query(s, p as unknown[]) });
      const eligible = rows.filter(isEligibleClip);
      const recent = new Set(
        (await client.query(`select distinct media_id from batch_items where status <> 'rejected' and scheduled_for is not null and scheduled_for >= now() - interval '${RECENT_USE_DAYS} days'`)).rows.map((r) => String(r.media_id)),
      );
      expect(kv("TOTAL")).toBe(rows.length);
      expect(kv("ELIGIBLE")).toBe(eligible.length);
      expect(kv("ELIGIBLE_USED_28D")).toBe(eligible.filter((r) => recent.has(r.id)).length);
      expect(kv("ELIGIBLE_UNUSED")).toBe(eligible.filter((r) => !recent.has(r.id)).length);
      expect(eligible.some((r) => r.id === bare || r.id === archived)).toBe(false);
      // The trading clip's only item is rejected: still unused, but not for daily-instagram.
      expect(kv("ELIGIBLE_UNUSED") - kv("ELIGIBLE_UNUSED_FOR_DAILY")).toBeGreaterThanOrEqual(1);

      const week = await lines("SQL_BATCHES");
      expect(week.some((l) => l.startsWith("BATCH ") && l.includes("items=5"))).toBe(true);
      const cad = await lines("SQL_CADENCE");
      expect(cad.some((l) => /^DAY \d{4}-\d{2}-\d{2} instagram n=\d+ cap=\d+$/.test(l))).toBe(true);
      expect(cad.filter((l) => l.startsWith("DAY ")).length).toBe(32);
    } finally {
      await client.query("rollback");
    }
  });
});
