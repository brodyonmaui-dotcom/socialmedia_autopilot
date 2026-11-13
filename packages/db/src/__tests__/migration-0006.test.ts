import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BATCH_ITEM_STATUSES } from "../types.js";

// Static checks on the hand-applied migration: the backfill keeps already-approved rows flowing through
// the new worker gate, and the CHECK can't drift from the statuses the code writes.
const raw = readFileSync(new URL("../../migrations/0006_auth_approval.sql", import.meta.url), "utf8");
const sql = raw
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("migration 0006_auth_approval", () => {
  it("backfills approved_at on items that were approved or past it", () => {
    const m = sql.match(/update batch_items set approved_at = [^;]*? where status in \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const list = m![1]!.split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    expect(new Set(list)).toEqual(new Set(["approved", "queued", "publishing", "published", "unknown", "failed"]));
  });

  it("backfills batches to approved where an approved item exists", () => {
    expect(sql).toMatch(/update batches b set status = 'approved'[^;]*where exists \(select 1 from batch_items bi where bi\.batch_id = b\.id and bi\.approved_at is not null\)/);
  });

  it("the status CHECK lists exactly BATCH_ITEM_STATUSES", () => {
    const m = sql.match(/check \(status in \(([^)]*)\)\)/);
    expect(m).not.toBeNull();
    const list = m![1]!.split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    expect(list).toHaveLength(new Set(list).size);
    expect(new Set(list)).toEqual(new Set(BATCH_ITEM_STATUSES));
  });

  it("adds the CHECK not valid, then validates it", () => {
    const add = sql.indexOf("add constraint batch_items_status_check");
    const notValid = sql.indexOf(" not valid;", add);
    const validate = sql.indexOf("validate constraint batch_items_status_check");
    expect(add).toBeGreaterThan(-1);
    expect(notValid).toBeGreaterThan(add);
    expect(validate).toBeGreaterThan(notValid);
  });

  it("never drops, deletes or truncates", () => {
    // FK actions ("on delete cascade / set null") and "drop not null" are fine; destructive statements and clauses are not.
    for (const stmt of sql.split(";").map((x) => x.trim()).filter(Boolean)) expect(stmt).not.toMatch(/^(drop|delete|truncate)\b/);
    expect(sql).not.toMatch(/\bdrop (table|column|constraint|index|type|schema|view|function|default)\b|\bdelete from\b|\btruncate\b/);
  });
});
