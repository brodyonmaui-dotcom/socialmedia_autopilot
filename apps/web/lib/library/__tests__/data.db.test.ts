import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dismissIssue, keepFix, keepOriginal, loadLibrary, loadTouchUp, requestFix } from "../data.js";

/**
 * Real dev DB (DATABASE_URL, migrated through 0014). Everything runs in ONE transaction that is rolled back,
 * so no fixture survives. Fixture clips carry a per-run tag in their source path; assertions only look at them.
 */
const url = process.env.DATABASE_URL;

const qaV2 = (issues: object[]) => ({ version: 2, issues, warnings: [], probe: { durationS: 12 } });
const FROZEN = { code: "frozen-tail", severity: "fix", fixable: true, detail: "The last 3 seconds are a frozen frame. Fix it trims them off.", segments: [{ start: 9, end: 12 }] };
const QUIET = { code: "loudness", severity: "fix", fixable: true, detail: "The sound is much quieter than normal. Fix it raises it to the usual level." };
const STILL = { code: "frozen-middle", severity: "fix", fixable: false, detail: "Mostly a still image. Re-export it." };
const NOSOUND = { code: "no-sound", severity: "info", fixable: false, detail: "No sound yet." };

describe.skipIf(!url)("library + touch-up data layer (db)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const run = randomUUID().slice(0, 8);
  const id: Record<string, string> = {};
  let session: string;

  const media = async (key: string, qa: unknown, extra: { derivedFrom?: string } = {}) => {
    const r = await db.query(
      `insert into media (content_hash, source_path, r2_key, duration_s, pillar, status, qa, derived_from, poster_key, created_at)
       values ($1, $2, $3, 12, 'gym', 'ready', $4::jsonb, $5, $6, now() - ($7 || ' seconds')::interval) returning id`,
      [`dbt-lib-${run}-${key}`, `/clips/${run}-${key}.mp4`, `library/dbt-${run}-${key}.mp4`, qa === null ? null : JSON.stringify(qa), extra.derivedFrom ?? null, key === "frozen" ? "demo/x.jpg" : null, String(Object.keys(id).length)],
    );
    id[key] = r.rows[0].id;
    return id[key]!;
  };
  const mine = <T extends { mediaId: string }>(xs: T[]) => xs.filter((x) => Object.values(id).includes(x.mediaId));

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await db.query("begin");
    session = (await db.query("select id from auth_sessions limit 1")).rows[0]?.id ?? null;
    await media("frozen", qaV2([FROZEN, NOSOUND]));
    await media("quiet", qaV2([QUIET]));
    await media("still", qaV2([STILL]));
    await media("clean", qaV2([NOSOUND]));
    await media("legacy", { warnings: ["3 frozen-frame segment(s)", "effectively silent (-60.0 LUFS)"] });
  });

  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
  });

  it("loadTouchUp: only clips with fix issues (legacy and info-only never), plain sentences, fix state none", async () => {
    const t = mine(await loadTouchUp(db));
    expect(t.map((c) => c.label).sort()).toEqual([`${run}-frozen`, `${run}-quiet`, `${run}-still`]);
    const frozen = t.find((c) => c.mediaId === id.frozen)!;
    expect(frozen.issues).toEqual([{ code: "frozen-tail", text: FROZEN.detail, fixable: true }]);
    expect(frozen.fixOps).toEqual(["trim"]);
    expect(frozen.fix).toEqual({ state: "none" });
    expect(frozen.hasPoster).toBe(true);
    expect(frozen.libraryHref).toBe(`/library?q=${run}-frozen&focus=${id.frozen}`);
    expect(t.find((c) => c.mediaId === id.still)!.fixOps).toEqual([]);
  });

  it("requestFix: bulk, only fixable ops, idempotent; not-fixable clips are skipped", async () => {
    const a = await requestFix(db, [id.frozen!, id.quiet!, id.still!, id.clean!, "not-a-uuid"], undefined, session);
    expect(a).toEqual({ queued: 2, already: 0, skipped: 3 });
    const b = await requestFix(db, [id.frozen!, id.quiet!], ["trim", "loudness", "pad"], session);
    expect(b).toEqual({ queued: 0, already: 2, skipped: 0 });
    const t = mine(await loadTouchUp(db));
    expect(t.find((c) => c.mediaId === id.frozen)!.fix).toMatchObject({ state: "queued", ops: ["trim"] });
  });

  it("failed state carries the plain reason; Keep the original hides it", async () => {
    await db.query("update media_fixes set status = 'failed', error = 'The fix would cut more than 30% of the clip, so nothing was changed.' where media_id = $1", [id.quiet]);
    const q = mine(await loadTouchUp(db)).find((c) => c.mediaId === id.quiet)!;
    expect(q.fix).toMatchObject({ state: "failed", reason: expect.stringMatching(/more than 30%/) });
    if (q.fix.state !== "failed") throw new Error("unreachable");
    expect(await keepOriginal(db, q.fix.fixId)).toEqual({ ok: true });
    expect(mine(await loadTouchUp(db)).map((c) => c.mediaId)).not.toContain(id.quiet);
  });

  it("done → Keep the fix re-points DRAFT items only, says how many stayed, and swaps the clip in the library", async () => {
    const fixed = await media("frozen-fixed", qaV2([NOSOUND]), { derivedFrom: id.frozen });
    await db.query(
      `update media_fixes set status = 'done', fixed_media_id = $2, before = '{"durationS":12}', after = '{"durationS":9}' where media_id = $1`,
      [id.frozen, fixed],
    );
    const batch = (await db.query("insert into batches (week_start, status) values ('2099-06-01', 'draft') returning id")).rows[0].id;
    const item = async (status: string) =>
      (await db.query("insert into batch_items (batch_id, media_id, platform, caption, status) values ($1, $2, 'instagram', 'x', $3) returning id", [batch, id.frozen, status])).rows[0].id;
    const draft1 = await item("draft");
    const draft2 = await item("draft");
    const approved = await item("approved");

    // Before the decision the fixed copy is hidden from the library; the original shows.
    let lib = mine((await loadLibrary(db, { q: run })).clips).map((c) => c.mediaId);
    expect(lib).toContain(id.frozen);
    expect(lib).not.toContain(fixed);

    const done = mine(await loadTouchUp(db)).find((c) => c.mediaId === id.frozen)!;
    expect(done.fix).toMatchObject({ state: "done", fixedMediaId: fixed, before: { durationS: 12 }, after: { durationS: 9 } });
    if (done.fix.state !== "done") throw new Error("unreachable");

    expect(await keepFix(db, done.fix.fixId, session)).toEqual({ ok: true, repointed: 2, stayed: 1 });
    expect(await keepFix(db, done.fix.fixId, session)).toEqual({ ok: false, reason: "this fix isn't ready to keep" });
    const items = (await db.query("select id, media_id from batch_items where id = any($1)", [[draft1, draft2, approved]])).rows;
    expect(Object.fromEntries(items.map((r) => [r.id, r.media_id]))).toEqual({ [draft1]: fixed, [draft2]: fixed, [approved]: id.frozen });
    const ev = (await db.query("select kind, detail from batch_item_events where batch_item_id = $1", [draft1])).rows;
    expect(ev).toEqual([{ kind: "edit", detail: expect.objectContaining({ field: "media", from: id.frozen, to: fixed }) }]);

    lib = mine((await loadLibrary(db, { q: run })).clips).map((c) => c.mediaId);
    expect(lib).toContain(fixed);
    expect(lib).not.toContain(id.frozen);
    expect(mine(await loadTouchUp(db)).map((c) => c.mediaId)).not.toContain(id.frozen);
    // Nothing was deleted: the original row is still there.
    expect((await db.query("select count(*)::int n from media where id = $1", [id.frozen])).rows[0].n).toBe(1);
  });

  it("dismissIssue hides that issue (idempotent); a clip with nothing left drops out", async () => {
    expect(await dismissIssue(db, id.still!, "frozen-middle", session)).toEqual({ ok: true });
    expect(await dismissIssue(db, id.still!, "frozen-middle", session)).toEqual({ ok: true });
    expect(mine(await loadTouchUp(db)).map((c) => c.mediaId)).not.toContain(id.still);
    expect(await dismissIssue(db, "nope", "x", session)).toEqual({ ok: false });
  });

  it("loadLibrary: tags from info issues (legacy too), used-in count, focus first, tag filter, paging", async () => {
    const page = await loadLibrary(db, { q: run, focus: id.clean });
    const clips = mine(page.clips);
    expect(clips[0]).toMatchObject({ mediaId: id.clean, focused: true, tags: [{ code: "no-sound", label: "No sound yet" }] });
    expect(clips.filter((c) => c.mediaId === id.clean)).toHaveLength(1);
    const legacy = clips.find((c) => c.mediaId === id.legacy)!;
    expect(legacy.flagged).toBe(0);
    expect(legacy.tags.map((t) => t.code)).toEqual(["recheck", "no-sound"]);
    const fixed = clips.find((c) => c.derivedFrom === id.frozen)!;
    expect(fixed.usedIn).toBe(2);
    expect(mine((await loadLibrary(db, { q: run, tag: "recheck" })).clips).map((c) => c.mediaId)).toEqual([id.legacy]);

    const p1 = await loadLibrary(db, { q: run, limit: 2 });
    expect(p1.clips).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await loadLibrary(db, { q: run, limit: 2, cursor: p1.nextCursor });
    expect(p2.clips.map((c) => c.mediaId).some((m) => p1.clips.some((c) => c.mediaId === m))).toBe(false);
  });
});
