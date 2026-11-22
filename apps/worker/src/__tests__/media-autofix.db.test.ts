import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QaResult } from "@autopilot/media";
import { autoQueueFix } from "../jobs/media-fix.js";
import { RECHECK_PER_TICK, runMediaRecheckOnce } from "../jobs/media-recheck.js";

/** Dev DB (DATABASE_URL), one rolled-back transaction. No ffmpeg: autoQueueFix only reads a QA result. */
const url = process.env.DATABASE_URL;
const qa = (issues: object[]) => ({ version: 2, issues, warnings: [] }) as unknown as QaResult;
const FROZEN = { code: "frozen-tail", severity: "fix", fixable: true, detail: "Frozen end." };
const MIDDLE = { code: "frozen-middle", severity: "fix", fixable: false, detail: "Mostly still." };
const GAPS = { code: "silence-gaps", severity: "info", fixable: true, detail: "Pauses." };

describe.skipIf(!url)("touch-up auto-queue (db)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const run = randomUUID().slice(0, 8);
  let n = 0;
  const media = async () =>
    (await db.query(`insert into media (content_hash, source_path, r2_key, duration_s, status) values ($1, $2, $3, 12, 'ready') returning id`, [`dbt-af-${run}-${n}`, `/clips/${run}-${n}.mp4`, `library/dbt-af-${run}-${n++}.mp4`])).rows[0].id as string;
  const fixes = async (id: string) => (await db.query("select status, ops from media_fixes where media_id = $1", [id])).rows as Array<{ status: string; ops: string[] }>;
  const setting = (v: unknown) => db.query(`insert into settings (key, value) values ('touchup_autofix', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(v)]);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await db.query("begin");
    await db.query("delete from settings where key = 'touchup_autofix'");
  });
  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
  });

  it("queues only fixable fix issues, default ops only", async () => {
    const a = await media();
    expect(await autoQueueFix(db, a, qa([FROZEN, GAPS]))).toBe(true);
    expect(await fixes(a)).toEqual([{ status: "queued", ops: ["trim"] }]);
    const b = await media();
    expect(await autoQueueFix(db, b, qa([MIDDLE]))).toBe(false);
    expect(await autoQueueFix(db, b, qa([GAPS]))).toBe(false);
    expect(await fixes(b)).toEqual([]);
  });

  it("only when no fix history: open, failed, kept or discarded all block", async () => {
    const a = await media();
    expect(await autoQueueFix(db, a, qa([FROZEN]))).toBe(true);
    expect(await autoQueueFix(db, a, qa([FROZEN]))).toBe(false); // open
    await db.query("update media_fixes set status = 'failed' where media_id = $1", [a]);
    expect(await autoQueueFix(db, a, qa([FROZEN]))).toBe(false);
    expect(await fixes(a)).toHaveLength(1);
    const copy = await media();
    await db.query("insert into media_fixes (media_id, ops, status, fixed_media_id) values ($1, '{trim}', 'kept', $2)", [await media(), copy]);
    expect(await autoQueueFix(db, copy, qa([FROZEN]))).toBe(false); // a fixed copy
  });

  it("respects the setting and dismissals", async () => {
    await setting(false);
    const a = await media();
    expect(await autoQueueFix(db, a, qa([FROZEN]))).toBe(false);
    await setting(true);
    expect(await autoQueueFix(db, a, qa([FROZEN]))).toBe(true);
    const b = await media();
    await db.query("insert into touchup_dismissals (media_id, code) values ($1, 'frozen-tail')", [b]);
    expect(await autoQueueFix(db, b, qa([FROZEN]))).toBe(false);
  });

  it("recheck takes 20 legacy rows per tick", async () => {
    expect(RECHECK_PER_TICK).toBe(20);
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push(await media());
    const seen: string[][] = [];
    const spy = { query: (sql: string, p?: unknown[]) => db.query(sql, p).then((r) => (/from media\s+where r2_key/.test(sql) ? (seen.push(r.rows.map((x) => x.id)), r) : r)) };
    const r = await runMediaRecheckOnce({ db: spy, storage: { download: async () => { throw new Error("skip"); }, upload: async () => {} }, hasFfmpeg: async () => true, onlyMediaIds: ids, limit: 50 });
    expect(seen[0]).toHaveLength(20);
    expect(r.failed).toBe(20);
  });
});
