import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addSound, archiveSound, listReels, listSounds, loadReelSource, reelCaptionProblems, reelRequestFromForm, requestReel, sniffSound, SOUND_MAX_BYTES } from "../data.js";

/**
 * Real dev DB (DATABASE_URL, migrated through 0015). Everything runs in ONE transaction that is rolled back,
 * so no fixture survives. Storage is a recording fake. Assertions only look at this run's rows.
 */
const url = process.env.DATABASE_URL;

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
const WAV = new Uint8Array([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WAVE"].map((c) => c.charCodeAt(0))));
const M4A = new Uint8Array([0, 0, 0, 0x20, ..."ftypM4A ".split("").map((c) => c.charCodeAt(0))]);

describe("sniffSound + caption rules (pure)", () => {
  it("recognises mp3 / wav / m4a by content", () => {
    expect(sniffSound(MP3)).toBe("mp3");
    expect(sniffSound(new Uint8Array([0xff, 0xfb, 0x90]))).toBe("mp3");
    expect(sniffSound(WAV)).toBe("wav");
    expect(sniffSound(M4A)).toBe("m4a");
    expect(sniffSound(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it("caption: required, IG ≤ 5 hashtags, no places, no placeholders (the calendar's lint)", () => {
    expect(reelCaptionProblems("  ", "gym", [])).toEqual(["needs a caption"]);
    expect(reelCaptionProblems("slow tempo squats #gym #legs", "gym", [])).toEqual([]);
    expect(reelCaptionProblems("squats #a #b #c #d #e #f", "gym", []).join()).toMatch(/6 hashtags/);
    expect(reelCaptionProblems("squats at the Golden Gate Park right now", "gym", []).length).toBeGreaterThan(0);
    expect(reelCaptionProblems("hit {{weight}} today", "gym", []).length).toBeGreaterThan(0);
    expect(reelCaptionProblems("squats with secretword", "gym", ["secretword"]).join()).toMatch(/blocklisted/);
  });

  it("form fields → request: blanks are null, 'keep original' sets the audio mode", () => {
    const fd = new FormData();
    fd.set("mediaId", " abc ");
    fd.set("soundId", "original");
    fd.set("audio", "mix");
    fd.set("trimStartS", "1.5");
    fd.set("trimEndS", "");
    fd.set("soundVolume", "x");
    fd.set("caption", "hi");
    expect(reelRequestFromForm(fd)).toEqual({ mediaId: "abc", soundId: null, audio: "original", trimStartS: 1.5, trimEndS: null, soundVolume: NaN, originalVolume: null, caption: "hi" });
  });
});

describe.skipIf(!url)("reels data layer (db)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const run = randomUUID().slice(0, 8);
  const puts: Array<{ key: string; type: string; n: number }> = [];
  const put = async (key: string, body: Uint8Array, type: string) => {
    puts.push({ key, type, n: body.byteLength });
  };
  let clip: string;
  let silent: string;
  let soundId: string;
  const caption = `slow tempo squats #gym #legs ${run}`;
  const base = () => ({ mediaId: clip, soundId, audio: "sound", trimStartS: 1, trimEndS: 10, soundVolume: 0.8, originalVolume: null, caption });

  const media = async (key: string, over: { durationS?: number; status?: string; r2?: string | null; hasAudio?: boolean } = {}) =>
    (
      await db.query(
        `insert into media (content_hash, source_path, r2_key, duration_s, pillar, status, qa) values ($1, $2, $3, $4, 'gym', $5, $6::jsonb) returning id`,
        [`dbt-reel-web-${run}-${key}`, `/clips/${run}-${key}.mp4`, over.r2 === undefined ? `library/dbt-${run}-${key}.mp4` : over.r2, over.durationS ?? 20, over.status ?? "ready", JSON.stringify({ version: 2, issues: [], probe: { hasAudio: over.hasAudio ?? true } })],
      )
    ).rows[0].id as string;
  const edits = async (mediaId: string) => (await db.query(`select * from media_edits where source_media_id = $1 order by requested_at`, [mediaId])).rows;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await db.query("begin");
    clip = await media("clip");
    silent = await media("silent", { hasAudio: false });
    const s = await addSound(db, { fileName: `beat-${run}.mp3`, bytes: new Uint8Array([...MP3, ...new TextEncoder().encode(run)]) }, put);
    if (!s.ok) throw new Error(s.reason);
    soundId = s.id;
  });

  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
  });

  it("addSound: uploads to sounds/<sha256>.<ext> and inserts one row; the same bytes twice is one row", async () => {
    expect(puts[0]).toMatchObject({ type: "audio/mpeg" });
    expect(puts[0]!.key).toMatch(/^sounds\/[0-9a-f]{64}\.mp3$/);
    const row = (await db.query(`select * from sounds where id = $1`, [soundId])).rows[0];
    expect(row).toMatchObject({ name: `beat-${run}`, r2_key: puts[0]!.key, archived_at: null });
    const again = await addSound(db, { fileName: "other-name.mp3", bytes: new Uint8Array([...MP3, ...new TextEncoder().encode(run)]) }, put);
    expect(again).toEqual({ ok: true, id: soundId, already: true });
    expect(puts).toHaveLength(1);
  });

  it("addSound refuses: wrong type, fake content, empty, over 15 MB, no storage", async () => {
    expect(await addSound(db, { fileName: "a.ogg", bytes: MP3 }, put)).toMatchObject({ ok: false, reason: "Pick an mp3, m4a or wav file." });
    expect(await addSound(db, { fileName: "a.wav", bytes: MP3 }, put)).toMatchObject({ ok: false, reason: "That file isn't a real wav file." });
    expect(await addSound(db, { fileName: "a.mp3", bytes: new Uint8Array() }, put)).toMatchObject({ ok: false, reason: "That file is empty." });
    const big = new Uint8Array(SOUND_MAX_BYTES + 1);
    big.set(MP3);
    expect(await addSound(db, { fileName: "a.mp3", bytes: big }, put)).toMatchObject({ ok: false, reason: "That file is over 15 MB." });
    expect((await addSound(db, { fileName: "a.m4a", bytes: M4A }, null)).ok).toBe(false);
    expect(puts).toHaveLength(1);
  });

  it("requestReel: a valid request inserts one queued media_edits row with the resolved params and the caption", async () => {
    const r = await requestReel(db, base(), { blocklist: [] });
    expect(r.ok).toBe(true);
    const [e] = await edits(clip);
    expect(e).toMatchObject({ kind: "reel", status: "queued", sound_id: soundId, caption, result_media_id: null, batch_item_id: null });
    expect(e.params).toEqual({ trimStartS: 1, trimEndS: 10, audio: "sound", soundVolume: 0.8, originalVolume: null });
  });

  it("requestReel: keeping the clip's own sound stores no sound", async () => {
    const r = await requestReel(db, { ...base(), soundId: null, audio: "original", originalVolume: 1.2 }, { blocklist: [] });
    expect(r.ok).toBe(true);
    const e = (await edits(clip)).at(-1);
    expect(e).toMatchObject({ sound_id: null });
    expect(e.params).toMatchObject({ audio: "original", soundVolume: null, originalVolume: 1.2 });
  });

  it("requestReel refuses (no row): length, volume, sound, caption, unusable clip", async () => {
    const before = (await edits(clip)).length;
    const no = async (over: object, re: RegExp) => {
      const r = await requestReel(db, { ...base(), ...over }, { blocklist: ["privateword"] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(re);
    };
    await no({ trimStartS: 5, trimEndS: 6 }, /at least 3 seconds/);
    await no({ trimStartS: 30 }, /start time/);
    await no({ trimEndS: NaN }, /plain numbers/);
    await no({ soundVolume: 2 }, /Volumes go from 0 to 1.5/);
    await no({ soundId: null }, /Pick a sound/);
    await no({ soundId: randomUUID() }, /isn't available/);
    await no({ audio: "loud" }, /Pick how/);
    await no({ caption: "" }, /needs a caption/);
    await no({ caption: "legs #a #b #c #d #e #f" }, /6 hashtags/);
    await no({ caption: "legs with privateword" }, /blocklisted/);
    await no({ mediaId: "nope" }, /can't be used/);
    await no({ mediaId: await media("archived", { status: "archived" }) }, /can't be used/);
    await no({ mediaId: await media("nofile", { r2: null }) }, /can't be used/);
    await no({ mediaId: await media("long", { durationS: 200 }), trimStartS: null, trimEndS: null }, /at most 90/);
    await no({ mediaId: silent, soundId: null, audio: "original" }, /no sound of its own/);
    expect((await edits(clip)).length).toBe(before);
  });

  it("archiveSound hides it from the picker and from new reels; re-adding the file brings it back", async () => {
    expect(await archiveSound(db, soundId)).toEqual({ ok: true });
    expect(await archiveSound(db, soundId)).toEqual({ ok: false });
    expect((await listSounds(db)).some((s) => s.id === soundId)).toBe(false);
    expect((await listSounds(db, { includeArchived: true })).find((s) => s.id === soundId)?.archived).toBe(true);
    const r = await requestReel(db, base(), { blocklist: [] });
    expect(r.ok === false && r.reason).toMatch(/isn't available/);
    await addSound(db, { fileName: "x.mp3", bytes: new Uint8Array([...MP3, ...new TextEncoder().encode(run)]) }, put);
    expect((await listSounds(db)).some((s) => s.id === soundId)).toBe(true);
  });

  it("loadReelSource + listReels: status, 12-hour times, a calendar link only once done", async () => {
    expect(await loadReelSource(db, clip)).toMatchObject({ mediaId: clip, durationS: 20, hasAudio: true, label: `${run}-clip` });
    const [done, other] = await edits(clip);
    const b = (await db.query(`insert into batches (week_start, status) values ('2099-03-02', 'draft') returning id`)).rows[0].id;
    const bi = (
      await db.query(
        `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status, origin) values ($1, $2, 'instagram', $3, '2099-03-04T18:00:00Z', 'draft', 'reel') returning id`,
        [b, clip, caption],
      )
    ).rows[0].id;
    await db.query(`update media_edits set status = 'done', batch_item_id = $2, requested_at = '2099-03-01T15:05:00Z' where id = $1`, [done.id, bi]);
    await db.query(`update media_edits set status = 'failed', error = 'ffmpeg couldn''t make this reel.' where id = $1`, [other.id]);
    const views = (await listReels(db, "UTC", 200)).filter((v) => v.label === `${run}-clip`);
    const d = views.find((v) => v.id === done.id)!;
    expect(d).toMatchObject({ status: "done", requested: "Mar 1, 3:05 PM", calendarHref: "/calendar?view=week&d=2099-03-04&day=2099-03-04", postAt: "Wed, Mar 4, 6:00 PM", error: null });
    const f = views.find((v) => v.status === "failed")!;
    expect(f).toMatchObject({ error: "ffmpeg couldn't make this reel.", calendarHref: null });
  });
});
