import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAlerts } from "../../alerts/queries.js";
import { loadInboxGroups } from "../groups.js";
import { loadInbox } from "../list.js";

/** Real dev DB (DATABASE_URL). Far-future fixture comments on YouTube; counts compared as deltas; all fixtures end handled / acknowledged. */
const url = process.env.DATABASE_URL;
const FUTURE = new Date("2099-03-01T10:00:00Z");

describe.skipIf(!url)("inbox groups (db)", () => {
  let pool: pg.Pool;
  const run = randomUUID().slice(0, 8);
  const ids: string[] = [];
  let before = { drafted: 0, needsYou: 0 };
  let alertId = "";

  const comment = async (key: string, bucket: string, shadow: string | null, at: Date) => {
    const { rows } = await pool.query(
      `insert into comments (platform, platform_comment_id, platform_media_id, author_id, author_handle, text, commented_at) values ('youtube', $1, $2, $3, $4, $5, $6) returning id`,
      [`grp-${run}-${key}`, `grp-${run}-m`, `grp-${run}-${key}`, `grp_${run}_${key}`, `nice abs ${key}`, at],
    );
    const id = rows[0].id as string;
    ids.push(id);
    await pool.query(`insert into comment_triage (comment_id, bucket, confidence, reasons, model, decided_at) values ($1, $2, 0.9, '{test}', 'test', $3)`, [id, bucket, at]);
    if (shadow) await pool.query(`insert into engagement_actions (comment_id, kind, text, status, not_before, origin) values ($1, 'reply', $2, 'shadow', $3, 'auto')`, [id, shadow, at]);
    return id;
  };
  const yt = async () => {
    const g = (await loadInboxGroups(pool)).find((x) => x.platform === "youtube");
    return g ?? { drafted: 0, needsYou: 0, dmsOpen: 0, newest: null };
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    before = await yt();
  });
  afterAll(async () => {
    if (!pool) return;
    await pool.query(`update comment_triage set handled_at = coalesce(handled_at, now()) where comment_id = any($1::uuid[])`, [ids]);
    await pool.query(`update engagement_actions set status = 'cancelled', updated_at = now() where comment_id = any($1::uuid[]) and status = 'shadow'`, [ids]);
    if (alertId) await pool.query(`update alerts set acknowledged_at = now() where id = $1`, [alertId]);
    await pool.end();
  });

  it("groups per platform: drafted and needs-you counts and the newest comment", async () => {
    await comment("d1", "simple_positive", "Thanks!", new Date(FUTURE.getTime() - 1000));
    await comment("d2", "simple_positive", "Appreciate you", new Date(FUTURE.getTime() - 2000));
    const newest = await comment("n1", "flag", null, FUTURE);
    const g = await yt();
    expect(g.drafted).toBe(before.drafted + 2);
    expect(g.needsYou).toBe(before.needsYou + 1);
    expect(g.newest).toMatchObject({ id: newest, authorHandle: `grp_${run}_n1`, text: "nice abs n1", at: FUTURE.toISOString() });
  });

  it("the Inbox list filters by platform", async () => {
    const yts = await loadInbox(pool, { kind: "comments", filter: "drafted", platform: "youtube", limit: 100 });
    expect(yts.rows.every((r) => r.platform === "youtube")).toBe(true);
    expect(yts.rows.map((r) => r.id)).toEqual(expect.arrayContaining(ids.slice(0, 2)));
    const tt = await loadInbox(pool, { kind: "comments", filter: "drafted", platform: "tiktok", limit: 100 });
    expect(tt.rows.some((r) => ids.includes(r.id))).toBe(false);
  });

  it("excludeInbox leaves stored reply-ready rows out of the list", async () => {
    alertId = (await pool.query(`insert into alerts (kind, platform, message, created_at, pushed_at) values ('reply-ready', 'youtube', $1, $2, $2) returning id`, [`grp digest ${run}`, FUTURE])).rows[0].id;
    expect((await listAlerts(pool, { state: "open", limit: 200 })).some((a) => a.id === alertId)).toBe(true);
    expect((await listAlerts(pool, { state: "open", limit: 200, excludeInbox: true })).some((a) => a.id === alertId)).toBe(false);
  });
});
