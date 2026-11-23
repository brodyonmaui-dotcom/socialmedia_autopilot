import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FRAME_COUNT_SQL } from "../../../components/frame-counts.js";
import { dismissIssue, isUnfixable, keepAllFixes, loadTouchUp, requestFix, keepOriginal } from "../data.js";
import { loadPillars } from "../pillars.js";

/**
 * The sidebar's Touch-up badge must count exactly the clips Touch-up lists. Runs in one rolled-back
 * transaction on the dev DB (DATABASE_URL), so no fixture survives.
 */
const url = process.env.DATABASE_URL;
const qaV2 = (issues: object[]) => ({ version: 2, issues, warnings: [] });
const FROZEN = { code: "frozen-tail", severity: "fix", fixable: true, detail: "Frozen end." };
const QUIET = { code: "loudness", severity: "fix", fixable: true, detail: "Quiet." };
const NOSOUND = { code: "no-sound", severity: "info", fixable: false, detail: "No sound yet." };

describe.skipIf(!url)("touch-up badge count (db)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const run = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};

  const media = async (key: string, qa: unknown) => {
    const r = await db.query(
      `insert into media (content_hash, source_path, r2_key, duration_s, pillar, status, qa) values ($1, $2, $3, 12, $4, 'ready', $5::jsonb) returning id`,
      [`dbt-cnt-${run}-${key}`, `/clips/${run}-${key}.mp4`, `library/dbt-cnt-${run}-${key}.mp4`, `dbt${run}`, JSON.stringify(qa)],
    );
    ids[key] = r.rows[0].id;
  };
  const counts = async () => ({ badge: Number((await db.query(FRAME_COUNT_SQL.touchUp)).rows[0].n), listed: (await loadTouchUp(db)).filter((c) => !isUnfixable(c)).length });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await db.query("begin");
  });
  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
  });

  it("matches loadTouchUp through adds, dismissals and decisions", async () => {
    const start = await counts();
    expect(start.badge).toBe(start.listed);
    await media("two", qaV2([FROZEN, QUIET]));
    await media("one", qaV2([FROZEN, NOSOUND]));
    await media("info", qaV2([NOSOUND]));
    await media("legacy", { warnings: ["3 frozen-frame segment(s)"] });
    expect(await counts()).toEqual({ badge: start.badge + 2, listed: start.listed + 2 });

    await dismissIssue(db, ids.two!, "frozen-tail", null);
    expect((await counts()).badge).toBe(start.badge + 2); // loudness still open
    await dismissIssue(db, ids.two!, "loudness", null);
    expect(await counts()).toEqual({ badge: start.badge + 1, listed: start.listed + 1 });

    await requestFix(db, [ids.one!], undefined, null);
    const fix = (await db.query("update media_fixes set status = 'failed' where media_id = $1 returning id", [ids.one])).rows[0].id as string;
    expect((await counts()).badge).toBe(start.badge + 1); // a failed fix still needs him
    await keepOriginal(db, fix);
    expect(await counts()).toEqual({ badge: start.badge, listed: start.listed });
  });

  it("unfixable-only clips are listed apart, not counted, and Keep all reports them", async () => {
    const MIDDLE = { code: "frozen-middle", severity: "fix", fixable: false, detail: "Mostly still." };
    const start = await counts();
    const all0 = (await loadTouchUp(db)).filter(isUnfixable).length;
    await media("cant", qaV2([MIDDLE]));
    expect((await counts()).badge).toBe(start.badge);
    const all = await loadTouchUp(db);
    expect(all.filter(isUnfixable).length).toBe(all0 + 1);
    expect(all.find((c) => c.mediaId === ids.cant)).toBeTruthy();
    const r = await keepAllFixes(db, null);
    expect(r.cantFix).toBe(all0 + 1);
  });

  it("loadPillars lists distinct pillars", async () => {
    await media("p", qaV2([]));
    expect(await loadPillars(db)).toContain(`dbt${run}`);
  });
});
