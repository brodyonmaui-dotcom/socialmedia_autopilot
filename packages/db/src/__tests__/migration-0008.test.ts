import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { ALERT_KINDS, PUSH_KINDS_DEFAULT, isAlertKind, type AlertRow, type AlertSource } from "../types.js";

// Static checks on the hand-applied migration: the backfill keeps first deploy from paging for history,
// and one installed PWA maps to one subscription row.
const raw = readFileSync(new URL("../../migrations/0008_alerts_push.sql", import.meta.url), "utf8");
const sql = raw
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("migration 0008_alerts_push", () => {
  it("adds pushed_at and acknowledged_session to alerts", () => {
    expect(sql).toMatch(/alter table alerts add column pushed_at timestamptz, add column acknowledged_session uuid references auth_sessions\(id\) on delete set null;/);
  });

  it("backfills pushed_at on every existing alert (no burst on first deploy)", () => {
    expect(sql).toMatch(/update alerts set pushed_at = coalesce\(pushed_at, now\(\)\);/);
    // the backfill must be unconditional and come after the column exists
    expect(sql.indexOf("update alerts set pushed_at")).toBeGreaterThan(sql.indexOf("add column pushed_at"));
  });

  it("indexes unpushed open alerts", () => {
    expect(sql).toMatch(/create index alerts_unpushed_idx on alerts \(created_at\) where pushed_at is null and acknowledged_at is null;/);
  });

  it("creates push_subscriptions with a unique endpoint", () => {
    const m = sql.match(/create table push_subscriptions \((.*?)\);/);
    expect(m).not.toBeNull();
    const body = m![1]!;
    expect(body).toMatch(/endpoint text not null unique/);
    for (const col of ["p256dh text not null", "auth text not null", "session_id uuid references auth_sessions(id) on delete set null", "label text", "last_success_at timestamptz", "revoked_at timestamptz"]) {
      expect(body).toContain(col);
    }
  });

  it("never deletes, drops or adds a CHECK on alerts", () => {
    expect(sql.replace(/on delete set null/g, "")).not.toMatch(/\bdelete\b|\bdrop\b|\btruncate\b/);
    expect(sql).not.toMatch(/\bcheck\b/);
  });
});

describe("alert types", () => {
  it("AlertRow.platform accepts the service sources the writers use", () => {
    expectTypeOf<"web">().toMatchTypeOf<AlertRow["platform"]>();
    expectTypeOf<"meta">().toMatchTypeOf<AlertRow["platform"]>();
    expectTypeOf<"zernio">().toMatchTypeOf<AlertRow["platform"]>();
    expectTypeOf<"all">().toMatchTypeOf<AlertRow["platform"]>();
    expectTypeOf<"youtube">().toMatchTypeOf<AlertSource>();
    const web: AlertRow["platform"] = "web";
    const meta: AlertRow["platform"] = "meta";
    expect([web, meta]).toEqual(["web", "meta"]);
  });

  it("PUSH_KINDS_DEFAULT is the approved set and every entry is a known kind", () => {
    expect(new Set(PUSH_KINDS_DEFAULT)).toEqual(new Set(["engagement-kill", "unknown-outcome", "final-failure", "token-health", "auth"]));
    for (const k of PUSH_KINDS_DEFAULT) expect(isAlertKind(k)).toBe(true);
    expect(new Set(ALERT_KINDS).size).toBe(ALERT_KINDS.length);
    expect(isAlertKind("nope")).toBe(false);
    // F9's metrics-health is a known kind but page-only
    expect(isAlertKind("metrics-health")).toBe(true);
    expect(PUSH_KINDS_DEFAULT).not.toContain("metrics-health");
  });
});
