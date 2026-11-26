import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Studio (F24) server side: the export action and the status route check the session first; the action validates the
 * edit against the real dev DB (DATABASE_URL, migrated through 0016) inside ONE rolled-back transaction and queues one
 * media_edits row of kind 'studio'; the status route answers only for studio rows and only the asked ids.
 */
const url = process.env.DATABASE_URL;
const NO_SESSION = new Error("NO_SESSION (redirect to /login)");
const SESSION = { id: "5e5510e0-0000-4000-8000-000000000002", createdAt: new Date(), expiresAt: new Date(), hardExpiresAt: new Date() };
const auth = vi.hoisted(() => ({ requireSession: vi.fn() }));
const dbm = vi.hoisted(() => ({ getPool: vi.fn() }));

vi.mock("../../../lib/auth/require.js", () => auth);
vi.mock("../../../lib/db.js", () => dbm);
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { queueStudioRenderAction } = await import("../actions.js");
const { GET } = await import("../status/route.js");
const { loadStudioClips, studioTextProblems } = await import("../../../lib/studio/data.js");
const { resetFolderColumnCache } = await import("../../../lib/library/data.js");

beforeEach(() => vi.clearAllMocks());

describe("studio without a session", () => {
  it("the action and the status route refuse before touching the DB", async () => {
    auth.requireSession.mockRejectedValue(NO_SESSION);
    await expect(queueStudioRenderAction("{}")).rejects.toBe(NO_SESSION);
    await expect(GET(new Request("http://x/app/studio/status?ids="))).rejects.toBe(NO_SESSION);
    expect(dbm.getPool).not.toHaveBeenCalled();
  });
});

describe("studioTextProblems (pure)", () => {
  it("flags places, real-time whereabouts and blocklisted terms; plain overlays pass", () => {
    expect(studioTextProblems("Leg day: 100% effort", [])).toEqual([]);
    expect(studioTextProblems("Morning at Golds Gym", []).join()).toMatch(/place/);
    expect(studioTextProblems("secret spot", ["secret spot"]).join()).toMatch(/blocklisted/);
  });
});

describe.skipIf(!url)("studio action, loaders and status (db)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const run = randomUUID().slice(0, 8);
  let a: string;
  let b: string;
  let archived: string;
  let hidden: string;
  let sound: string;
  let oldSound: string;

  const clip = async (tag: string, over: { status?: string; r2?: string | null; folder?: string | null; duration?: number | null; poster?: string | null; audio?: boolean } = {}) =>
    (
      await db.query(
        `insert into media (content_hash, source_path, r2_key, duration_s, pillar, status, qa, poster_key, folder) values ($1, $2, $3, $4, 'gym', $5, $6::jsonb, $7, $8) returning id`,
        [
          `dbt-studio-act-${tag}-${run}`,
          `/clips/x/${tag}-${run}.mov`,
          over.r2 === undefined ? `library/dbt-studio-act-${tag}-${run}.mp4` : over.r2,
          over.duration === undefined ? 10 : over.duration,
          over.status ?? "ready",
          JSON.stringify({ probe: { durationS: 10, hasAudio: over.audio ?? true } }),
          over.poster ?? null,
          over.folder ?? null,
        ],
      )
    ).rows[0].id as string;
  const edl = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      v: 1,
      fit: "fill",
      clips: [
        { mediaId: a, inS: 0, outS: 4, speed: 1 },
        { mediaId: b, inS: 1, outS: 3, speed: 0.5 },
      ],
      texts: [{ text: "tempo squats", startS: 0, endS: 3, position: "bottom", style: "bold" }],
      sound: { soundId: sound, offsetS: 0, volume: 0.6 },
      originalVolume: 1,
      coverS: 2,
      ...over,
    });
  const studioRows = async () => (await db.query(`select * from media_edits where kind = 'studio' and source_media_id = any($1::uuid[])`, [[a, b, archived, hidden]])).rows;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await db.query("begin");
    a = await clip("a", { folder: "Week 1", poster: `posters/dbt-${run}.jpg` });
    b = await clip("b", { audio: false });
    archived = await clip("arch", { status: "archived" });
    hidden = await clip("hidden");
    const fixedFrom = await clip("orig");
    await db.query(`insert into media_fixes (media_id, fixed_media_id, ops, status) values ($1, $2, '{}', 'done')`, [fixedFrom, hidden]);
    sound = (await db.query(`insert into sounds (name, r2_key) values ('beat', $1) returning id`, [`sounds/dbt-studio-${run}.mp3`])).rows[0].id;
    oldSound = (await db.query(`insert into sounds (name, r2_key, archived_at) values ('old', $1, now()) returning id`, [`sounds/dbt-studio-old-${run}.mp3`])).rows[0].id;
    dbm.getPool.mockReturnValue(db);
  });

  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
  });

  beforeEach(() => {
    auth.requireSession.mockResolvedValue(SESSION);
    dbm.getPool.mockReturnValue(db);
  });

  it("queues one studio row: source = first clip, the sound, the normalised EDL as params, empty caption", async () => {
    const r = await queueStudioRenderAction(edl());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = (await db.query(`select * from media_edits where id = $1`, [r.editId])).rows[0];
    expect(row).toMatchObject({ kind: "studio", status: "queued", source_media_id: a, sound_id: sound, caption: "", batch_item_id: null, result_media_id: null });
    expect(row.params).toMatchObject({ v: 1, fit: "fill", coverS: 2 });
    expect(row.params.clips).toHaveLength(2);
  });

  it("refuses (no row): bad JSON, limits, unknown/archived/hidden clips, out point past the end, archived sound, a place in a text", async () => {
    const before = (await studioRows()).length;
    const refuse = async (json: string, re: RegExp) => {
      const r = await queueStudioRenderAction(json);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(re);
    };
    await refuse("nope", /couldn't be read/);
    await refuse("x".repeat(40_000), /couldn't be read/);
    await refuse(edl({ clips: [{ mediaId: a, inS: 0, outS: 2, speed: 1 }], coverS: null }), /at least 3 seconds/);
    await refuse(edl({ clips: [{ mediaId: randomUUID(), inS: 0, outS: 4, speed: 1 }] }), /Clip 1 isn't in the library/);
    await refuse(edl({ clips: [{ mediaId: a, inS: 0, outS: 4, speed: 1 }, { mediaId: archived, inS: 0, outS: 4, speed: 1 }] }), /Clip 2 isn't in the library/);
    await refuse(edl({ clips: [{ mediaId: hidden, inS: 0, outS: 4, speed: 1 }] }), /Clip 1 isn't in the library/);
    await refuse(edl({ clips: [{ mediaId: a, inS: 5, outS: 12, speed: 1 }] }), /past the end/);
    await refuse(edl({ sound: { soundId: oldSound, offsetS: 0, volume: 1 } }), /sound isn't available/);
    await refuse(edl({ texts: [{ text: "Morning at Golds Gym", startS: 0, endS: 2, position: "top", style: "plain" }] }), /Text 1: .*place/);
    await refuse(edl({ texts: [{ text: "x".repeat(81), startS: 0, endS: 2, position: "top", style: "plain" }] }), /over 80/);
    expect((await studioRows()).length).toBe(before);
  });

  it("a DB error becomes a fixed message", async () => {
    dbm.getPool.mockReturnValue({ query: async () => Promise.reject(new Error("connection refused at secret-host")) });
    expect(await queueStudioRenderAction(edl())).toEqual({ ok: false, error: "Something went wrong. Try again." });
  });

  it("loadStudioClips: eligible clips only, with folder, poster url, duration and audio flag", async () => {
    resetFolderColumnCache(db);
    const clips = await loadStudioClips(db);
    const ids = clips.map((c) => c.mediaId);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).not.toContain(archived);
    expect(ids).not.toContain(hidden);
    expect(clips.find((c) => c.mediaId === a)).toEqual({ mediaId: a, name: `a-${run}`, folder: "Week 1", durationS: 10, posterUrl: `/app/media/poster/${a}`, hasAudio: true });
    expect(clips.find((c) => c.mediaId === b)).toMatchObject({ posterUrl: null, hasAudio: false, folder: null });
  });

  it("status route: only studio rows and only the asked ids; failed rows carry the error; bad ids → 400", async () => {
    const q = await queueStudioRenderAction(edl());
    if (!q.ok) throw new Error(q.error);
    const result = await clip("result", { poster: `posters/dbt-res-${run}.jpg` });
    const done = (await db.query(`insert into media_edits (kind, source_media_id, params, status, result_media_id) values ('studio', $1, '{}'::jsonb, 'done', $2) returning id`, [a, result])).rows[0].id;
    const failed = (await db.query(`insert into media_edits (kind, source_media_id, params, status, error) values ('studio', $1, '{}'::jsonb, 'failed', 'ffmpeg said no') returning id`, [a])).rows[0].id;
    const reel = (await db.query(`insert into media_edits (kind, source_media_id, params) values ('reel', $1, '{}'::jsonb) returning id`, [a])).rows[0].id;
    const other = randomUUID();

    const res = await GET(new Request(`http://x/app/studio/status?ids=${[q.editId, done, failed, reel, other].join(",")}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual([
      { id: q.editId, status: "queued" },
      { id: done, status: "done", resultMediaId: result, posterUrl: `/app/media/poster/${result}` },
      { id: failed, status: "failed", error: "ffmpeg said no" },
    ]);
    expect((await GET(new Request("http://x/app/studio/status?ids=not-a-uuid"))).status).toBe(400);
    expect((await GET(new Request(`http://x/app/studio/status?ids=${Array(51).fill(other).join(",")}`))).status).toBe(400);
    expect(await (await GET(new Request("http://x/app/studio/status"))).json()).toEqual([]);
  });
});
