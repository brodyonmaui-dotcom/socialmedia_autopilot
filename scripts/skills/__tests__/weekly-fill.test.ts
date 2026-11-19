import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localToUtc } from "../../../packages/core/src/index.js";
import { createPool } from "../../../packages/db/src/client.js";
import {
  basename,
  checkFill,
  listPending,
  loadFillTargets,
  localSlot,
  nextWeekStart,
  parseFillFile,
  pendingSummary,
  weekOf,
  writeFill,
  type FillTarget,
} from "../lib/weekly-fill.js";

// Arbitrary fixture zone (same one the other tests use); never the creator's.
const TZ = "America/New_York";
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const C = "00000000-0000-4000-8000-0000000000c3";
const target = (id: string, o: Partial<FillTarget> = {}): FillTarget => ({ id, mediaId: "m1", platform: "instagram", status: "draft", pillar: "gym", title: null, weekStart: "2026-11-23", ...o });

describe("weeks", () => {
  it("next week = the Monday after now, creator-local (a Monday gives the following Monday)", () => {
    expect(nextWeekStart(new Date("2026-11-19T12:00:00Z"), TZ)).toBe("2026-11-23"); // Thu
    expect(nextWeekStart(new Date("2026-11-22T23:00:00Z"), TZ)).toBe("2026-11-23"); // Sun 18:00 local
    expect(nextWeekStart(new Date("2026-11-23T04:30:00Z"), TZ)).toBe("2026-11-23"); // still Sun 23:30 local
    expect(nextWeekStart(new Date("2026-11-23T05:30:00Z"), TZ)).toBe("2026-11-30"); // Mon 00:30 local
  });
  it("--week takes any date of the week and refuses non-dates", () => {
    expect(weekOf("2026-11-26")).toBe("2026-11-23");
    expect(weekOf("2026-11-23")).toBe("2026-11-23");
    expect(weekOf("2026-02-30")).toBeNull();
    expect(weekOf("next")).toBeNull();
    expect(weekOf(undefined)).toBeNull();
  });
  it("labels are file basenames only and times are local", () => {
    expect(basename("/Volumes/x/edits/pull day v2.mp4")).toBe("pull day v2.mp4");
    expect(basename("C:\\clips\\leg.mov")).toBe("leg.mov");
    expect(basename(null)).toBeNull();
    expect(localSlot("2026-11-23T23:30:00Z", TZ)).toBe("Mon 2026-11-23 18:30");
    expect(localSlot(null, TZ)).toBeNull();
  });
});

describe("parseFillFile", () => {
  it("accepts the pending list as a template (extra keys ignored)", () => {
    expect(parseFillFile([{ id: A, caption: "x", platform: "youtube", title: "T", label: "a.mp4" }])).toEqual([{ id: A, caption: "x", title: "T" }]);
  });
  it("refuses bad shapes and repeated ids", () => {
    expect(() => parseFillFile({ id: A })).toThrow(/array/);
    expect(() => parseFillFile([{ id: "nope", caption: "" }])).toThrow(/uuid/);
    expect(() => parseFillFile([{ id: A }])).toThrow(/caption/);
    expect(() => parseFillFile([{ id: A, caption: "a" }, { id: A, caption: "b" }])).toThrow(/twice/);
  });
});

describe("checkFill (checkDraft's rules)", () => {
  const rules = (c: ReturnType<typeof checkFill>) => c.findings.map((f) => `${f.id === A ? "A" : f.id === B ? "B" : "C"}:${f.rule}`);

  it("passes clean text", () => {
    const c = checkFill([{ id: A, caption: "Pull day, same four lifts as last week." }, { id: B, caption: "Leg day, slow reps.", title: "Leg day, slow reps" }], [target(A), target(B, { platform: "youtube" })]);
    expect(c).toMatchObject({ ok: true, entries: 2, errors: 0 });
  });

  it("voice lint, location, blocklist, IG hashtags, YouTube title, empty caption", () => {
    const c = checkFill(
      [
        { id: A, caption: "Pull day at Riverside Fitness #a #b #c #d #e #f" },
        { id: B, caption: "Leg day in springfield." },
        { id: C, caption: "" },
      ],
      [target(A), target(B, { platform: "youtube" }), target(C, { platform: "tiktok" })],
      { blocklist: ["Springfield"] },
    );
    expect(c.ok).toBe(false);
    expect(rules(c)).toEqual(expect.arrayContaining(["A:privacy.place", "A:hashtags.max", "B:privacy.blocklist", "B:youtube.title-missing", "C:caption.empty"]));
  });

  it("keeps an existing YouTube title when the entry has none", () => {
    expect(checkFill([{ id: B, caption: "Leg day, slow reps." }], [target(B, { platform: "youtube", title: "Leg day" })]).ok).toBe(true);
  });

  it("refuses unknown ids and anything that isn't a draft", () => {
    const c = checkFill([{ id: A, caption: "Fine." }, { id: B, caption: "Fine too." }], [target(A, { status: "approved" })]);
    expect(rules(c)).toEqual(["A:fill.not-draft", "B:fill.unknown"]);
    expect(c.ok).toBe(false);
  });

  it("a clip with no pillar yet is linted without one; a trading clip keeps its rules", () => {
    expect(checkFill([{ id: A, caption: "Pull day." }], [target(A, { pillar: null })]).ok).toBe(true);
    expect(rules(checkFill([{ id: A, caption: "Up {{P/L}} today." }], [target(A, { pillar: "trading" })]))).toContain("A:numbers.placeholder");
  });

  it("an empty file is not ok", () => {
    expect(checkFill([], []).ok).toBe(false);
  });
});

describe("pendingSummary", () => {
  it("counts captions, titles and clips", () => {
    const base = { pillar: "gym", scheduledFor: null, durationS: 20, label: "a.mp4", origin: "weekly" };
    expect(
      pendingSummary([
        { ...base, id: A, mediaId: "m1", platform: "instagram", caption: "" },
        { ...base, id: B, mediaId: "m1", platform: "youtube", caption: "x", title: "" },
        { ...base, id: C, mediaId: "m2", platform: "tiktok", caption: "" },
      ]),
    ).toBe("3 post(s) need text (2 caption(s), 1 YouTube title(s)) across 2 clip(s)");
  });
});

it("the CLI keeps fill dry without --write and prints one summary line", () => {
  const src = readFileSync(new URL("../weekly-batch.ts", import.meta.url), "utf8");
  expect(src).toMatch(/const write = argv\.includes\("--write"\)/);
  expect(src).toMatch(/write && check\.ok \? \(await writeFill/);
  expect(src).not.toMatch(/approved_at|'approved'/);
});

/**
 * Against the scratch DB (DATABASE_URL). A throwaway batch in a far-future week (2097-04-01); fixtures are
 * upserted by ingest_key into their starting state at the start of each run and rejected at the end.
 * Nothing is ever deleted.
 */
const url = process.env.DATABASE_URL;
const WEEK = "2097-04-01";

describe.skipIf(!url)("pending / fill (db)", () => {
  let pool: ReturnType<typeof createPool>;
  let batchId: string;
  const ids: Record<string, string> = {};
  const at = (day: number, hhmm: string) => localToUtc(`2097-04-0${day}`, hhmm, TZ);

  beforeAll(async () => {
    pool = createPool(url!);
    const media = (await pool.query("select id from media where r2_key is not null order by created_at, id limit 1")).rows[0];
    if (!media) throw new Error("seed the dev DB first (pnpm dev:seed): need media with an r2_key");
    const found = (await pool.query("select id from batches where week_start = $1 and status <> 'archived' order by created_at, id limit 1", [WEEK])).rows[0];
    batchId = found?.id ?? (await pool.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [WEEK])).rows[0].id;
    const fixture = async (key: string, platform: string, caption: string, title: string | null, status: string, when: Date | null, origin: string | null) => {
      const r = await pool.query(
        `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, origin, ingest_key, approved_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, null)
         on conflict (ingest_key) where ingest_key is not null do update
           set batch_id = excluded.batch_id, caption = excluded.caption, title = excluded.title, scheduled_for = excluded.scheduled_for,
               status = excluded.status, origin = excluded.origin, approved_at = null
         returning id`,
        [batchId, media.id, platform, caption, title, when, status, origin, `test-f14-t2:${key}`],
      );
      ids[key] = r.rows[0].id;
    };
    await fixture("ig", "instagram", "", null, "draft", at(2, "18:00"), "weekly");
    await fixture("yt", "youtube", "", "", "draft", at(2, "18:30"), "weekly");
    await fixture("tt", "tiktok", "", null, "draft", at(2, "19:00"), "weekly");
    await fixture("yt-title", "youtube", "Has a caption.", "", "draft", at(3, "18:00"), "editor");
    await fixture("done", "instagram", "Already written.", null, "draft", at(3, "18:00"), "editor");
    await fixture("approved", "instagram", "", null, "approved", at(4, "18:00"), null);
    await fixture("rejected", "tiktok", "", null, "rejected", at(4, "18:00"), "weekly");
    await fixture("untimed", "tiktok", "", null, "draft", null, null);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("update batch_items set status = 'rejected', approved_at = null where ingest_key like 'test-f14-t2:%'");
    await pool.end();
  });

  it("lists draft items of the week with empty caption or empty YouTube title, any origin", async () => {
    const items = await listPending(pool, WEEK, TZ);
    const got = items.map((i) => i.id).filter((id) => Object.values(ids).includes(id));
    expect(new Set(got)).toEqual(new Set([ids.ig, ids.yt, ids.tt, ids["yt-title"], ids.untimed]));
    const yt = items.find((i) => i.id === ids.yt)!;
    expect(yt).toMatchObject({ platform: "youtube", scheduledFor: "Tue 2097-04-02 18:30", caption: "", title: "" });
    expect(items.find((i) => i.id === ids.ig)).not.toHaveProperty("title");
    expect(yt.label === null || !/[\\/]/.test(yt.label)).toBe(true);
    // Another week sees none of them.
    expect((await listPending(pool, "2097-04-08", TZ)).some((i) => Object.values(ids).includes(i.id))).toBe(false);
  });

  it("fill without --write changes nothing; with --write stores text + one 'edit' event, still draft", async () => {
    const entries = [
      { id: ids.ig!, caption: "Pull day, same four lifts as last week." },
      { id: ids.yt!, caption: "Pull day, four lifts.", title: "Pull day, four lifts" },
    ];
    const check = checkFill(entries, await loadFillTargets(pool, entries.map((e) => e.id)));
    expect(check).toMatchObject({ ok: true, errors: 0 });
    expect((await pool.query("select caption from batch_items where id = $1", [ids.ig])).rows[0].caption).toBe("");

    const client = await pool.connect();
    try {
      expect(await writeFill(client, entries)).toEqual({ written: 2 });
    } finally {
      client.release();
    }
    const rows = (await pool.query("select id, caption, title, status, approved_at from batch_items where id = any($1::uuid[])", [[ids.ig, ids.yt]])).rows;
    const ig = rows.find((r) => r.id === ids.ig)!;
    const yt = rows.find((r) => r.id === ids.yt)!;
    expect(ig).toMatchObject({ caption: entries[0]!.caption, title: null, status: "draft", approved_at: null });
    expect(yt).toMatchObject({ caption: entries[1]!.caption, title: "Pull day, four lifts", status: "draft", approved_at: null });
    const ev = (await pool.query("select kind, from_status, to_status, detail from batch_item_events where batch_item_id = $1 order by id desc limit 1", [ids.yt])).rows[0];
    expect(ev).toMatchObject({ kind: "edit", from_status: "draft", to_status: "draft", detail: { caption: entries[1]!.caption, title: "Pull day, four lifts" } });

    const after = (await listPending(pool, WEEK, TZ)).map((i) => i.id);
    expect(after).not.toContain(ids.ig);
    expect(after).not.toContain(ids.yt);
  });

  it("refuses a non-draft item and writes nothing for the whole file", async () => {
    const entries = [
      { id: ids.tt!, caption: "Short one." },
      { id: ids.approved!, caption: "Should never land." },
    ];
    expect(checkFill(entries, await loadFillTargets(pool, entries.map((e) => e.id))).findings.filter((f) => f.severity === "error").map((f) => f.rule)).toEqual(["fill.not-draft"]);
    const client = await pool.connect();
    try {
      await expect(writeFill(client, entries)).rejects.toThrow(/nothing written/);
    } finally {
      client.release();
    }
    const rows = (await pool.query("select caption from batch_items where id = any($1::uuid[])", [[ids.tt, ids.approved]])).rows;
    expect(rows.map((r) => r.caption)).toEqual(["", ""]);
  });
});
