import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgEngagementStore } from "../jobs/engagement-store.js";

/**
 * Run 4 store methods against the dev DB (DATABASE_URL, migrated through 0012). Per-run tagged rows;
 * nothing is deleted (fixtures end handled, list rows closed, DM threads marked handled).
 */
const url = process.env.DATABASE_URL;
const NOW = new Date();

describe.skipIf(!url)("PgEngagementStore run 4 (db)", () => {
  let pool: pg.Pool;
  let store: PgEngagementStore;
  const run = randomUUID().slice(0, 8);
  const ids: string[] = [];
  let threadId = "";

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    store = new PgEngagementStore(pool);
    for (const k of ["a", "b"]) {
      const { rows } = await pool.query(
        `insert into comments (platform, platform_comment_id, platform_media_id, author_id, author_handle, text, commented_at)
         values ('instagram', $1, 'm', $2, 'Promo_Page', 'check out our page', $3) returning id`,
        [`dbs-${run}-${k}`, `dbs-${run}-author`, NOW],
      );
      ids.push(rows[0].id);
    }
    threadId = (await pool.query(`insert into dm_threads (platform_thread_id, participant_id) values ($1, $2) returning id`, [`dbs-${run}-t`, `dbs-${run}-p`])).rows[0].id;
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`update comment_triage set handled_at = coalesce(handled_at, now()), retriage_requested_at = null where comment_id = any($1::uuid[])`, [ids]);
    await pool.query(`update engagement_promo_accounts set removed_at = now() where author_key like $1 and removed_at is null`, [`dbs-${run}-%`]);
    await pool.query(`update dm_threads set handled_at = now() where id = $1`, [threadId]);
    await pool.end();
  });

  it("promo verdicts count per author; the list takes one open row per (platform, author_key)", async () => {
    for (const id of ids) await store.saveTriage(id, { bucket: "spam_promo", reply: null, confidence: 1, reasons: ["promo:check-our-page"], model: "rules" }, NOW);
    expect(await store.promoHitCount("instagram", `dbs-${run}-author`, null)).toBe(2);
    expect(await store.addPromoAccount("instagram", `dbs-${run}-author`, "Promo_Page", "rule", NOW)).toBe(true);
    expect(await store.addPromoAccount("instagram", `dbs-${run}-author`, "Promo_Page", "manual", NOW)).toBe(false);
    expect((await store.loadPromoAccounts()).filter((a) => a.authorKey === `dbs-${run}-author`)).toEqual([{ platform: "instagram", authorKey: `dbs-${run}-author` }]);
  });

  it("a Not spam row is listed again with skipPromo, and saveTriage overwrites it exactly once", async () => {
    await pool.query(`update comment_triage set bucket = 'flag', not_spam_at = $2, retriage_requested_at = $2 where comment_id = $1`, [ids[0], NOW]);
    const listed = (await store.listUntriaged(500)).find((u) => u.id === ids[0]);
    expect(listed?.skipPromo).toBe(true);
    await store.saveTriage(ids[0]!, { bucket: "simple_positive", reply: "Appreciate you man", confidence: 0.9, reasons: ["not spam (creator)"], model: "test" }, NOW);
    const { rows } = await pool.query(`select bucket, retriage_requested_at from comment_triage where comment_id = $1`, [ids[0]]);
    expect(rows[0]).toEqual({ bucket: "simple_positive", retriage_requested_at: null });
    // Without a pending request the row is final (on conflict … where retriage_requested_at is not null).
    await store.saveTriage(ids[0]!, { bucket: "flag", reply: null, confidence: 1, reasons: [], model: "test" }, NOW);
    expect((await pool.query(`select bucket from comment_triage where comment_id = $1`, [ids[0]])).rows[0].bucket).toBe("simple_positive");
    expect((await store.listUntriaged(500)).some((u) => u.id === ids[0])).toBe(false);
  });

  it("ignores a DM thread once; a thread marked not-spam is never re-ignored", async () => {
    expect(await store.ignoreDmThread(threadId, "promo:s4s", NOW)).toBe(true);
    expect((await pool.query(`select ignored_reason from dm_threads where id = $1`, [threadId])).rows[0].ignored_reason).toBe("promo:s4s");
    await pool.query(`update dm_threads set ignored_at = null, ignored_reason = 'not-spam' where id = $1`, [threadId]);
    expect(await store.ignoreDmThread(threadId, "promo:s4s", NOW)).toBe(false);
    expect((await pool.query(`select ignored_at from dm_threads where id = $1`, [threadId])).rows[0].ignored_at).toBeNull();
  });

  it("pingState reads the reply-ready alerts; insertReplyReadyAlert writes one (with the comment link)", async () => {
    const before = await store.pingState(NOW);
    await store.insertReplyReadyAlert(ids[1]!, "instagram", `dbs ${run}`, NOW);
    const after = await store.pingState(new Date(NOW.getTime() + 1000));
    expect(after.sentLastHour).toBe(before.sentLastHour + 1);
    expect(after.lastPingAt?.getTime()).toBeGreaterThanOrEqual(NOW.getTime() - 1);
    const { rows } = await pool.query(`select kind, comment_id from alerts where message = $1`, [`dbs ${run}`]);
    expect(rows).toEqual([{ kind: "reply-ready", comment_id: ids[1] }]);
    await pool.query(`update alerts set acknowledged_at = now(), pushed_at = coalesce(pushed_at, now()) where message = $1`, [`dbs ${run}`]);
  });
});
