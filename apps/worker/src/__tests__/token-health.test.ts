import { describe, expect, it } from "vitest";
import { runTokenHealthOnce, tokenHealthConfigFromEnv } from "../jobs/token-health.js";

function fakePool() {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  return { writes, query: async (sql: string, params: unknown[] = []) => (writes.push({ sql, params }), { rows: [] }) };
}

describe("runTokenHealthOnce", () => {
  it("with nothing configured: all skipped, no alert rows, one log line", async () => {
    const pool = fakePool();
    const lines: string[] = [];
    const line = await runTokenHealthOnce(pool, {}, (l) => lines.push(l));
    expect(line).toBe("[token-health] meta=skipped · youtube=skipped · zernio=skipped");
    expect(pool.writes).toEqual([]);
    expect(lines).toEqual([line]);
  });

  it("a failing service replaces its open alert row with one 'token-health' alert", async () => {
    const pool = fakePool();
    const fetch = async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "revoked" }), { status: 400, headers: { "content-type": "application/json" } });
    await runTokenHealthOnce(pool, { fetch, youtube: { clientId: "c", clientSecret: "s", refreshToken: "r" } }, () => {});
    expect(pool.writes).toHaveLength(2);
    expect(pool.writes[0]!.sql).toMatch(/^delete from alerts where kind = 'token-health'/);
    expect(pool.writes[0]!.params).toEqual(["youtube"]);
    expect(pool.writes[1]!.sql).toMatch(/^insert into alerts/);
    expect(pool.writes[1]!.params[0]).toBe("youtube");
    expect(pool.writes[1]!.params[1]).toMatch(/^fail: refresh token revoked/);
  });

  it("builds the config from env without leaking partial setups", () => {
    const c = tokenHealthConfigFromEnv({ ZERNIO_API_KEY: "k", META_APP_ID: "a" } as NodeJS.ProcessEnv);
    expect(c.zernio).toEqual({ apiKey: "k", tiktokAccountId: undefined });
    expect(c.meta).toBeUndefined();
    expect(c.youtube).toBeUndefined();
  });
});
