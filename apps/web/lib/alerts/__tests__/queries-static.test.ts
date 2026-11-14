import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALERT_KINDS } from "@autopilot/core";
import { acknowledge, acknowledgeAll, cleanIds, KIND_ORDER, kindLabel, listAlerts, parseKind, parseState, sourceLabel } from "../queries.js";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === "__tests__" ? [] : walk(p)) : [p];
  });

/** A fake pool that records SQL + params. */
function fakePool(rowCount = 0) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    pool: { query: async (sql: string, params: unknown[] = []) => (calls.push({ sql, params }), { rows: [], rowCount }) } as never,
  };
}

describe("alerts SQL (static)", () => {
  const files = [...walk(here("..")), ...walk(here("../../../app/alerts"))];

  it("finds the alerts sources", () => {
    expect(files.some((f) => f.endsWith("queries.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("actions.ts"))).toBe(true);
  });

  it("never deletes alerts (acknowledge is a timestamp)", () => {
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/\bdelete\b/i);
  });

  it("every update on alerts is guarded by acknowledged_at is null and stamps the session", () => {
    const src = readFileSync(here("../queries.ts"), "utf8");
    const updates = [...src.matchAll(/update alerts set [^`]*`/g)].map((m) => m[0]);
    expect(updates.length).toBe(2);
    for (const u of updates) {
      expect(u).toMatch(/where [^`]*acknowledged_at is null/);
      expect(u).toContain("acknowledged_session =");
    }
  });
});

describe("kind / state / id parsing", () => {
  it("accepts every known kind and nothing else", () => {
    for (const k of ALERT_KINDS) expect(parseKind(k)).toBe(k);
    for (const bad of ["", "nope", "auth' or 1=1 --", ["auth"], 1, null, undefined]) expect(parseKind(bad)).toBeUndefined();
  });

  it("metrics-health (F9) is filterable and has a chip label", () => {
    expect(parseKind("metrics-health")).toBe("metrics-health");
    expect(kindLabel("metrics-health")).toBe("Metrics");
    expect(KIND_ORDER).toContain("metrics-health");
  });

  it("state defaults to open", () => {
    expect(parseState("acknowledged")).toBe("acknowledged");
    expect(parseState("x")).toBe("open");
    expect(parseState(undefined)).toBe("open");
  });

  it("cleanIds keeps only uuids, de-duplicated", () => {
    const id = "0b9d8f1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    expect(cleanIds([id, id.toUpperCase(), "x", null, 5, "'; select 1 --"])).toEqual([id]);
  });

  it("source labels never echo unexpected text", () => {
    expect(sourceLabel("web")).toBe("Login");
    expect(sourceLabel("meta")).toBe("Meta");
    expect(sourceLabel("<script>")).toBe("other");
  });
});

describe("queries against a fake pool", () => {
  it("an unknown kind filter gives the unfiltered query, and never reaches SQL", async () => {
    const f = fakePool();
    await listAlerts(f.pool, { state: "open", kind: "nope' --" as never });
    const unfiltered = fakePool();
    await listAlerts(unfiltered.pool, { state: "open" });
    expect(f.calls[0]!.sql).toBe(unfiltered.calls[0]!.sql);
    expect(f.calls[0]!.params).toEqual(unfiltered.calls[0]!.params);
    expect(JSON.stringify(f.calls)).not.toContain("nope");
  });

  it("a known kind is a bound parameter", async () => {
    const f = fakePool();
    await listAlerts(f.pool, { state: "acknowledged", kind: "auth" });
    expect(f.calls[0]!.sql).toMatch(/a\.kind = \$2/);
    expect(f.calls[0]!.params).toContain("auth");
  });

  it("acknowledge with no valid ids makes no query", async () => {
    const f = fakePool();
    expect(await acknowledge(f.pool, ["x"], "s")).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  it("acknowledge and acknowledgeAll return the row count", async () => {
    const f = fakePool(3);
    expect(await acknowledge(f.pool, ["0b9d8f1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b"], "s")).toBe(3);
    expect(await acknowledgeAll(f.pool, "s")).toBe(3);
    expect(f.calls[1]!.params[2]).toBeNull(); // no kind → all open
    expect(await acknowledgeAll(f.pool, "s", "engagement-kill")).toBe(3);
    expect(f.calls[2]!.params[2]).toBe("engagement-kill");
  });

  it("acknowledgeAll with an unknown kind acknowledges nothing (never widens to all open)", async () => {
    const f = fakePool(3);
    for (const bad of ["bogus", "", "final-failure' or '1'='1", null]) {
      expect(await acknowledgeAll(f.pool, "s", bad as never)).toBe(0);
    }
    expect(f.calls).toHaveLength(0);
  });
});
