import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, assertNoRealData, buildSeedRows } from "../lib/seed.js";

describe("dev:seed guards", () => {
  it("accepts only local postgres URLs", () => {
    expect(() => assertLocalDatabaseUrl("postgres://u:p@localhost:5432/dev")).not.toThrow();
    expect(() => assertLocalDatabaseUrl("postgresql://u:p@127.0.0.1/dev")).not.toThrow();
    expect(() => assertLocalDatabaseUrl("postgres://u:p@[::1]:5432/dev")).not.toThrow();
    expect(() => assertLocalDatabaseUrl("postgres://u:p@db:5432/autopilot")).toThrow(/non-local/);
    expect(() => assertLocalDatabaseUrl("postgres://u:p@203.0.113.7:5432/x")).toThrow(/non-local/);
    expect(() => assertLocalDatabaseUrl("mysql://localhost/x")).toThrow(/postgres/);
    expect(() => assertLocalDatabaseUrl(undefined)).toThrow(/DEV_DATABASE_URL/);
    expect(() => assertLocalDatabaseUrl("not a url")).toThrow(/parse/);
  });

  it("the error never echoes the remote host or credentials", () => {
    try {
      assertLocalDatabaseUrl("postgres://user:secret@203.0.113.7:5432/x");
    } catch (e) {
      expect((e as Error).message).not.toMatch(/203\.0\.113\.7|secret|user/);
    }
  });

  it("refuses a database holding real media (production behind a localhost tunnel)", () => {
    expect(() => assertNoRealData(297)).toThrow(/real media/);
    expect(() => assertNoRealData(0)).not.toThrow();
  });
});

describe("buildSeedRows", () => {
  const rows = buildSeedRows("2026-11-16");

  it("is deterministic and internally consistent", () => {
    expect(buildSeedRows("2026-11-16")).toEqual(rows);
    expect(rows.items).toHaveLength(rows.media.length * 3);
    const hashes = new Set(rows.media.map((m) => m.hash));
    expect(hashes.size).toBe(rows.media.length);
    expect(rows.items.every((i) => hashes.has(i.hash))).toBe(true);
    expect([...hashes].every((h) => h.startsWith("demo-"))).toBe(true);
  });

  it("only instagram items carry trial params", () => {
    expect(rows.items.filter((i) => i.trial).every((i) => i.platform === "instagram")).toBe(true);
    expect(rows.items.some((i) => i.trial)).toBe(true);
  });

  it("research rows are clearly labelled demo and name no places", () => {
    expect(rows.creators.every((c) => c.handle.startsWith("demo_") && c.notes.startsWith("DEMO"))).toBe(true);
    expect(rows.ideas.every((i) => i.title.startsWith("DEMO"))).toBe(true);
  });
});
