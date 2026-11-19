import { describe, expect, it, vi } from "vitest";
import type PgBoss from "pg-boss";
import type { Pool } from "pg";
import { QUEUES } from "../queue.js";
import { registerOutboxJob, tickSummaryLine } from "../jobs/register-outbox.js";

describe("registerOutboxJob", () => {
  it("schedules the tick every minute with singletonKey 'outbox-tick' (a hint; the advisory lock is authoritative)", async () => {
    const boss = { createQueue: vi.fn(async () => {}), work: vi.fn(async () => "w"), schedule: vi.fn(async () => {}) };
    await registerOutboxJob(boss as unknown as PgBoss, {} as Pool, { publicMediaBase: "https://media.example", dryRun: true });
    expect(boss.createQueue).toHaveBeenCalledWith(QUEUES.outboxTick);
    expect(boss.work).toHaveBeenCalledWith(QUEUES.outboxTick, expect.any(Function));
    expect(boss.schedule).toHaveBeenCalledWith(QUEUES.outboxTick, "* * * * *", undefined, { singletonKey: "outbox-tick" });
  });
});

describe("tick summary + heartbeat (F18)", () => {
  const zero = { considered: 0, published: 0, queued: 0, failed: 0, unknown: 0, recovered: 0, skipped: 0, missed: 0, dryRun: true, alerts: [] };

  it("the summary line carries the missed count (and a missed-only tick still prints it)", () => {
    expect(tickSummaryLine(zero)).toBeNull();
    expect(tickSummaryLine({ ...zero, considered: 2, missed: 2 })).toBe(
      "[outbox] tick: considered 2 · published 0 (0 recovered) · queued 0 · failed 0 · unknown 0 · skipped 0 · missed 2 (dry-run)",
    );
  });

  it("every tick upserts worker_status; a failed heartbeat write never fails the tick", async () => {
    let handler: (() => Promise<unknown>) | undefined;
    const boss = { createQueue: vi.fn(async () => {}), work: vi.fn(async (_q: string, fn: () => Promise<unknown>) => void (handler = fn)), schedule: vi.fn(async () => {}) };
    const writes: unknown[][] = [];
    let fail = false;
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        if (fail) throw new Error("db down");
        writes.push([sql, ...params]);
        return { rows: [] };
      },
    };
    const at = new Date("2026-11-19T15:00:00.000Z");
    const info = { dryRun: true, reason: "r", startedAt: "2026-11-19T14:00:00.000Z" };
    const runTick = vi.fn(async () => ({ ...zero, considered: 3, missed: 1 }));
    await registerOutboxJob(boss as unknown as PgBoss, pool as unknown as Pool, { publicMediaBase: "https://media.example", dryRun: true, now: () => at }, info, runTick);
    await handler!();
    expect(writes).toHaveLength(1);
    expect(writes[0]![0]).toMatch(/insert into settings .* on conflict \(key\) do update set value = excluded.value, updated_at = now\(\)/s);
    expect(writes[0]![1]).toBe("worker_status");
    expect(JSON.parse(writes[0]![2] as string)).toEqual({ mode: "dry-run", reason: "r", startedAt: info.startedAt, lastTickAt: at.toISOString(), missed: 1, dueNow: 2 });
    fail = true;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(handler!()).resolves.toBeUndefined();
    expect(log.mock.calls.some(([l]) => String(l).startsWith("[heartbeat] could not write worker_status"))).toBe(true);
    log.mockRestore();
  });
});
