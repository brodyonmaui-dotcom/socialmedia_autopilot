import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveAndSend, loadInboxItem, type ApproveDeps } from "../item.js";
import { inboxCounts, loadInbox } from "../list.js";
import { promoRule } from "@autopilot/engagement/src/rules.js";
import { addPromoAccount, addPromoAccountByHandle, loadPromoAccounts, markNotSpam, removePromoAccount } from "../promo.js";

/**
 * Real dev DB (DATABASE_URL, migrated through 0012). Fixture comments carry a per-run tag in their
 * platform ids and handles; nothing is deleted: at the end every fixture is marked handled, its actions
 * cancelled (if still pending) and its list rows closed (removed_at).
 */
const url = process.env.DATABASE_URL;
const NOW = new Date();

describe.skipIf(!url)("inbox data layer (db)", () => {
  let pool: pg.Pool;
  const run = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  let deps: ApproveDeps;

  const comment = async (key: string, text: string, bucket: string, author: string, opts: { shadow?: string; draft?: string; batchItemId?: string } = {}) => {
    const { rows } = await pool.query(
      `insert into comments (platform, platform_comment_id, platform_media_id, author_id, author_handle, text, commented_at, batch_item_id)
       values ('instagram', $1, $2, $3, $4, $5, $6, $7) returning id`,
      [`dbt-${run}-${key}`, `dbt-${run}-media`, `dbt-${run}-${author}`, `dbt_${run}_${author}`, text, NOW, opts.batchItemId ?? null],
    );
    const id = rows[0].id as string;
    ids[key] = id;
    await pool.query(`insert into comment_triage (comment_id, bucket, confidence, draft_reply, reasons, model, decided_at) values ($1, $2, 0.9, $3, $4, 'test', $5)`, [
      id, bucket, opts.draft ?? null, [`test ${bucket}`], NOW,
    ]);
    if (opts.shadow) {
      await pool.query(`insert into engagement_actions (comment_id, kind, text, status, not_before, origin) values ($1, 'reply', $2, 'shadow', $3, 'auto')`, [id, opts.shadow, NOW]);
    }
    return id;
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    deps = { pool, dryRun: true, killEnv: false, blocklist: ["fooville"] };
    await comment("praise", "love the energy", "simple_positive", "fan1", { shadow: "Appreciate you man" });
    await comment("promo", "send it to @fit_features_hub", "spam_promo", "page1");
    await comment("flag1", "what program do you run?", "flag", "page2");
    await comment("flag2", "great video", "simple_positive", "page2", { shadow: "Thanks, means a lot" });
    await pool.query(`insert into alerts (kind, platform, message, comment_id, created_at, pushed_at) values ('reply-ready', 'instagram', $1, $2, $3, $3)`, [`dbtest ${run}`, ids.praise, NOW]);
  });

  afterAll(async () => {
    if (!pool) return;
    const all = Object.values(ids);
    await pool.query(`update comment_triage set handled_at = coalesce(handled_at, now()), retriage_requested_at = null where comment_id = any($1::uuid[])`, [all]);
    await pool.query(`update engagement_actions set status = 'cancelled', updated_at = now() where comment_id = any($1::uuid[]) and status in ('shadow','planned')`, [all]);
    await pool.query(`update engagement_promo_accounts set removed_at = now() where (author_key like $1 or author_key like $2) and removed_at is null`, [`dbt-${run}-%`, `dbt_${run}_%`]);
    await pool.query(`update alerts set acknowledged_at = coalesce(acknowledged_at, now()) where message = $1`, [`dbtest ${run}`]);
    await pool.end();
  });

  it("lists by filter: drafted, needs-you, ignored (promo only there)", async () => {
    const all = async (filter: "drafted" | "needs-you" | "ignored") => (await loadInbox(pool, { kind: "comments", filter, limit: 100, now: NOW })).rows.map((r) => r.id);
    expect(await all("drafted")).toEqual(expect.arrayContaining([ids.praise, ids.flag2]));
    expect(await all("needs-you")).toContain(ids.flag1);
    expect(await all("ignored")).toContain(ids.promo);
    for (const f of ["drafted", "needs-you"] as const) expect(await all(f)).not.toContain(ids.promo);
    const page = await loadInbox(pool, { kind: "comments", filter: "drafted", limit: 1, now: NOW });
    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const next = await loadInbox(pool, { kind: "comments", filter: "drafted", limit: 1, cursor: page.nextCursor, now: NOW });
    expect(next.rows[0]?.id).not.toBe(page.rows[0]!.id);
    const counts = await inboxCounts(pool, "comments");
    expect(counts.ignored).toBeGreaterThanOrEqual(1);
    expect(Object.keys(await inboxCounts(pool, "dms")).sort()).toEqual(["drafted", "ignored", "needs-you", "sent"]);
  });

  it("loads one item with its drafted reply and state", async () => {
    const item = await loadInboxItem(pool, ids.praise!, NOW);
    expect(item).toMatchObject({ state: "drafted", draftedReply: "Appreciate you man", authorName: `@dbt_${run}_fan1`, platform: "instagram", mediaId: null });
    expect(await loadInboxItem(pool, randomUUID())).toBeNull();
    expect(await loadInboxItem(pool, "not-a-uuid")).toBeNull();
  });

  it("an item on a batch post carries the post's media id", async () => {
    const bi = (await pool.query(`select id, media_id from batch_items order by id limit 1`)).rows[0];
    if (!bi) return; // an empty dev DB has no batch items; the null case above still holds
    const id = await comment("onpost", "nice one", "simple_positive", "fan3", { batchItemId: bi.id });
    expect((await loadInboxItem(pool, id, NOW))?.mediaId).toBe(bi.media_id);
  });

  it("refuses promo, a place in an edited reply, and a killed engine", async () => {
    expect(await approveAndSend(deps, ids.promo!, { sessionId: "x", now: NOW })).toEqual({ status: "refused", reason: expect.stringContaining("promo") });
    expect((await approveAndSend(deps, ids.praise!, { text: "see you in fooville", sessionId: "x", now: NOW })).status).toBe("refused");
    expect((await approveAndSend({ ...deps, killEnv: true }, ids.praise!, { sessionId: "x", now: NOW })).status).toBe("refused");
    expect((await loadInboxItem(pool, ids.praise!))?.reply?.status).toBe("shadow");
  });

  it("approve: shadow → planned manual (dry run says so), alert acknowledged; a second tap is 'already queued'", async () => {
    const first = await approveAndSend(deps, ids.praise!, { sessionId: "x", now: NOW });
    expect(first).toMatchObject({ status: "queued", already: false, dryRun: true });
    expect(first.status === "queued" && first.message).toMatch(/dry run/);
    const { rows } = await pool.query(`select status, origin, text from engagement_actions where comment_id = $1`, [ids.praise]);
    expect(rows).toEqual([{ status: "planned", origin: "manual", text: "Appreciate you man" }]);
    const alert = await pool.query(`select acknowledged_at from alerts where message = $1`, [`dbtest ${run}`]);
    expect(alert.rows[0].acknowledged_at).not.toBeNull();
    expect(await approveAndSend(deps, ids.praise!, { sessionId: "x", now: NOW })).toMatchObject({ status: "queued", already: true });
    const after = await pool.query(`select count(*)::int n from engagement_actions where comment_id = $1`, [ids.praise]);
    expect(after.rows[0].n).toBe(1);
  });

  it("approve a flagged comment with typed text creates one manual action", async () => {
    const r = await approveAndSend(deps, ids.flag1!, { text: "Thanks man, full split soon", sessionId: "x", now: NOW });
    expect(r).toMatchObject({ status: "queued", already: false });
    expect((await approveAndSend(deps, ids.flag1!, { text: "again", sessionId: "x", now: NOW })).status).toBe("queued");
    const { rows } = await pool.query(`select status, origin, text from engagement_actions where comment_id = $1`, [ids.flag1]);
    expect(rows).toEqual([{ status: "planned", origin: "manual", text: "Thanks man, full split soon" }]);
  });

  it("always ignore: lists the author, moves their open drafted item to promo and cancels its shadow reply", async () => {
    const r = await addPromoAccount(pool, { commentId: ids.flag2! }, NOW);
    // flag2's shadow draft and flag1's still-planned manual reply (same author) are both cancelled: ignoring
    // an account only ever means sending less. flag1's triage row was handled by the approve, so it stays put.
    expect(r).toMatchObject({ added: true, authorKey: `dbt-${run}-page2`, commentsMoved: 1, repliesCancelled: 2 });
    expect((await loadInboxItem(pool, ids.flag2!))?.triage?.bucket).toBe("spam_promo");
    const list = await loadPromoAccounts(pool);
    const mine = list.find((a) => a.authorKey === `dbt-${run}-page2`)!;
    expect(mine).toMatchObject({ source: "manual", platform: "instagram" });
    expect(await addPromoAccount(pool, { commentId: ids.flag2! }, NOW)).toMatchObject({ added: false });
    expect(await removePromoAccount(pool, mine.id, NOW)).toBe(true);
    expect(await removePromoAccount(pool, mine.id, NOW)).toBe(false);
    expect((await loadPromoAccounts(pool)).some((a) => a.id === mine.id)).toBe(false);
  });

  it("add by handle (Settings): one open row however often, and the matcher ignores that handle without an author id", async () => {
    const handle = `dbt_${run}_hub`;
    await comment("byhandle", "nice video", "simple_positive", "hub", { shadow: "Thanks!" });
    const first = await addPromoAccountByHandle(pool, "instagram", `@@${handle.toUpperCase()}`, NOW);
    // The open comment from that handle (it has an author id) moves to promo and its shadow reply is cancelled.
    expect(first).toMatchObject({ added: true, authorKey: handle, platform: "instagram", commentsMoved: 1, repliesCancelled: 1 });
    expect((await loadInboxItem(pool, ids.byhandle!))?.triage?.bucket).toBe("spam_promo");
    expect(await addPromoAccountByHandle(pool, "instagram", handle, NOW)).toMatchObject({ added: false, authorKey: handle });
    const { rows } = await pool.query(`select display_handle, source from engagement_promo_accounts where platform = 'instagram' and author_key = $1 and removed_at is null`, [handle]);
    expect(rows).toEqual([{ display_handle: handle, source: "manual" }]);
    await expect(addPromoAccountByHandle(pool, "snapchat", handle, NOW)).rejects.toThrow(RangeError);
    const list = (await loadPromoAccounts(pool)).map((a) => ({ platform: a.platform, authorKey: a.authorKey }));
    expect(promoRule("love this", { platform: "instagram", authorId: null, authorHandle: `@${handle.toUpperCase()}` }, list)).toEqual({ bucket: "spam_promo", reason: "promo:list" });
    expect(promoRule("love this", { platform: "youtube", authorId: null, authorHandle: handle }, list)).toBeNull();
  });

  it("not spam: back to flag with a re-triage request; a rule-listed author comes off the list", async () => {
    await pool.query(`insert into engagement_promo_accounts (platform, author_key, source) values ('instagram', $1, 'rule')`, [`dbt-${run}-page1`]);
    const r = await markNotSpam(pool, { commentId: ids.promo! }, NOW);
    expect(r).toEqual({ moved: true, listRemoved: true });
    const { rows } = await pool.query(`select bucket, retriage_requested_at, not_spam_at from comment_triage where comment_id = $1`, [ids.promo]);
    expect(rows[0].bucket).toBe("flag");
    expect(rows[0].retriage_requested_at).not.toBeNull();
    expect(rows[0].not_spam_at).not.toBeNull();
    expect(await markNotSpam(pool, { commentId: ids.promo! }, NOW)).toEqual({ moved: false, listRemoved: false });
  });
});
