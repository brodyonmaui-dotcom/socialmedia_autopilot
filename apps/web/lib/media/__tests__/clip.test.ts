import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { cleanRange, serveClip } from "../clip.js";

const ID = "10000000-0000-4000-8000-000000000001";
const BASE = "https://media.example.test";
const pool = (rows: unknown[]) => ({ query: vi.fn(async () => ({ rows, rowCount: rows.length })) }) as unknown as Pool;
const BYTES = new Uint8Array([1, 2, 3, 4]);

describe("serveClip", () => {
  it("cleanRange accepts single ranges only", () => {
    expect(cleanRange("bytes=0-")).toBe("bytes=0-");
    expect(cleanRange("bytes=-500")).toBe("bytes=-500");
    expect(cleanRange("bytes=0-1,5-6")).toBeNull();
    expect(cleanRange("bytes=-")).toBeNull();
    expect(cleanRange(null)).toBeNull();
  });
  it("404s a bad id or a clip with no clean file, 503 without a base", async () => {
    expect((await serveClip({ pool: pool([]), mediaId: "x", mediaBase: BASE })).status).toBe(404);
    expect((await serveClip({ pool: pool([{ r2_key: null }]), mediaId: ID, mediaBase: BASE })).status).toBe(404);
    expect((await serveClip({ pool: pool([{ r2_key: "clean/a.mp4" }]), mediaId: ID, mediaBase: undefined })).status).toBe(503);
  });
  it("streams 200 as video/mp4 and advertises ranges", async () => {
    const fetchImpl = vi.fn(async () => new Response(BYTES, { status: 200, headers: { "content-length": "4" } }));
    const res = await serveClip({ pool: pool([{ r2_key: "clean/a.mp4" }]), mediaId: ID, mediaBase: BASE, fetchImpl });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/clean/a.mp4`, { cache: "no-store" });
  });
  it("forwards Range and returns 206 with Content-Range", async () => {
    const fetchImpl = vi.fn(async () => new Response(BYTES.slice(0, 2), { status: 206, headers: { "content-length": "2", "content-range": "bytes 0-1/4" } }));
    const res = await serveClip({ pool: pool([{ r2_key: "clean/a.mp4" }]), mediaId: ID, mediaBase: BASE, range: "bytes=0-1", fetchImpl });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-1/4");
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/clean/a.mp4`, { cache: "no-store", headers: { Range: "bytes=0-1" } });
  });
  it("never leaks the key or base on upstream failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    const res = await serveClip({ pool: pool([{ r2_key: "clean/a.mp4" }]), mediaId: ID, mediaBase: BASE, fetchImpl });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("clean/");
  });
  it("refuses a key that escapes the base", async () => {
    const fetchImpl = vi.fn();
    const res = await serveClip({ pool: pool([{ r2_key: "../x.mp4" }]), mediaId: ID, mediaBase: `${BASE}/media`, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
