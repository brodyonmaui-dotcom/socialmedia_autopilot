import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE } from "../cadence.js";
import { runOutboxTick, type EngineConfig } from "../outbox/engine.js";
import { FakeClock, FakePlatform, MemoryOutboxStore, makePost } from "../testing/fakes.js";
import type { OutboxAlert, OutboxPost } from "../types.js";

// F26 A: the outbox's last duplicate check, right before the adapter is called. A hold never publishes, never changes
// the row's status, and raises one 'duplicate-held' alert (deduped per item across ticks).
const T0 = "2026-11-12T15:00:00Z";

function setup(hold: (post: OutboxPost) => Promise<string | null>) {
  const clock = new FakeClock(T0);
  const store = new MemoryOutboxStore();
  Object.assign(store, { duplicateHold: hold });
  const fake = new FakePlatform({ platform: "instagram" }, clock);
  const sent: OutboxAlert[] = [];
  const cfg: EngineConfig = { adapters: { instagram: fake.adapter() }, dryRun: false, cadence: DEFAULT_CADENCE, timeZone: "UTC", now: clock.now, nativeLeadMs: 0, alerts: { send: async (a) => void sent.push(a) } };
  return { store, fake, cfg, sent };
}

describe("outbox duplicate hold (F26 A)", () => {
  it("a held post is never sent, keeps its status, and alerts once", async () => {
    const { store, fake, cfg, sent } = setup(async (p) => (p.id === "dup" ? "This video was already posted on Instagram on Fri Nov 6" : null));
    store.add(makePost({ id: "dup", platform: "instagram", scheduledFor: T0 }));
    store.add(makePost({ id: "ok", platform: "instagram", scheduledFor: T0 }));
    const lines: string[] = [];
    const r = await runOutboxTick(store, { ...cfg, log: (l) => lines.push(l) });
    await runOutboxTick(store, cfg);
    expect(fake.created.map((c) => c.postId)).toEqual(["ok"]);
    expect(store.posts.get("dup")!.status).toBe("approved");
    expect(store.posts.get("ok")!.status).toBe("published");
    expect(r.skipped).toBe(1);
    expect(sent.filter((a) => a.kind === "duplicate-held")).toEqual([
      expect.objectContaining({ kind: "duplicate-held", postId: "dup", platform: "instagram", message: "This video was already posted on Instagram on Fri Nov 6" }),
    ]);
    expect(lines.some((l) => /held instagram dup/.test(l))).toBe(true);
  });

  it("fails closed: a check that throws holds the post", async () => {
    const { store, fake, cfg, sent } = setup(async () => {
      throw new Error("db down");
    });
    store.add(makePost({ id: "p", platform: "instagram", scheduledFor: T0 }));
    await runOutboxTick(store, cfg);
    expect(fake.created).toHaveLength(0);
    expect(store.posts.get("p")!.status).toBe("approved");
    expect(sent[0]).toMatchObject({ kind: "duplicate-held", message: expect.stringMatching(/duplicate check failed, so the post is held/) });
  });

  it("dry-run holds too (it is a read), and says so instead of 'would publish'", async () => {
    const { store, fake, cfg } = setup(async () => "This video was already posted on Instagram on Fri Nov 6");
    store.add(makePost({ id: "p", platform: "instagram", scheduledFor: T0 }));
    const lines: string[] = [];
    await runOutboxTick(store, { ...cfg, dryRun: true, log: (l) => lines.push(l) });
    expect(fake.calls).toHaveLength(0);
    expect(lines.some((l) => /would publish/.test(l))).toBe(false);
    expect(lines.some((l) => /held instagram p/.test(l))).toBe(true);
  });
});
