// Fable to review
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeItem } from "../../batches/__tests__/fixtures.js";
import { getEditorApprovalCounts, parseEditorApprovalCounts, setEditorApprovalCounts } from "../../settings/editor-approval.js";
import { itemTitle, runEditorAutoApprove, scheduledMessage } from "../auto-approve-run.js";

describe("auto-approve runner (pure parts)", () => {
  const NOW = new Date("2026-11-13T12:00:00.000Z"); // Friday
  it("message: YouTube title, else the caption's first line (≤ 60), weekday only when not today", () => {
    expect(scheduledMessage(makeItem({ platform: "youtube", title: "Morning setup", caption: "x", scheduledFor: "2026-11-13T18:30:00.000Z" }), NOW, "UTC")).toBe("Scheduled: Morning setup at 6:30 PM");
    expect(scheduledMessage(makeItem({ platform: "instagram", caption: "\n Recap of the week \nmore", scheduledFor: "2026-11-17T09:05:00.000Z" }), NOW, "UTC")).toBe("Scheduled: Recap of the week at Tue 9:05 AM");
    const long = itemTitle(makeItem({ caption: "a".repeat(80) }));
    expect(long).toHaveLength(60);
    expect(long.endsWith("…")).toBe(true);
    // Creator zone decides "today": 23:30 UTC is already Saturday two hours east.
    expect(scheduledMessage(makeItem({ caption: "c", scheduledFor: "2026-11-13T23:30:00.000Z" }), NOW, "Etc/GMT-2")).toBe("Scheduled: c at Sat 1:30 AM");
  });

  it("parseEditorApprovalCounts: only exactly true is on", () => {
    expect(parseEditorApprovalCounts({ approvalCounts: true })).toBe(true);
    for (const v of [undefined, null, {}, [], { approvalCounts: "true" }, { approvalCounts: 1 }, { approvalCounts: false }, true]) expect(parseEditorApprovalCounts(v)).toBe(false);
  });

  it("setting off → returns 0 after the settings read, without querying items or taking a connection", async () => {
    const sql: string[] = [];
    const pool = {
      query: async (q: string) => {
        sql.push(q);
        return { rows: [] };
      },
      connect: async () => {
        throw new Error("must not connect");
      },
    } as unknown as pg.Pool;
    expect(await runEditorAutoApprove(pool, NOW, "UTC")).toEqual({ approved: 0 });
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/from settings/);
  });
});

/**
 * Real dev DB (DATABASE_URL). Fresh fixture items in a far-future week every run (an item that was ever
 * auto-approved is never auto-approved again, so rows can't be reused); at the end they are rejected, their
 * alerts acknowledged + marked pushed, and the 'editor' setting is put back. Nothing is deleted.
 */
const url = process.env.DATABASE_URL;
const WEEK = "2098-06-02"; // a Monday; // unique: handoff store.db.test uses 2099-03-02 (they raced in a parallel run)

describe.skipIf(!url)("runEditorAutoApprove (db)", () => {
  let pool: pg.Pool;
  let batchId: string;
  let clean: string; // instagram, trade-recaps, approved in the editor, no warnings → auto-approved
  let blocked: string; // youtube, same render, {{placeholder}} caption → stays draft
  let manual: string; // tiktok, source manual → stays draft
  let original: unknown;
  let existed = false;
  const now = new Date();
  const mine = () => [clean, blocked, manual].filter(Boolean);

  const status = async (id: string) => (await pool.query("select status, approved_at, approved_session from batch_items where id = $1", [id])).rows[0];
  const events = async (id: string) => (await pool.query("select kind, from_status, to_status, session_id, detail from batch_item_events where batch_item_id = $1 and kind = 'approve-editor'", [id])).rows;
  const alerts = async (id: string) => (await pool.query("select kind, platform, message, batch_item_id from alerts where batch_item_id = $1 and kind = 'auto-scheduled'", [id])).rows;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    const row = (await pool.query("select value from settings where key = 'editor'")).rows[0];
    existed = !!row;
    original = row?.value ?? {};
    // Its own never-posted clip: a seed clip already posted (even long ago) carries a duplicate-guard warning (F26 A),
    // and "zero warnings" would then rightly keep it from auto-approving.
    const media = (
      await pool.query(
        `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status) values ($1, $2, $3, 21, 1080, 1920, 'trading', 'ready')
         on conflict (content_hash) do update set status = 'ready' returning id`,
        ["test-auto-approve-clip", "auto-approve-fixture-clip.mp4", "library/test-auto-approve-clip.mp4"],
      )
    ).rows[0];
    const found = (await pool.query("select id from batches where week_start = $1 order by created_at, id limit 1", [WEEK])).rows[0];
    batchId = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [WEEK])).rows[0].id;
    await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1 and status in ('draft', 'approved')", [batchId]);
    await pool.query("update batches set status = 'draft', approved_at = null where id = $1", [batchId]);

    const trial = (source: string) => JSON.stringify({ editor: { source, pillar: "trading", when: "this-week", earliest: null, approvedInEditor: new Date(now.getTime() - 60_000).toISOString(), flags: [] } });
    const ins = async (platform: string, caption: string, title: string | null, source: string, at: string) =>
      (
        await pool.query(
          `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, origin, trial, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, 'draft', 'editor', $7::jsonb, now(), now()) returning id`,
          [batchId, media.id, platform, caption, title, at, trial(source)],
        )
      ).rows[0].id as string;
    clean = await ins("instagram", "Recap of the session: three setups, one entry.\n\n#trading #daytrading", null, "trade-recaps", "2098-06-03T15:00:00.000Z");
    blocked = await ins("youtube", "Recap {{fill}}", "Session recap", "trade-recaps", "2098-06-03T16:00:00.000Z");
    manual = await ins("tiktok", "Recap of the session, short cut. #trading", null, "manual", "2098-06-03T17:00:00.000Z");
  });

  afterAll(async () => {
    if (pool) {
      if (batchId) {
        await pool.query("update batch_items set status = 'rejected', approved_at = null, approved_session = null where batch_id = $1 and status in ('draft', 'approved')", [batchId]);
        await pool.query("update batches set status = 'draft', approved_at = null where id = $1", [batchId]);
        await pool.query("update alerts set acknowledged_at = coalesce(acknowledged_at, now()), pushed_at = coalesce(pushed_at, now()) where batch_item_id = any($1::uuid[])", [mine()]);
      }
      if (existed) await pool.query("update settings set value = $1::jsonb, updated_at = now() where key = 'editor'", [JSON.stringify(original)]);
      else await setEditorApprovalCounts(pool, false);
      await pool.end();
    }
  });

  it("off → nothing is approved", async () => {
    await setEditorApprovalCounts(pool, false);
    expect(await getEditorApprovalCounts(pool)).toBe(false);
    expect(await runEditorAutoApprove(pool, now, "UTC")).toEqual({ approved: 0 });
    for (const id of mine()) {
      expect((await status(id)).status).toBe("draft");
      expect(await events(id)).toEqual([]);
      expect(await alerts(id)).toEqual([]);
    }
  });

  it("setEditorApprovalCounts writes the audit row only on a change", async () => {
    const since = new Date(Date.now() - 1000);
    expect(await setEditorApprovalCounts(pool, true)).toEqual({ before: false, after: true });
    expect(await setEditorApprovalCounts(pool, true)).toEqual({ before: true, after: true });
    const rows = (await pool.query("select message, acknowledged_at, pushed_at from alerts where kind = 'settings-change' and message like 'Editor approval counts:%' and created_at >= $1", [since])).rows;
    expect(rows.map((r) => r.message)).toEqual(["Editor approval counts: on"]);
    expect(rows[0].acknowledged_at).not.toBeNull();
  });

  it("on → the clean editor item is approved with an approve-editor event and an auto-scheduled alert; the others stay", async () => {
    expect(await getEditorApprovalCounts(pool)).toBe(true);
    const r = await runEditorAutoApprove(pool, now, "UTC");
    expect(r.approved).toBeGreaterThanOrEqual(1);

    const s = await status(clean);
    expect(s.status).toBe("approved");
    expect(s.approved_at).not.toBeNull();
    expect(s.approved_session).toBeNull();
    const ev = await events(clean);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "approve-editor", from_status: "draft", to_status: "approved", session_id: null });
    expect(ev[0].detail).toMatchObject({ source: "trade-recaps" });
    const al = await alerts(clean);
    expect(al).toEqual([{ kind: "auto-scheduled", platform: "instagram", message: "Scheduled: Recap of the session: three setups, one entry. at Tue 3:00 PM", batch_item_id: clean }]);
    expect((await pool.query("select status from batches where id = $1", [batchId])).rows[0].status).toBe("approved");

    for (const id of [blocked, manual]) {
      expect((await status(id)).status).toBe("draft");
      expect(await events(id)).toEqual([]);
      expect(await alerts(id)).toEqual([]);
    }
  });

  it("a second run approves nothing new for these items (idempotent)", async () => {
    await runEditorAutoApprove(pool, now, "UTC");
    expect(await events(clean)).toHaveLength(1);
    expect(await alerts(clean)).toHaveLength(1);
    for (const id of [blocked, manual]) expect((await status(id)).status).toBe("draft");
  });

  it("pulled back (approved → draft with an unapprove event) → never re-approved", async () => {
    await pool.query("update batch_items set status = 'draft', approved_at = null where id = $1", [clean]);
    await pool.query("insert into batch_item_events (batch_item_id, kind, from_status, to_status, at) values ($1, 'unapprove', 'approved', 'draft', now())", [clean]);
    await runEditorAutoApprove(pool, now, "UTC");
    expect((await status(clean)).status).toBe("draft");
    expect(await events(clean)).toHaveLength(1);
  });

  it("two concurrent runs never double-approve (advisory lock + conditional update)", async () => {
    // The blocked YouTube item would make the new one a duplicate.media warning (same clip, same platform).
    await pool.query("update batch_items set status = 'rejected' where id = $1", [blocked]);
    const fresh = (
      await pool.query(
        `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, origin, trial, created_at, updated_at)
         select batch_id, media_id, 'youtube', 'Second recap of the session. #trading', 'Second recap', '2098-06-04T15:00:00.000Z', 'draft', 'editor', trial, now(), now()
           from batch_items where id = $1 returning id`,
        [clean],
      )
    ).rows[0].id as string;
    try {
      const [a, b] = await Promise.all([runEditorAutoApprove(pool, now, "UTC"), runEditorAutoApprove(pool, now, "UTC")]);
      expect(Math.min(a.approved, b.approved)).toBe(0); // the second run found the lock taken (or nothing left)
      expect((await status(fresh)).status).toBe("approved");
      expect(await events(fresh)).toHaveLength(1);
      expect(await alerts(fresh)).toHaveLength(1);
    } finally {
      await pool.query("update alerts set acknowledged_at = coalesce(acknowledged_at, now()), pushed_at = coalesce(pushed_at, now()) where batch_item_id = $1", [fresh]);
    }
  });
});
