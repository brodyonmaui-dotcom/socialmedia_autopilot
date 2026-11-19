import { describe, expect, it } from "vitest";
import { AUTO_APPROVE_INTERVAL_MS, startEditorAutoApprove, type TimerDeps } from "../auto-approve-timer.js";

const ENV = { DATABASE_URL: "postgres://local-test", TZ_CREATOR: "UTC" } as unknown as NodeJS.ProcessEnv;

function harness(over: Partial<TimerDeps> = {}) {
  const lines: string[] = [];
  const timers: Array<{ ms: number; unref: boolean }> = [];
  const calls: string[] = [];
  const tick = startEditorAutoApprove({
    env: ENV,
    log: (l) => lines.push(l),
    setInterval: (_fn, ms) => {
      const t = { ms, unref: false };
      timers.push(t);
      return { unref: () => (t.unref = true) };
    },
    run: async (_now, tz) => {
      calls.push(tz);
      return { approved: 0 };
    },
    ...over,
  });
  return { tick, lines, timers, calls };
}

describe("startEditorAutoApprove", () => {
  it("one unref'd 60 s interval; a tick runs with the creator zone and logs nothing when nothing was approved", async () => {
    const h = harness();
    expect(h.timers).toEqual([{ ms: AUTO_APPROVE_INTERVAL_MS, unref: true }]);
    await h.tick!();
    expect(h.calls).toEqual(["UTC"]);
    expect(h.lines).toEqual([]);
  });

  it("a failure logs one line with the error name only", async () => {
    const h = harness({
      run: async () => {
        throw new Error("connect failed postgres://user:secret@host/db");
      },
    });
    await h.tick!();
    expect(h.lines).toEqual(["[editor-auto-approve] failed: Error"]);
    expect(h.lines.join()).not.toMatch(/secret|postgres/);
  });

  it("ticks never overlap in-process", async () => {
    let release!: () => void;
    let n = 0;
    const h = harness({
      run: () => {
        n++;
        return new Promise((r) => (release = () => r({ approved: 2 })));
      },
    });
    const first = h.tick!();
    await h.tick!();
    release();
    await first;
    expect(n).toBe(1);
    expect(h.lines).toEqual(["[editor-auto-approve] approved 2"]);
  });

  it("doesn't start without DATABASE_URL or with no valid TZ_CREATOR", () => {
    expect(harness({ env: { TZ_CREATOR: "UTC" } as unknown as NodeJS.ProcessEnv }).tick).toBeNull();
    expect(harness({ env: { DATABASE_URL: "x" } as unknown as NodeJS.ProcessEnv }).tick).toBeNull();
    expect(harness({ env: { DATABASE_URL: "x", TZ_CREATOR: "Not/AZone" } as unknown as NodeJS.ProcessEnv }).timers).toEqual([]);
  });
});
