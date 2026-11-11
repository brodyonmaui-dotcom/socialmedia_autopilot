import { describe, expect, it } from "vitest";
import { processApprovedItems } from "../jobs/outbox.js";
import type { PlatformAdapter } from "@autopilot/core";

interface FakeRow {
  id: string;
  idempotency_key: string;
  platform: string;
  caption: string;
  title: string | null;
  scheduled_for: string;
  attempts: number;
  r2_key: string;
}

function fakePool(rows: FakeRow[]) {
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  return {
    updates,
    query: async (sql: string, params?: unknown[]) => {
      if (sql.trim().startsWith("select")) return { rows };
      updates.push({ sql, params: params ?? [] });
      return { rows: [] };
    },
  };
}

function fakeAdapter(platform: string, impl: PlatformAdapter["publish"]): PlatformAdapter {
  return { platform: platform as PlatformAdapter["platform"], publish: impl };
}

const baseRow: FakeRow = {
  id: "item-1",
  idempotency_key: "idem-1",
  platform: "youtube",
  caption: "caption",
  title: "title",
  scheduled_for: "2026-12-01T09:00:00Z",
  attempts: 0,
  r2_key: "library/abc.mp4",
};

describe("processApprovedItems", () => {
  it("dry-run: never calls the adapter or mutates status", async () => {
    const pool = fakePool([baseRow]);
    let called = false;
    const adapters = { youtube: fakeAdapter("youtube", async () => { called = true; return { platformPostId: "x" }; }) };
    const result = await processApprovedItems(pool as never, adapters, { publicMediaBase: "https://media.example", dryRun: true });
    expect(result).toEqual({ processed: 1, dryRun: true });
    expect(called).toBe(false);
    expect(pool.updates.length).toBe(0);
  });

  it("on success: marks published with the platform's id/url", async () => {
    const pool = fakePool([baseRow]);
    const adapters = {
      youtube: fakeAdapter("youtube", async () => ({ platformPostId: "yt123", platformPostUrl: "https://youtube.com/watch?v=yt123" })),
    };
    const result = await processApprovedItems(pool as never, adapters, { publicMediaBase: "https://media.example", dryRun: false });
    expect(result.processed).toBe(1);
    const finalUpdate = pool.updates.find((u) => u.sql.includes("status = 'published'"));
    expect(finalUpdate?.params).toEqual(["item-1", "yt123", "https://youtube.com/watch?v=yt123"]);
  });

  it("on a deliberate rejection: retries (status back to approved) until maxAttempts, then fails", async () => {
    const pool = fakePool([{ ...baseRow, attempts: 2 }]);
    const adapters = { youtube: fakeAdapter("youtube", async () => { throw new Error("quota exceeded"); }) };
    await processApprovedItems(pool as never, adapters, { publicMediaBase: "https://media.example", dryRun: false, maxAttempts: 3 });
    const finalUpdate = pool.updates[pool.updates.length - 1];
    expect(finalUpdate?.params).toEqual(["item-1", "failed", "quota exceeded", 3]);
  });

  it("on a deliberate rejection below maxAttempts: goes back to approved for a retry", async () => {
    const pool = fakePool([{ ...baseRow, attempts: 0 }]);
    const adapters = { youtube: fakeAdapter("youtube", async () => { throw new Error("rate limited"); }) };
    await processApprovedItems(pool as never, adapters, { publicMediaBase: "https://media.example", dryRun: false, maxAttempts: 3 });
    const finalUpdate = pool.updates[pool.updates.length - 1];
    expect(finalUpdate?.params).toEqual(["item-1", "approved", "rate limited", 1]);
  });

  it("on a network/timeout failure: marks unknown, never auto-retries", async () => {
    const pool = fakePool([baseRow]);
    const adapters = {
      youtube: fakeAdapter("youtube", async () => {
        throw new TypeError("fetch failed");
      }),
    };
    await processApprovedItems(pool as never, adapters, { publicMediaBase: "https://media.example", dryRun: false });
    const finalUpdate = pool.updates[pool.updates.length - 1];
    expect(finalUpdate?.sql).toContain("status = 'unknown'");
  });

  it("skips rows for platforms with no configured adapter", async () => {
    const pool = fakePool([{ ...baseRow, platform: "instagram" }]);
    const adapters = { youtube: fakeAdapter("youtube", async () => ({ platformPostId: "x" })) };
    const result = await processApprovedItems(pool as never, adapters, { publicMediaBase: "https://media.example", dryRun: false });
    expect(result.processed).toBe(0);
  });
});
