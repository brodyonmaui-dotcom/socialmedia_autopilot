import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { devPosterPath, servePoster } from "../poster.js";

const ID = "10000000-0000-4000-8000-000000000001";
const BASE = "https://media.example.test";
const KEY = "posters/abc123.jpg";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function poolReturning(rows: unknown[]) {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
  return { pool: { query } as unknown as Pool, query };
}

describe("servePoster (R2)", () => {
  it("streams the poster as image/jpeg, private 1-day cache, nosniff; parameterised lookup by id", async () => {
    const { pool, query } = poolReturning([{ poster_key: KEY }]);
    const fetchImpl = vi.fn(async () => new Response(JPEG, { status: 200, headers: { "content-length": String(JPEG.length), "content-type": "binary/octet-stream" } }));
    const res = await servePoster({ pool, mediaId: ID, mediaBase: BASE, fetchImpl });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-length")).toBe(String(JPEG.length));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/${KEY}`, expect.anything());
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/select poster_key from media where id = \$1/);
    expect(params).toEqual([ID]);
  });

  it("404 for a non-uuid id without touching the DB", async () => {
    const { pool, query } = poolReturning([]);
    for (const bad of ["x", "1; drop table media", `${ID}x`, "../etc/passwd"]) {
      expect((await servePoster({ pool, mediaId: bad, mediaBase: BASE })).status).toBe(404);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("404 when the row is missing or has no poster, and never fetches", async () => {
    const fetchImpl = vi.fn();
    for (const rows of [[], [{ poster_key: null }]]) {
      const { pool } = poolReturning(rows);
      const res = await servePoster({ pool, mediaId: ID, mediaBase: BASE, fetchImpl });
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a key that would resolve outside the media base (guard), never fetches", async () => {
    const fetchImpl = vi.fn();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const key of ["../other/x.jpg", "x.jpg?sig=1", "x.jpg#f"]) {
      const { pool } = poolReturning([{ poster_key: key }]);
      expect((await servePoster({ pool, mediaId: ID, mediaBase: `${BASE}/bucket`, fetchImpl })).status).toBe(404);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).not.toContain(BASE);
    expect(logged).not.toContain("x.jpg");
    err.mockRestore();
  });

  it("upstream 404 → 404; other non-200 or a thrown fetch → 502; body never echoed, base never exposed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pool } = poolReturning([{ poster_key: KEY }]);
    const r404 = await servePoster({ pool, mediaId: ID, mediaBase: BASE, fetchImpl: async () => new Response("NoSuchKey", { status: 404 }) });
    expect(r404.status).toBe(404);
    const r500 = await servePoster({ pool, mediaId: ID, mediaBase: BASE, fetchImpl: async () => new Response(`secret ${BASE}`, { status: 500 }) });
    expect(r500.status).toBe(502);
    const body = await r500.text();
    expect(body).not.toContain(BASE);
    expect(body).not.toContain("secret");
    const thrown = await servePoster({ pool, mediaId: ID, mediaBase: BASE, fetchImpl: async () => Promise.reject(new Error(`ECONNRESET ${BASE}`)) });
    expect(thrown.status).toBe(502);
    expect(err.mock.calls.flat().join(" ")).not.toContain(BASE);
    err.mockRestore();
  });

  it("no media base (and no dev dir) → 503, never fetches", async () => {
    const fetchImpl = vi.fn();
    const { pool } = poolReturning([{ poster_key: KEY }]);
    expect((await servePoster({ pool, mediaId: ID, mediaBase: undefined, fetchImpl })).status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never redirects (no 3xx, no Location header to R2)", async () => {
    const { pool } = poolReturning([{ poster_key: KEY }]);
    const res = await servePoster({ pool, mediaId: ID, mediaBase: BASE, fetchImpl: async () => new Response(JPEG, { status: 200 }) });
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("servePoster (DEV_POSTER_DIR, local screenshots only)", () => {
  const dir = mkdtempSync(join(tmpdir(), "autopilot-dev-posters-"));
  mkdirSync(join(dir, "demo"));
  writeFileSync(join(dir, "demo", "demo-0001.jpg"), JPEG);
  writeFileSync(join(dir, "outside.jpg"), JPEG);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("serves a demo/ key from disk, session-guarded by the route, same headers", async () => {
    const { pool } = poolReturning([{ poster_key: "demo/demo-0001.jpg" }]);
    const fetchImpl = vi.fn();
    const res = await servePoster({ pool, mediaId: ID, mediaBase: undefined, devPosterDir: dir, fetchImpl });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a missing demo file → 404", async () => {
    const { pool } = poolReturning([{ poster_key: "demo/nope.jpg" }]);
    expect((await servePoster({ pool, mediaId: ID, mediaBase: undefined, devPosterDir: dir })).status).toBe(404);
  });

  it("path traversal is refused (resolve must stay inside the dir)", async () => {
    expect(devPosterPath(dir, "demo/../outside.jpg")).toBeNull();
    expect(devPosterPath(dir, "demo/../../etc/passwd")).toBeNull();
    expect(devPosterPath(dir, "demo/%2e%2e/outside.jpg")).not.toBe(join(dir, "outside.jpg"));
    expect(devPosterPath(dir, "demo/demo-0001.jpg")).toBe(join(dir, "demo", "demo-0001.jpg"));
    expect(devPosterPath("relative/dir", "demo/demo-0001.jpg")).toBeNull(); // must be absolute
    const { pool } = poolReturning([{ poster_key: "demo/../outside.jpg" }]);
    expect((await servePoster({ pool, mediaId: ID, mediaBase: undefined, devPosterDir: dir })).status).toBe(404);
  });

  it("real (non-demo/) keys are never served from disk: they go to R2 or 503", async () => {
    writeFileSync(join(dir, "posters-real.jpg"), JPEG);
    mkdirSync(join(dir, "posters"), { recursive: true });
    writeFileSync(join(dir, "posters", "abc123.jpg"), JPEG);
    const { pool } = poolReturning([{ poster_key: KEY }]);
    expect((await servePoster({ pool, mediaId: ID, mediaBase: undefined, devPosterDir: dir })).status).toBe(503);
    const fetchImpl = vi.fn(async () => new Response(JPEG, { status: 200 }));
    expect((await servePoster({ pool, mediaId: ID, mediaBase: BASE, devPosterDir: dir, fetchImpl })).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
