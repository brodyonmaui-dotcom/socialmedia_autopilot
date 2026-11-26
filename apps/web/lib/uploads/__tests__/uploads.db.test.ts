import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abortUpload, checkUploads, completeUpload, putPart, startUpload, uploadStatuses } from "../data.js";
import { handleAbort, handleComplete, handlePart, handleStatus } from "../http.js";
import { PART_SIZE } from "../validate.js";
import { fakeStorage } from "./fake-storage.js";

/**
 * The upload data layer + route cores on the real dev DB (DATABASE_URL, migrated through 0017), everything inside
 * ONE transaction that is rolled back. Storage is the in-memory fake.
 */
const url = process.env.DATABASE_URL;
const quiet = () => {};

describe.skipIf(!url)("uploads data layer + routes (db, fake storage)", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  const run = randomUUID().slice(0, 8);
  const storage = fakeStorage();
  const deps = () => ({ db, storage, log: quiet });
  const bytes = (n: number, fill: number) => new Uint8Array(new ArrayBuffer(n)).fill(fill);
  const put = (id: string, n: number | string, body: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) =>
    handlePart(deps(), id, String(n), new Request("http://x/part", { method: "PUT", body, headers }));
  const start = async (over: Record<string, unknown> = {}) => {
    const r = await startUpload(db, storage, { name: `clip-${run}.mp4`, size: PART_SIZE + 10, type: "video/mp4", ...over }, quiet);
    if (!r.ok) throw new Error(r.error);
    return r.uploadId;
  };
  const row = async (id: string) => (await db.query("select * from uploads where id = $1", [id])).rows[0];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = await pool.connect();
    await db.query("begin");
  });
  afterAll(async () => {
    if (db) {
      await db.query("rollback");
      db.release();
    }
    await pool?.end();
  });

  it("start: keeps only the basename + parent folder name; private incoming key; multipart opened", async () => {
    const r = await startUpload(db, storage, { name: `clip-${run}.MOV`, size: 20, type: "video/quicktime", relPath: `Training/Upper body/clip-${run}.MOV` }, quiet);
    expect(r).toEqual({ ok: true, uploadId: expect.any(String), partSize: PART_SIZE });
    const u = await row((r as { uploadId: string }).uploadId);
    expect(u).toMatchObject({ original_name: `clip-${run}.MOV`, size_bytes: "20", content_type: "video/quicktime", folder: "Upper body", status: "uploading", parts: [], media_id: null });
    expect(u.r2_key).toBe(`incoming/${u.id}.mov`);
    expect(storage.open.get(u.s3_upload_id)?.key).toBe(u.r2_key);
    const invalid = await startUpload(db, storage, { name: "x", size: 20, type: "video/mp4", relPath: `${"y".repeat(70)}/clip.mp4` }, quiet);
    expect(invalid.ok).toBe(false);
    const noFolder = await startUpload(db, storage, { name: "clip.mp4", size: 20, type: "video/mp4", relPath: `${"y".repeat(70)}/clip.mp4` }, quiet);
    expect((await row((noFolder as { uploadId: string }).uploadId)).folder).toBeNull();
  });

  it("start refuses non-videos, > 2 GiB, and no storage (no row)", async () => {
    const before = (await db.query("select count(*)::int n from uploads")).rows[0].n;
    expect(await startUpload(db, storage, { name: "a.mp3", size: 10, type: "audio/mpeg" })).toMatchObject({ ok: false });
    expect(await startUpload(db, storage, { name: "a.mp4", size: 2 * 1024 ** 3 + 1, type: "video/mp4" })).toMatchObject({ ok: false });
    expect(await startUpload(db, null, { name: "a.mp4", size: 10, type: "video/mp4" })).toMatchObject({ ok: false, error: expect.stringMatching(/Storage/) });
    expect((await db.query("select count(*)::int n from uploads")).rows[0].n).toBe(before);
  });

  it("parts → complete: re-sent part replaces, object is the parts in order, complete is idempotent, then no more parts", async () => {
    const id = await start();
    expect(await (await put(id, 1, bytes(PART_SIZE, 9))).json()).toEqual({ etag: expect.any(String) });
    const ok1 = await put(id, 1, bytes(PART_SIZE, 1));
    expect(ok1.status).toBe(200);
    const missing = await handleComplete(deps(), id);
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/Parts missing: 2/);
    expect((await put(id, 2, bytes(10, 2))).status).toBe(200);
    expect((await row(id)).parts.map((p: { n: number }) => p.n).sort()).toEqual([1, 2]);
    const done = await handleComplete(deps(), id);
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ status: "uploaded" });
    const u = await row(id);
    expect(u.status).toBe("uploaded");
    const obj = storage.objects.get(u.r2_key)!;
    expect(obj.byteLength).toBe(PART_SIZE + 10);
    expect(obj[0]).toBe(1);
    expect(obj[PART_SIZE]).toBe(2);
    expect(await (await handleComplete(deps(), id)).json()).toEqual({ status: "uploaded" });
    expect((await put(id, 2, bytes(10, 2))).status).toBe(409);
  });

  it("refuses bad ids, bad part numbers, oversized / wrong-size parts, unknown uploads", async () => {
    const id = await start();
    expect((await put("not-a-uuid", 1, bytes(10, 0))).status).toBe(400);
    expect((await handleComplete(deps(), "../x")).status).toBe(400);
    expect((await handleAbort(deps(), "1; drop")).status).toBe(400);
    for (const n of ["0", "10001", "-1", "a"]) expect((await put(id, n, bytes(10, 0))).status).toBe(400);
    expect((await put(id, 1, bytes(PART_SIZE + 1, 0))).status).toBe(413);
    expect((await put(id, 1, bytes(10, 0), { "content-length": String(PART_SIZE + 1) })).status).toBe(413);
    expect((await put(id, 1, bytes(5 * 1024 ** 2, 0))).status).toBe(400); // not the last part, so it must be a full part
    expect((await put(id, 3, bytes(10, 0))).status).toBe(400); // past the end
    expect((await put(id, 2, bytes(11, 0))).status).toBe(400); // last part = the remainder exactly
    expect((await put(randomUUID(), 1, bytes(10, 0))).status).toBe(404);
    expect((await row(id)).parts).toEqual([]);
    expect(await putPart(db, null, id, 1, bytes(10, 0))).toMatchObject({ ok: false, status: 503 });
  });

  it("abort: uploading → aborted, parts dropped; idempotent; no parts or complete afterwards; done rows can't be aborted", async () => {
    const id = await start();
    expect((await put(id, 1, bytes(PART_SIZE, 1))).status).toBe(200);
    const s3 = (await row(id)).s3_upload_id;
    const r = await handleAbort(deps(), id);
    expect(await r.json()).toEqual({ status: "aborted" });
    const u = await row(id);
    expect(u.status).toBe("aborted");
    expect(u.finished_at).not.toBeNull();
    expect(u.s3_upload_id).toBeNull();
    expect(storage.open.has(s3)).toBe(false);
    expect(await abortUpload(db, storage, id)).toEqual({ ok: true, status: "aborted" });
    expect((await put(id, 2, bytes(10, 1))).status).toBe(409);
    expect((await handleComplete(deps(), id)).status).toBe(409);

    // An 'uploaded' row (object complete, not yet processed): abort deletes the raw object.
    const up = await start({ size: 10 });
    await put(up, 1, bytes(10, 3));
    await completeUpload(db, storage, up);
    const key = (await row(up)).r2_key;
    expect(storage.objects.has(key)).toBe(true);
    expect(await abortUpload(db, storage, up, quiet)).toEqual({ ok: true, status: "aborted" });
    expect(storage.objects.has(key)).toBe(false);

    // Storage down: still aborted, cleanup left to the worker (s3_upload_id kept).
    const later = await start({ size: 10 });
    storage.failNext.add("abort");
    expect(await abortUpload(db, storage, later, quiet)).toEqual({ ok: true, status: "aborted" });
    expect((await row(later)).s3_upload_id).not.toBeNull();

    const done = await start({ size: 10 });
    await db.query("update uploads set status = 'done' where id = $1", [done]);
    expect(await abortUpload(db, storage, done)).toMatchObject({ ok: false, status: 409 });
    expect(await abortUpload(db, storage, randomUUID())).toMatchObject({ ok: false, status: 404 });
  });

  it("checkUploads: same basename + size of a done/duplicate upload counts as already in", async () => {
    const m = (await db.query(`insert into media (content_hash, source_path, r2_key, status) values ($1, 'x.mp4', 'library/x.mp4', 'ready') returning id`, [`upl-${run}`])).rows[0].id;
    const a = await start({ name: `done-${run}.mp4`, size: 111 });
    const b = await start({ name: `dup-${run}.mp4`, size: 222 });
    const c = await start({ name: `failed-${run}.mp4`, size: 333 });
    await db.query("update uploads set status = 'done', media_id = $2, finished_at = now() where id = $1", [a, m]);
    await db.query("update uploads set status = 'duplicate', media_id = $2, finished_at = now() where id = $1", [b, m]);
    await db.query("update uploads set status = 'failed' where id = $1", [c]);
    const r = await checkUploads(db, [
      { name: `done-${run}.mp4`, size: 111 },
      { name: `Folder/dup-${run}.mp4`, size: 222 },
      { name: `done-${run}.mp4`, size: 112 },
      { name: `failed-${run}.mp4`, size: 333 },
      { name: `new-${run}.mp4`, size: 1 },
    ]);
    expect(r).toEqual([
      { name: `done-${run}.mp4`, size: 111, already: true, mediaId: m },
      { name: `Folder/dup-${run}.mp4`, size: 222, already: true, mediaId: m },
      { name: `done-${run}.mp4`, size: 112, already: false },
      { name: `failed-${run}.mp4`, size: 333, already: false },
      { name: `new-${run}.mp4`, size: 1, already: false },
    ]);
    await expect(checkUploads(db, Array.from({ length: 201 }, () => ({ name: "a.mp4", size: 1 })))).rejects.toThrow(/200/);
  });

  it("status: only the rows the ids name, in that order, with poster + error; bad ids refused", async () => {
    const m = (await db.query(`insert into media (content_hash, source_path, r2_key, status, poster_key) values ($1, 'y.mp4', 'library/y.mp4', 'ready', 'posters/y.jpg') returning id`, [`upl2-${run}`])).rows[0].id;
    const a = await start({ size: 10 });
    const b = await start({ size: 10 });
    const other = await start({ size: 10 });
    await db.query("update uploads set status = 'done', media_id = $2 where id = $1", [a, m]);
    await db.query("update uploads set status = 'failed', error = 'Location details survived, so it was not kept.' where id = $1", [b]);
    const res = await handleStatus({ db }, `http://x/status?ids=${b},${a},${randomUUID()}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      { id: b, status: "failed", error: "Location details survived, so it was not kept." },
      { id: a, status: "done", mediaId: m, posterUrl: `/app/media/poster/${m}` },
    ]);
    expect(JSON.stringify(body)).not.toContain(other);
    expect((await handleStatus({ db }, "http://x/status?ids=a,b")).status).toBe(400);
    expect(await (await handleStatus({ db }, "http://x/status")).json()).toEqual([]);
    expect(await uploadStatuses(db, [other])).toEqual([{ id: other, status: "uploading" }]);
  });
});
