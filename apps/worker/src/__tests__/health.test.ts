import { describe, expect, it } from "vitest";
import { registerHealthJob } from "../jobs/health.js";
import { QUEUES } from "../queue.js";

describe("registerHealthJob", () => {
  it("creates the queue before scheduling/working it (pg-boss v10 requires this order)", async () => {
    const calls: string[] = [];
    const fakeBoss = {
      createQueue: async (name: string) => {
        calls.push(`createQueue:${name}`);
      },
      work: async (name: string) => {
        calls.push(`work:${name}`);
      },
      schedule: async (name: string) => {
        calls.push(`schedule:${name}`);
      },
    } as unknown as Parameters<typeof registerHealthJob>[0];

    await registerHealthJob(fakeBoss);

    expect(calls[0]).toBe(`createQueue:${QUEUES.health}`);
    expect(calls).toContain(`work:${QUEUES.health}`);
    expect(calls).toContain(`schedule:${QUEUES.health}`);
  });
});
