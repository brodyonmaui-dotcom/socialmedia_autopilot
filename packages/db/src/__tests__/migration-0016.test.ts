import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static checks on the hand-applied migration: additive (one nullable column + an index), re-runnable, no backfill.
const raw = readFileSync(new URL("../../migrations/0016_media_folders.sql", import.meta.url), "utf8");
const sql = raw
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("migration 0016_media_folders", () => {
  it("adds a nullable text folder column to media, guarded", () => {
    expect(sql).toContain("alter table media add column if not exists folder text;");
    expect(sql).not.toMatch(/folder text (not null|default)/);
  });

  it("indexes folder, guarded", () => {
    expect(sql).toContain("create index if not exists media_folder_idx on media (folder);");
  });

  it("is additive: no drop/delete/truncate/update, and the only alter is the guarded add column", () => {
    expect(sql).not.toMatch(/\bdrop\b|\bdelete\b|\btruncate\b|\bupdate\b/);
    expect((sql.match(/\balter\b/g) ?? []).length).toBe(1);
  });
});
