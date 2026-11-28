import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { shortDay } from "@autopilot/core";
import { recentVideoUse } from "@autopilot/db";
import { PgBatchStore } from "../../batches/pg-store.js";
import { planTransition } from "../../batches/transitions.js";
import { loadBatchFresh, loadCalendar, loadClipSiblings } from "../load.js";

/**
 * Duplicate guard v2 (F26 A) + "already posted" against the dev DB (DATABASE_URL). Own rows only: two archived
 * media rows (archived = no library/job ever picks them) with a random tag, one batch in a random far-future
 * week, items left rejected at the end. Nothing is deleted.
 */
const url = process.env.DATABASE_URL;
const TAG = `dupclip-${randomBytes(6).toString("hex")}`;
// A random Monday in 2300–2399, far from every other fixture.
const YEAR = 2300 + Math.floor(Math.random() * 99);
const monday = (() => {
  const d = new Date(Date.UTC(YEAR, 10, 20));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
})();
const day = (n: number) => new Date(Date.parse(`${monday}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const at = (n: number, hh: string) => `${day(n)}T${hh}:00:00.000Z`;
const NOW = new Date(`${day(-7)}T12:00:00Z`);
const ENV = { ...process.env, TZ_CREATOR: "UTC" };

describe.skipIf(!url)("duplicate clip + already posted (db)", () => {
  let pool: pg.Pool;
  let batchId: string;
  let media: string;
  let other: string;
  const ids: Record<string, string> = {};

  const insert = async (key: string, m: string, platform: string, when: string | null, status: string) => {
    ids[key] = (
      await pool.query(
        `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, approved_at)
         values ($1, $2, $3, 'calm caption for the test', $4, $5, $6, case when $6 = 'approved' then now() end) returning id`,
        [batchId, m, platform, platform === "youtube" ? "A calm title" : null, when, status],
      )
    ).rows[0].id;
  };

  beforeAll(async () => {
    vi.stubEnv("TZ_CREATOR", "UTC");
    pool = new pg.Pool({ connectionString: url, max: 3 });
    const mk = async (n: number) =>
      (
        await pool.query(
          `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status)
           values ($1, null, $2, 12, 1080, 1920, 'gym', 'archived') returning id`,
          [`${TAG}-${n}`, `library/${TAG}-${n}.mp4`],
        )
      ).rows[0].id as string;
    media = await mk(1);
    other = await mk(2);
    batchId = (await pool.query(`insert into batches (week_start, status) values ($1, 'approved') returning id`, [monday])).rows[0].id;
    // The Nov 26 / Nov 27 shape: approved Thursday 09:00, drafted again Friday.
    await insert("approved", media, "tiktok", at(3, "09"), "approved");
    await insert("draft", media, "tiktok", at(4, "15"), "draft");
    await insert("ig", media, "instagram", at(4, "15"), "draft"); // other platform: fine
    await insert("rejected", other, "youtube", at(3, "09"), "rejected"); // rejected sibling: never counts
    await insert("yt", other, "youtube", at(4, "15"), "draft");
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`update batch_items set status = 'rejected', approved_at = null where batch_id = $1`, [batchId]);
    await pool.query(`update batches set status = 'draft', approved_at = null where id = $1`, [batchId]);
    await pool.end();
    vi.unstubAllEnvs();
  });

  const SCHED = () => `This video is already scheduled on TikTok for ${shortDay(at(3, "09"), "UTC")}`;

  it("recentVideoUse (F26 A): same clip on the same platform within 90 days blocks; other platform / rejected sibling don't", async () => {
    const hit = await recentVideoUse(pool, { mediaId: media, platform: "tiktok", at: at(4, "15"), now: NOW, excludeItemId: ids.draft });
    expect(hit.level).toBe("block");
    expect(hit.hit).toMatchObject({ id: ids.approved, platform: "tiktok", status: "approved", relation: "same", why: "same-clip" });
    expect((await recentVideoUse(pool, { mediaId: media, platform: "youtube", at: at(4, "15"), now: NOW })).level).toBeNull();
    expect((await recentVideoUse(pool, { mediaId: other, platform: "youtube", at: at(3, "09"), now: NOW, excludeItemId: ids.yt })).level).toBeNull();
    // 8 days apart still blocks now (the window is 90 days); 100 days apart only warns.
    expect((await recentVideoUse(pool, { mediaId: media, platform: "tiktok", at: at(12, "16"), now: NOW })).level).toBe("block");
    expect((await recentVideoUse(pool, { mediaId: media, platform: "tiktok", at: at(104, "16"), now: NOW })).level).toBe("warn");
    // The outbox's last check only counts what went out: two plans never hold each other.
    expect((await recentVideoUse(pool, { mediaId: media, platform: "tiktok", at: at(4, "15"), now: NOW, excludeItemId: ids.draft, wentOutOnly: true })).level).toBeNull();
  });

  it("loadBatchFresh: duplicate.clip blocks the draft (and names the approved post); no warning for other platform / rejected sibling", async () => {
    const fresh = await loadBatchFresh(pool, batchId, NOW, ENV);
    const ws = (k: string) => fresh!.batch.items.find((i) => i.id === ids[k])!.warnings.filter((w) => w.code === "duplicate.clip");
    expect(ws("draft")).toEqual([{ code: "duplicate.clip", severity: "block", message: SCHED(), itemId: ids.approved }]);
    expect(ws("approved")).toHaveLength(1);
    expect(ws("ig")).toEqual([]);
    expect(ws("yt")).toEqual([]);
    const plan = planTransition(fresh!.batch, { kind: "approve", itemIds: [ids.draft!] }, NOW);
    expect(plan).toMatchObject({ ok: false, reason: SCHED() });
  });

  it("loadCalendar supplies the siblings with ONE uses query for every batch in view", async () => {
    const spy = vi.spyOn(pool, "query");
    const data = await loadCalendar(pool, { from: day(0), to: day(6), now: NOW });
    const uses = spy.mock.calls.filter((c) => typeof c[0] === "string" && /from batch_items bi\s+where bi\.media_id = any/.test(c[0]));
    expect(uses).toHaveLength(1);
    spy.mockRestore();
    const line = data.entries.flatMap((e) => e.platforms).find((p) => p.itemId === ids.draft)!;
    expect(line).toMatchObject({ state: "needs-fix", fix: SCHED(), dropInline: SCHED() });
    expect(await loadClipSiblings(pool, [], NOW)).toEqual({ siblings: [], families: new Map() });
  });

  it("already posted: the reject with reason, then shown as 'Already posted' under Show rejected; the duplicate clears", async () => {
    const store = new PgBatchStore(pool);
    const fresh = await loadBatchFresh(pool, batchId, NOW, ENV);
    const plan = planTransition(fresh!.batch, { kind: "reject", itemIds: [ids.draft!], reason: "already-posted" }, NOW);
    if (!plan.ok) throw new Error(plan.reason);
    await store.apply(batchId, plan.changes, plan.batchStatus, null, NOW);
    const ev = (await pool.query(`select kind, from_status, to_status, detail from batch_item_events where batch_item_id = $1 order by id desc limit 1`, [ids.draft])).rows[0];
    expect(ev).toEqual({ kind: "reject", from_status: "draft", to_status: "rejected", detail: { reason: "already-posted" } });
    const key = (await pool.query(`select idempotency_key from batch_items where id = $1`, [ids.draft])).rows[0].idempotency_key;
    expect(key).toBeTruthy(); // untouched

    const after = await loadCalendar(pool, { from: day(0), to: day(6), now: NOW, showRejected: true });
    const lines = after.entries.flatMap((e) => e.platforms);
    expect(lines.find((p) => p.itemId === ids.draft)).toMatchObject({ state: "already-posted", statusLabel: "Already posted" });
    expect(lines.find((p) => p.itemId === ids.rejected)).toMatchObject({ state: "rejected" });
    // F26 A: the already-posted reject now counts as posted at its time, so the approved copy of the same video blocks.
    expect(lines.find((p) => p.itemId === ids.approved)!.warnings.find((w) => w.code === "duplicate.clip")?.message).toBe(
      `This video was already posted on TikTok on ${shortDay(at(4, "15"), "UTC")}`,
    );

    // Refused once published (or queued): nothing changes.
    await pool.query(`update batch_items set status = 'published', platform_post_id = $2 where id = $1`, [ids.approved, `${TAG}-pp`]);
    const again = await loadBatchFresh(pool, batchId, NOW, ENV);
    expect(planTransition(again!.batch, { kind: "reject", itemIds: [ids.approved!], reason: "already-posted" }, NOW).ok).toBe(false);
    await pool.query(`update batch_items set status = 'rejected', platform_post_id = null where id = $1`, [ids.approved]);
  });
});
