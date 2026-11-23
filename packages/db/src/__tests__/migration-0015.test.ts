import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static checks on the hand-applied migration: additive (two new tables only), re-runnable, never destructive.
const raw = readFileSync(new URL("../../migrations/0015_reels.sql", import.meta.url), "utf8");
const sql = raw
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n")
  .replace(/\s+/g, " ")
  .toLowerCase();

const tableBody = (name: string): string => {
  const m = sql.match(new RegExp(`create table if not exists ${name} \\((.*?)\\);`));
  expect(m, `table ${name}`).not.toBeNull();
  return m![1]!;
};

describe("migration 0015_reels", () => {
  it("creates sounds with a unique r2_key and an archive column", () => {
    const body = tableBody("sounds");
    for (const col of ["id uuid primary key default gen_random_uuid()", "name text not null", "r2_key text unique not null", "duration_s numeric", "created_at timestamptz not null default now()", "archived_at timestamptz"]) {
      expect(body).toContain(col);
    }
  });

  it("creates media_edits pointing at media, sounds and batch_items, with a status check", () => {
    const body = tableBody("media_edits");
    for (const col of [
      "kind text not null default 'reel'",
      "source_media_id uuid not null references media(id)",
      "sound_id uuid references sounds(id)",
      "params jsonb not null",
      "caption text not null default ''",
      "status text not null default 'queued' check (status in ('queued','running','done','failed'))",
      "result_media_id uuid references media(id)",
      "batch_item_id uuid references batch_items(id)",
      "error text",
      "started_at timestamptz",
      "finished_at timestamptz",
    ]) {
      expect(body).toContain(col);
    }
  });

  it("is re-runnable and additive: if-not-exists everywhere, no alter/drop/delete/truncate/update", () => {
    const creates = sql.match(/create (table|index|unique index) /g) ?? [];
    const guarded = sql.match(/create (table|index|unique index) if not exists /g) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    expect(guarded.length).toBe(creates.length);
    expect(sql).not.toMatch(/\balter\b|\bdrop\b|\bdelete\b|\btruncate\b|\bupdate\b/);
  });
});
