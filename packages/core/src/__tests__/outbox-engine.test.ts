import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE } from "../cadence.js";
import { isDueNow, runOutboxTick, type EngineConfig } from "../outbox/engine.js";
import { DEFAULT_RETRY_POLICY } from "../outbox/policy.js";
import { FakeClock, FakePlatform, MemoryOutboxStore, makePost, type FakeOutcome } from "../testing/fakes.js";
import type { OutboxAlert, Platform } from "../types.js";

const TZ = "America/New_York";
const T0 = "2026-11-12T15:00:00Z"; // 10:00 local

function setup(script: Record<string, FakeOutcome[]> = {}, platform: Platform = "instagram", opts: { canLookup?: boolean; honorsIdempotencyKey?: boolean } = {}) {
  const clock = new FakeClock(T0);
  const store = new MemoryOutboxStore();
  const fake = new FakePlatform({ platform, script, canLookup: opts.canLookup, honorsIdempotencyKey: opts.honorsIdempotencyKey }, clock);
  const sent: OutboxAlert[] = [];
  const cfg: EngineConfig = {
    adapters: { [platform]: fake.adapter() },
    dryRun: false,
    cadence: DEFAULT_CADENCE,
    timeZone: TZ,
    now: clock.now,
    nativeLeadMs: 0,
    alerts: { send: async (a) => void sent.push(a) },
  };
  return { clock, store, fake, cfg, sent };
}

describe("isDueNow", () => {
  const now = new Date(T0);
  it("instagram fires at scheduled_for, youtube/tiktok a lead time earlier, snapchat never", () => {
    expect(isDueNow(makePost({ platform: "instagram", scheduledFor: "2026-11-12T15:00:00Z" }), now, 0)).toBe(true);
    expect(isDueNow(makePost({ platform: "instagram", scheduledFor: "2026-11-12T15:01:00Z" }), now, 0)).toBe(false);
    expect(isDueNow(makePost({ platform: "youtube", scheduledFor: "2026-11-13T14:00:00Z" }), now, 24 * 3_600_000)).toBe(true);
    expect(isDueNow(makePost({ platform: "youtube", scheduledFor: "2026-11-13T16:00:00Z" }), now, 24 * 3_600_000)).toBe(false);
    expect(isDueNow(makePost({ platform: "snapchat", scheduledFor: "2026-11-12T15:00:00Z" }), now, 0)).toBe(false);
  });
  it("a queued post is due once its backoff has passed", () => {
    expect(isDueNow(makePost({ platform: "instagram", scheduledFor: T0, status: "queued", nextAttemptAt: "2026-11-12T15:05:00Z" }), now, 0)).toBe(false);
    expect(isDueNow(makePost({ platform: "instagram", scheduledFor: T0, status: "queued", nextAttemptAt: "2026-11-12T14:59:00Z" }), now, 0)).toBe(true);
  });
});

describe("runOutboxTick", () => {
  it("dry-run: logs, touches nothing, calls no adapter", async () => {
    const { store, fake, cfg } = setup();
    store.add(makePost({ platform: "instagram", scheduledFor: T0 }));
    const lines: string[] = [];
    const r = await runOutboxTick(store, { ...cfg, dryRun: true, log: (l) => lines.push(l) });
    expect(r).toMatchObject({ considered: 1, published: 0, dryRun: true });
    expect(fake.calls).toHaveLength(0);
    expect(store.all()[0]!.status).toBe("approved");
    expect(lines[0]).toMatch(/dry-run: would publish instagram/);
  });

  it("publishes a due post once and records the platform id", async () => {
    const { store, fake, cfg } = setup();
    store.add(makePost({ id: "p1", platform: "instagram", scheduledFor: T0 }));
    await runOutboxTick(store, cfg);
    await runOutboxTick(store, cfg); // a second tick must not fire it again
    expect(fake.created).toHaveLength(1);
    expect(store.posts.get("p1")).toMatchObject({ status: "published", attempts: 1, platformPostId: "instagram-1" });
  });

  it("does not fire before scheduled_for", async () => {
    const { store, fake, cfg } = setup();
    store.add(makePost({ platform: "instagram", scheduledFor: "2026-11-12T15:30:00Z" }));
    await runOutboxTick(store, cfg);
    expect(fake.calls).toHaveLength(0);
  });

  it("rejection → queued with backoff; retry checks existence first, then publishes once", async () => {
    const { store, fake, cfg, clock } = setup({ "idem-r": ["reject", "ok"] });
    store.add(makePost({ id: "r", idempotencyKey: "idem-r", platform: "instagram", scheduledFor: T0 }));
    await runOutboxTick(store, cfg);
    expect(store.posts.get("r")).toMatchObject({ status: "queued", attempts: 1, nextAttemptAt: "2026-11-12T15:05:00.000Z" });
    clock.advanceMs(4 * 60_000);
    await runOutboxTick(store, cfg);
    expect(fake.calls).toHaveLength(1); // backoff not over yet
    clock.advanceMs(60_000);
    const r = await runOutboxTick(store, cfg);
    expect(r.published).toBe(1);
    expect(fake.created).toHaveLength(1);
    expect(store.posts.get("r")).toMatchObject({ status: "published", attempts: 2 });
  });

  it("retry finds the post already on the platform → recovered, nothing resent", async () => {
    const { store, fake, cfg, clock } = setup({ "idem-x": ["timeout-created"] });
    store.add(makePost({ id: "x", idempotencyKey: "idem-x", platform: "instagram", scheduledFor: T0 }));
    await runOutboxTick(store, cfg);
    expect(store.posts.get("x")!.status).toBe("unknown");
    // A human (or a reconcile job) decides to retry: re-queue it by hand.
    await store.markQueued("x", 1, clock.now().toISOString(), "manual retry", clock.now());
    const r = await runOutboxTick(store, cfg);
    expect(r.recovered).toBe(1);
    expect(fake.calls).toHaveLength(1);
    expect(fake.created).toHaveLength(1);
    expect(store.posts.get("x")).toMatchObject({ status: "published", platformPostId: "instagram-1" });
  });

  it("timeout → unknown + one alert; later ticks never resend", async () => {
    const { store, fake, cfg, clock, sent } = setup({ "idem-t": ["timeout-not-created"] });
    store.add(makePost({ id: "t", idempotencyKey: "idem-t", platform: "instagram", scheduledFor: T0 }));
    const r = await runOutboxTick(store, cfg);
    expect(r.unknown).toBe(1);
    expect(store.posts.get("t")).toMatchObject({ status: "unknown", attempts: 1 });
    for (let i = 0; i < 200; i++) {
      clock.advanceMs(60_000);
      await runOutboxTick(store, cfg);
    }
    expect(fake.calls).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "unknown-outcome", postId: "t" });
  });

  it("final failure after maxAttempts → failed + exactly one alert", async () => {
    const { store, fake, cfg, clock, sent } = setup({ "idem-f": ["reject", "reject", "reject", "reject", "reject"] });
    store.add(makePost({ id: "f", idempotencyKey: "idem-f", platform: "instagram", scheduledFor: T0 }));
    for (let i = 0; i < 24 * 60; i++) {
      await runOutboxTick(store, cfg);
      clock.advanceMs(60_000);
    }
    expect(store.posts.get("f")).toMatchObject({ status: "failed", attempts: DEFAULT_RETRY_POLICY.maxAttempts });
    expect(fake.calls).toHaveLength(DEFAULT_RETRY_POLICY.maxAttempts);
    expect(fake.created).toHaveLength(0);
    expect(sent.filter((a) => a.kind === "final-failure")).toHaveLength(1);
  });

  it("the engine's own deadline turns a hanging publish into unknown", async () => {
    const clock = new FakeClock(T0);
    const store = new MemoryOutboxStore();
    store.add(makePost({ id: "h", platform: "instagram", scheduledFor: T0 }));
    const adapter = { platform: "instagram" as const, publish: () => new Promise<never>(() => {}) };
    const r = await runOutboxTick(store, { adapters: { instagram: adapter }, dryRun: false, cadence: DEFAULT_CADENCE, timeZone: TZ, now: clock.now, policy: { ...DEFAULT_RETRY_POLICY, publishTimeoutMs: 20 } });
    expect(r.unknown).toBe(1);
    expect(store.posts.get("h")!.lastError).toMatch(/exceeded 20 ms/);
  });

  it("holds a post that would breach the daily cap and alerts once", async () => {
    const { store, fake, cfg, sent } = setup({}, "tiktok", { honorsIdempotencyKey: true });
    const cadence = { ...DEFAULT_CADENCE, dailyCaps: { ...DEFAULT_CADENCE.dailyCaps, tiktok: 2 } };
    for (let i = 0; i < 3; i++) store.add(makePost({ id: `k${i}`, platform: "tiktok", scheduledFor: T0 }));
    await runOutboxTick(store, { ...cfg, cadence });
    await runOutboxTick(store, { ...cfg, cadence });
    expect(fake.created).toHaveLength(2);
    expect(store.posts.get("k2")!.status).toBe("approved");
    expect(sent.filter((a) => a.kind === "cap-breach")).toHaveLength(1);
  });

  it("a row stuck in publishing (worker crash) is recovered via lookup, or marked unknown without a lookup", async () => {
    const withLookup = setup();
    withLookup.store.add(makePost({ id: "c", idempotencyKey: "idem-c", platform: "instagram", scheduledFor: T0 }));
    withLookup.store.crashBeforeMarkPublished.add("c");
    await expect(runOutboxTick(withLookup.store, withLookup.cfg)).rejects.toThrow(/simulated crash/);
    expect(withLookup.store.posts.get("c")!.status).toBe("publishing");
    withLookup.clock.advanceMs(DEFAULT_RETRY_POLICY.publishTimeoutMs + 60_000);
    const r = await runOutboxTick(withLookup.store, withLookup.cfg);
    expect(r.recovered).toBe(1);
    expect(withLookup.fake.created).toHaveLength(1);
    expect(withLookup.store.posts.get("c")!.status).toBe("published");

    const noLookup = setup({}, "youtube", { canLookup: false });
    noLookup.store.add(makePost({ id: "y", platform: "youtube", scheduledFor: T0 }));
    noLookup.store.crashBeforeMarkPublished.add("y");
    await expect(runOutboxTick(noLookup.store, noLookup.cfg)).rejects.toThrow();
    noLookup.clock.advanceMs(DEFAULT_RETRY_POLICY.publishTimeoutMs + 60_000);
    const r2 = await runOutboxTick(noLookup.store, noLookup.cfg);
    expect(r2.unknown).toBe(1);
    expect(noLookup.fake.calls).toHaveLength(1);
    expect(noLookup.sent[0]).toMatchObject({ kind: "unknown-outcome", postId: "y" });
  });

  it("skips platforms without an adapter and never fires assisted ones", async () => {
    const { store, cfg } = setup();
    store.add(makePost({ platform: "youtube", scheduledFor: T0 }));
    store.add(makePost({ platform: "snapchat", scheduledFor: T0 }));
    const r = await runOutboxTick(store, cfg);
    expect(r).toMatchObject({ considered: 1, skipped: 1, published: 0 });
    expect(store.all().every((p) => p.status === "approved")).toBe(true);
  });
});
