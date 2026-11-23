import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reel + sounds server actions: every one checks the session first; "Make the reel" inserts one queued
 * media_edits row on the real dev DB (DATABASE_URL, migrated through 0015) inside ONE rolled-back transaction,
 * and a refused submit returns the reason with every field as typed (no row).
 */
const url = process.env.DATABASE_URL;
const NO_SESSION = new Error("NO_SESSION (redirect to /login)");
const SESSION = { id: "5e5510e0-0000-4000-8000-000000000001", createdAt: new Date(), expiresAt: new Date(), hardExpiresAt: new Date() };
const auth = vi.hoisted(() => ({ requireSession: vi.fn() }));
const dbm = vi.hoisted(() => ({ getPool: vi.fn() }));
const nav = vi.hoisted(() => ({ redirect: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("../../../lib/auth/require.js", () => auth);
vi.mock("../../../lib/db.js", () => dbm);
vi.mock("next/navigation", () => ({ redirect: nav.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: nav.revalidatePath }));

class Redirect extends Error {
  constructor(public url: string) {
    super(`redirect ${url}`);
  }
}

const actions = await import("../reel-actions.js");
const EMPTY = { error: null, values: {}, n: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  nav.redirect.mockImplementation((u: string) => {
    throw new Redirect(u);
  });
});

describe("reel actions without a session", () => {
  it("every action refuses before touching the DB", async () => {
    auth.requireSession.mockRejectedValue(NO_SESSION);
    await expect(actions.makeReelAction(EMPTY, new FormData())).rejects.toBe(NO_SESSION);
    await expect(actions.uploadSoundForm(new FormData())).rejects.toBe(NO_SESSION);
    await expect(actions.archiveSoundForm(new FormData())).rejects.toBe(NO_SESSION);
    expect(dbm.getPool).not.toHaveBeenCalled();
  });
});

describe.skipIf(!url)("makeReelAction (db)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const run = randomUUID().slice(0, 8);
  let clip: string;
  let sound: string;

  const form = (over: Record<string, string> = {}) => {
    const fd = new FormData();
    const f = { mediaId: clip, soundId: sound, audio: "mix", trimStartS: "0", trimEndS: "8", soundVolume: "0.4", originalVolume: "", caption: `tempo squats #gym ${run}`, ...over };
    for (const [k, v] of Object.entries(f)) fd.set(k, v);
    return fd;
  };
  const rows = async () => (await db.query(`select * from media_edits where source_media_id = $1`, [clip])).rows;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await db.query("begin");
    clip = (
      await db.query(`insert into media (content_hash, source_path, r2_key, duration_s, pillar, status) values ($1, $2, $3, 12, 'gym', 'ready') returning id`, [
        `dbt-reel-act-${run}`,
        `/clips/${run}.mp4`,
        `library/dbt-act-${run}.mp4`,
      ])
    ).rows[0].id;
    sound = (await db.query(`insert into sounds (name, r2_key) values ('beat', $1) returning id`, [`sounds/dbt-act-${run}.mp3`])).rows[0].id;
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

  it("a refused submit returns the reason and the fields as typed; no row", async () => {
    const st = await actions.makeReelAction(EMPTY, form({ caption: "squats #a #b #c #d #e #f" }));
    expect(st.error).toMatch(/Caption: .*6 hashtags/);
    expect(st.values.caption).toBe("squats #a #b #c #d #e #f");
    expect(st.values.trimEndS).toBe("8");
    expect(st.n).toBe(1);
    expect(nav.redirect).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });

  it("a valid submit inserts one queued edit and redirects to the Reels list", async () => {
    await expect(actions.makeReelAction(EMPTY, form())).rejects.toMatchObject({ url: "/library/reels?done=queued" });
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ status: "queued", sound_id: sound, caption: `tempo squats #gym ${run}`, batch_item_id: null });
    expect(r[0].params).toEqual({ trimStartS: 0, trimEndS: 8, audio: "mix", soundVolume: 0.4, originalVolume: 1 });
  });

  it("archive redirects with a note", async () => {
    const fd = new FormData();
    fd.set("soundId", sound);
    await expect(actions.archiveSoundForm(fd)).rejects.toMatchObject({ url: "/library/sounds?done=archived" });
    expect((await db.query(`select archived_at from sounds where id = $1`, [sound])).rows[0].archived_at).not.toBeNull();
  });
});
