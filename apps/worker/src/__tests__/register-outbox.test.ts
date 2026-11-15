import { describe, expect, it, vi } from "vitest";
import type PgBoss from "pg-boss";
import type { Pool } from "pg";
import { QUEUES } from "../queue.js";
import { registerOutboxJob } from "../jobs/register-outbox.js";

describe("registerOutboxJob", () => {
  it("schedules the tick every minute with singletonKey 'outbox-tick' (a hint; the advisory lock is authoritative)", async () => {
    const boss = { createQueue: vi.fn(async () => {}), work: vi.fn(async () => "w"), schedule: vi.fn(async () => {}) };
    await registerOutboxJob(boss as unknown as PgBoss, {} as Pool, { publicMediaBase: "https://media.example", dryRun: true });
    expect(boss.createQueue).toHaveBeenCalledWith(QUEUES.outboxTick);
    expect(boss.work).toHaveBeenCalledWith(QUEUES.outboxTick, expect.any(Function));
    expect(boss.schedule).toHaveBeenCalledWith(QUEUES.outboxTick, "* * * * *", undefined, { singletonKey: "outbox-tick" });
  });
});
