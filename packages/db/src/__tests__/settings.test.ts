import { describe, expect, it } from "vitest";
import { getSetting, setSetting, type SettingsPool } from "../settings.js";

function fakePool(): SettingsPool & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async query(sql, params) {
      if (sql.startsWith("select")) {
        const key = (params as string[])[0] ?? "";
        return store.has(key) ? { rows: [{ value: store.get(key) }] } : { rows: [] };
      }
      // upsert
      const [key, json] = params as [string, string];
      store.set(key, JSON.parse(json));
      return { rows: [] };
    },
  };
}

describe("settings", () => {
  it("round-trips a value through set/get", async () => {
    const pool = fakePool();
    await setSetting(pool, "posting_windows", [{ start: "09:30", end: "11:45" }]);
    expect(await getSetting(pool, "posting_windows")).toEqual([{ start: "09:30", end: "11:45" }]);
  });

  it("returns undefined for a missing key", async () => {
    const pool = fakePool();
    expect(await getSetting(pool, "nope")).toBeUndefined();
  });

  it("overwrites on a second set (upsert, not append)", async () => {
    const pool = fakePool();
    await setSetting(pool, "k", 1);
    await setSetting(pool, "k", 2);
    expect(await getSetting(pool, "k")).toBe(2);
  });
});
