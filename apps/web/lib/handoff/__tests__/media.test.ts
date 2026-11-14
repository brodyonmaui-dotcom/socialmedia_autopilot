import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { proxyMedia } from "../media.js";

const TZ = "Europe/London";
const NOW = new Date("2026-11-13T12:00:00.000Z");
const ITEM = "10000000-0000-4000-8000-000000000001";
const BASE = "https://media.example.test";
const KEY = "clean/abc123.mp4";

function poolReturning(rows: unknown[]) {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
  return { pool: { query } as unknown as Pool, query };
}

const due = [{ scheduled_for: new Date("2026-11-13T09:00:00.000Z"), r2_key: KEY }];

describe("proxyMedia", () => {
  it("streams a due item's clean file as video/mp4, private no-store, with the upstream length", async () => {
    const { pool } = poolReturning(due);
    const fetchImpl = vi.fn(async () => new Response("VIDEOBYTES", { status: 200, headers: { "content-length": "10", "content-type": "binary/octet-stream" } }));
    const res = await proxyMedia({ pool, itemId: ITEM, now: NOW, timeZone: TZ, mediaBase: BASE, fetchImpl });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-length")).toBe("10");
    expect(await res.text()).toBe("VIDEOBYTES");
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/${KEY}`, expect.anything());
  });

  it("404s when the store finds nothing (non-snapchat, unapproved, future, no r2_key) and never fetches", async () => {
    const { pool, query } = poolReturning([]);
    const fetchImpl = vi.fn();
    const res = await proxyMedia({ pool, itemId: ITEM, now: NOW, timeZone: TZ, mediaBase: BASE, fetchImpl });
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
    const sql = String((query.mock.calls[0] as unknown[])[0]);
    for (const cond of ["bi.platform = 'snapchat'", "bi.status = 'approved'", "bi.approved_at is not null", "b.status = 'approved'", "m.r2_key is not null", "bi.scheduled_for <"]) {
      expect(sql).toContain(cond);
    }
    expect(sql).not.toMatch(/source_path/);
  });

  it("404s a future item even if a row comes back, and a malformed id without querying", async () => {
    const { pool } = poolReturning([{ scheduled_for: new Date("2026-11-14T09:00:00.000Z"), r2_key: KEY }]);
    expect((await proxyMedia({ pool, itemId: ITEM, now: NOW, timeZone: TZ, mediaBase: BASE, fetchImpl: vi.fn() })).status).toBe(404);
    const p2 = poolReturning(due);
    expect((await proxyMedia({ pool: p2.pool, itemId: "../etc", now: NOW, timeZone: TZ, mediaBase: BASE, fetchImpl: vi.fn() })).status).toBe(404);
    expect(p2.query).not.toHaveBeenCalled();
  });

  it("maps upstream errors and fetch throws to 502 without echoing the body, base or key", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
    try {
      for (const fetchImpl of [
        vi.fn(async () => new Response(`<Error>NoSuchKey ${KEY} at ${BASE}</Error>`, { status: 404 })),
        vi.fn(async () => {
          throw new Error(`connect failed ${BASE}/${KEY}`);
        }),
      ]) {
        const res = await proxyMedia({ pool: poolReturning(due).pool, itemId: ITEM, now: NOW, timeZone: TZ, mediaBase: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
        expect(res.status).toBe(502);
        const body = await res.text();
        expect(body).toBe("upstream error");
        expect(res.headers.get("cache-control")).toBe("private, no-store");
      }
    } finally {
      spy.mockRestore();
    }
    expect(logs.join("\n")).not.toContain(BASE);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("refuses an r2_key that would leave the base path (dot segments, encoded, backslash, query/fragment)", async () => {
    const base = `${BASE}/bucket`;
    const logs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
    try {
      for (const key of ["../x.mp4", "a/%2e%2e/%2e%2e/x", "..\\x", ".%2E/x", "a?b", "a#b", ""]) {
        const fetchImpl = vi.fn();
        const pool = poolReturning([{ scheduled_for: due[0]!.scheduled_for, r2_key: key }]).pool;
        const res = await proxyMedia({ pool, itemId: ITEM, now: NOW, timeZone: TZ, mediaBase: base, fetchImpl });
        expect(res.status, key).toBe(404);
        expect(await res.text()).toBe("not found");
        expect(fetchImpl, key).not.toHaveBeenCalled();
      }
    } finally {
      spy.mockRestore();
    }
    expect(logs.join("\n")).not.toContain(BASE);
    // Odd but contained keys still stay under the base (host can't change).
    for (const key of ["//evil.example/x", "https://evil.example/x"]) {
      const fetchImpl = vi.fn(async () => new Response("V", { status: 200 }));
      const pool = poolReturning([{ scheduled_for: due[0]!.scheduled_for, r2_key: key }]).pool;
      await proxyMedia({ pool, itemId: ITEM, now: NOW, timeZone: TZ, mediaBase: base, fetchImpl });
      const called = String((fetchImpl.mock.calls[0] as unknown[] | undefined)?.[0] ?? "");
      if (called) expect(new URL(called).host, key).toBe(new URL(BASE).host);
      if (called) expect(new URL(called).pathname.startsWith("/bucket/"), key).toBe(true);
    }
  });

  it("503s with a fixed body when PUBLIC_MEDIA_BASE or the zone is missing, before touching the DB", async () => {
    const { pool, query } = poolReturning(due);
    const a = await proxyMedia({ pool, itemId: ITEM, now: NOW, timeZone: TZ, mediaBase: undefined, fetchImpl: vi.fn() });
    expect(a.status).toBe(503);
    expect(await a.text()).toBe("media not configured");
    const b = await proxyMedia({ pool, itemId: ITEM, now: NOW, timeZone: null, mediaBase: BASE, fetchImpl: vi.fn() });
    expect(b.status).toBe(503);
    expect(query).not.toHaveBeenCalled();
  });
});
