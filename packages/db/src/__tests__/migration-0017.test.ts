import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static checks on the hand-applied migration: additive (one new table + two indexes), re-runnable, never destructive.
const raw = readFileSync(new URL("../../migrations/0017_uploads.sql", import.meta.url), "utf8");
const sql = raw
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("migration 0017_uploads", () => {
  it("creates uploads with the spec's columns, status check and media link", () => {
    const m = sql.match(/create table if not exists uploads \((.*?)\);/);
    expect(m).not.toBeNull();
    const body = m![1]!;
    for (const col of [
      "id uuid primary key default gen_random_uuid()",
      "original_name text not null",
      "size_bytes bigint not null",
      "content_type text",
      "folder text",
      "r2_key text not null",
      "s3_upload_id text",
      "parts jsonb not null default '[]'",
      "status text not null default 'uploading' check (status in ('uploading','uploaded','processing','done','duplicate','failed','aborted'))",
      "media_id uuid references media(id)",
      "error text",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
      "finished_at timestamptz",
    ]) {
      expect(body).toContain(col);
    }
  });

  it("indexes status and (original_name, size_bytes), guarded", () => {
    expect(sql).toContain("create index if not exists uploads_status_idx on uploads (status);");
    expect(sql).toContain("create index if not exists uploads_name_size_idx on uploads (original_name, size_bytes);");
  });

  it("is re-runnable and additive: if-not-exists everywhere, no alter/drop/delete/truncate/update", () => {
    const creates = sql.match(/create (table|index|unique index) /g) ?? [];
    const guarded = sql.match(/create (table|index|unique index) if not exists /g) ?? [];
    expect(creates.length).toBe(3);
    expect(guarded.length).toBe(creates.length);
    expect(sql).not.toMatch(/\balter\b|\bdrop\b|\bdelete\b|\btruncate\b|\bupdate\b/);
  });
});
