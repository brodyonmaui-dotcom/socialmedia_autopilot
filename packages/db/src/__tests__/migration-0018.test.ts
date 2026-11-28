import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static checks on the hand-applied migration: additive (two nullable columns + one partial index), re-runnable, never destructive.
const raw = readFileSync(new URL("../../migrations/0018_video_fingerprint.sql", import.meta.url), "utf8");
const sql = raw
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("migration 0018_video_fingerprint", () => {
  it("adds media.fingerprint and media.fingerprint_at, nullable, guarded", () => {
    expect(sql).toContain("alter table media add column if not exists fingerprint text;");
    expect(sql).toContain("alter table media add column if not exists fingerprint_at timestamptz;");
    expect(sql).not.toMatch(/not null|default/);
  });

  it("indexes the backfill queue (never attempted), guarded", () => {
    expect(sql).toContain("create index if not exists media_fingerprint_todo_idx on media (created_at) where fingerprint_at is null;");
  });

  it("is re-runnable and additive: if-not-exists everywhere, only add-column alters, no drop/delete/truncate/update", () => {
    const alters = sql.match(/alter table /g) ?? [];
    const addCols = sql.match(/alter table media add column if not exists /g) ?? [];
    expect(alters.length).toBe(2);
    expect(addCols.length).toBe(alters.length);
    const creates = sql.match(/create (table|index|unique index) /g) ?? [];
    const guarded = sql.match(/create (table|index|unique index) if not exists /g) ?? [];
    expect(creates.length).toBe(1);
    expect(guarded.length).toBe(creates.length);
    expect(sql).not.toMatch(/\bdrop\b|\bdelete\b|\btruncate\b|\bupdate\b|\bcheck\b/);
  });
});
