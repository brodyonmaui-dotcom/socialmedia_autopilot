import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkDraft, createDraftBatch, type BatchDraft } from "../lib/batch-draft.js";

const sample = JSON.parse(readFileSync(new URL("../fixtures/draft-sample.json", import.meta.url), "utf8")) as BatchDraft;
const now = new Date("2026-11-11T12:00:00Z");
const clone = (): BatchDraft => JSON.parse(JSON.stringify(sample));

describe("checkDraft", () => {
  it("passes clean posts and blocks the trading placeholder until he gives the number", () => {
    const c = checkDraft(sample, { now });
    expect(c.posts).toBe(4);
    expect(c.findings.map((f) => `${f.item}:${f.platform}:${f.rule}`)).toEqual(["1:instagram:numbers.placeholder"]);
    expect(c.ok).toBe(false);
    expect(c.creatable).toBe(false);
  });

  it("is creatable once the number is real and every post has a future time", () => {
    const d = clone();
    d.items[1]!.posts.instagram!.caption = d.items[1]!.posts.instagram!.caption.replace("{{P/L}}", "+$120");
    expect(checkDraft(d, { now })).toMatchObject({ ok: true, creatable: true, errors: 0 });
    delete d.items[0]!.posts.tiktok!.scheduledFor;
    expect(checkDraft(d, { now })).toMatchObject({ ok: true, creatable: false });
  });

  it("flags location, past/offsetless times, missing YT title, unknown pillar, IG hashtag overflow", () => {
    const d = clone();
    d.items[1]!.posts.instagram!.caption = "Recap +$1. Not financial advice.";
    const ig = d.items[0]!.posts.instagram!;
    ig.caption = "Pull day at Riverside Fitness… #a #b #c #d #e #f";
    d.items[0]!.posts.youtube!.title = "";
    d.items[0]!.posts.tiktok!.scheduledFor = "2026-11-01T10:00:00Z";
    d.items[0]!.posts.tiktok!.tiktokDraft = true;
    d.items[1]!.posts.instagram!.scheduledFor = "2030-01-07T20:00:00";
    d.items[1]!.pillar = "crypto";
    const rules = checkDraft(d, { now }).findings.map((f) => f.rule);
    expect(rules).toEqual(
      expect.arrayContaining(["privacy.place", "hashtags.max", "youtube.title-missing", "time.past", "time.invalid", "item.pillar"]),
    );
  });

  it("a TikTok inbox draft is a warning, not an error, and names the 5-pending cap", () => {
    const d = clone();
    d.items[1]!.posts.instagram!.caption = d.items[1]!.posts.instagram!.caption.replace("{{P/L}}", "+$120");
    d.items[0]!.posts.tiktok!.tiktokDraft = true;
    const c = checkDraft(d, { now });
    expect(c).toMatchObject({ ok: true, creatable: true, errors: 0 });
    const f = c.findings.find((x) => x.rule === "tiktok.draft")!;
    expect(f).toMatchObject({ severity: "warn", platform: "tiktok" });
    expect(f.message).toMatch(/inbox/);
    expect(f.message).toMatch(/max 5 pending drafts per 24 h/);
    expect(c.findings.map((x) => x.rule)).not.toContain("tiktok.draft-unsupported");
  });

  it("warns on a copy-pasted caption within the week", () => {
    const d = clone();
    d.items[1] = { ...d.items[0]!, mediaId: "x", posts: { tiktok: { ...d.items[0]!.posts.tiktok! } } };
    expect(checkDraft(d, { now }).findings.map((f) => f.rule)).toContain("caption.duplicate");
  });

  it("applies the runtime privacy blocklist", () => {
    const d = clone();
    d.items[0]!.posts.instagram!.caption = "Leg day in springfield…";
    expect(checkDraft(d, { now, blocklist: ["Springfield"] }).findings.map((f) => f.rule)).toContain("privacy.blocklist");
  });
});

describe("createDraftBatch", () => {
  function fakeClient(mediaIds: string[], archived: string[] = []) {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    return {
      calls,
      async query(sql: string, params?: unknown[]) {
        calls.push({ sql, params });
        if (sql.startsWith("select id, status from media")) return { rows: mediaIds.map((id) => ({ id, status: archived.includes(id) ? "archived" : "ready" })) };
        if (sql.startsWith("insert into batches")) return { rows: [{ id: "batch-1" }] };
        return { rows: [] };
      },
    };
  }
  const ready = () => {
    const d = clone();
    d.items[1]!.posts.instagram!.caption = "Monday P/L +$120, took the 1:1R. Not financial advice.";
    return d;
  };

  it("writes one draft batch and draft items only, inside a transaction", async () => {
    const c = fakeClient(sample.items.map((i) => i.mediaId));
    const res = await createDraftBatch(c, ready(), { now });
    expect(res).toEqual({ batchId: "batch-1", items: 4 });
    const sqls = c.calls.map((x) => x.sql);
    expect(sqls[1]).toBe("begin");
    expect(sqls.at(-1)).toBe("commit");
    const inserts = c.calls.filter((x) => x.sql.includes("insert into batch_items"));
    expect(inserts).toHaveLength(4);
    for (const i of inserts) expect(i.sql).toMatch(/'draft'\)/);
    expect(sqls.some((s) => /approved/.test(s))).toBe(false);
    // the title is only stored for YouTube
    expect(inserts.find((i) => i.params?.[2] === "instagram")!.params?.[4]).toBeNull();
  });

  it("stores the TikTok draft flag in trial for that row only", async () => {
    const c = fakeClient(sample.items.map((i) => i.mediaId));
    const d = ready();
    d.items[0]!.posts.tiktok!.tiktokDraft = true;
    await createDraftBatch(c, d, { now });
    const inserts = c.calls.filter((x) => x.sql.includes("insert into batch_items"));
    expect(inserts[0]!.sql).toContain("trial");
    const tiktok = inserts.filter((i) => i.params?.[2] === "tiktok");
    expect(tiktok).toHaveLength(1);
    expect(tiktok[0]!.params?.[6]).toBe('{"tiktokDraft":true}');
    for (const i of inserts.filter((x) => x.params?.[2] !== "tiktok")) expect(i.params?.[6]).toBeNull();
  });

  it("refuses when media is missing from the library or the draft isn't creatable", async () => {
    await expect(createDraftBatch(fakeClient([]), ready(), { now })).rejects.toThrow(/not in the library/);
    await expect(createDraftBatch(fakeClient([]), sample, { now })).rejects.toThrow(/not creatable/);
  });

  it("refuses archived media (source file gone) and writes nothing", async () => {
    const ids = sample.items.map((i) => i.mediaId);
    const c = fakeClient(ids, [ids[0]!]);
    await expect(createDraftBatch(c, ready(), { now })).rejects.toThrow(/archived/);
    expect(c.calls.some((x) => x.sql.startsWith("insert"))).toBe(false);
  });

  it("rolls back when an insert fails", async () => {
    const c = fakeClient(sample.items.map((i) => i.mediaId));
    const orig = c.query;
    c.query = async (sql: string, params?: unknown[]) => {
      if (sql.includes("insert into batch_items")) throw new Error("boom");
      return orig(sql, params);
    };
    await expect(createDraftBatch(c, ready(), { now })).rejects.toThrow("boom");
    expect(c.calls.at(-1)!.sql).toBe("rollback");
  });
});
