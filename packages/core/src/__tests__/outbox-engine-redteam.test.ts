// F7 red-team rows for the outbox engine: B2/B3 (sanitised last_error, alerts, logs), C5 (publish-time
// caption guard), A7 (dry-run stale rows), A8 (store failure after publish), A9 (overlapping ticks).
import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE } from "../cadence.js";
import { runOutboxTick, type EngineConfig } from "../outbox/engine.js";
import { DEFAULT_RETRY_POLICY, NonRetryableError } from "../outbox/policy.js";
import { FakeClock, FakePlatform, MemoryOutboxStore, makePost, type FakeOutcome } from "../testing/fakes.js";
import type { OutboxAlert, OutboxPost, Platform, PlatformAdapter } from "../types.js";

const TZ = "America/New_York";
const T0 = "2026-11-12T15:00:00Z";
// Synthetic token shapes, built by concatenation.
const META = "EAAB" + "x7Yq2Lm9Pz3Kd8Rw4Tn6Vb1Hc5Jf0Gs";
const GOOGLE = "ya29." + "a0AfB_byC7dEfGh1JkLmN2oPqRsT3uVwXyZ";
const ZERNIO = "sk_" + "live_9fA3kLm2Qx7Rt8Vw1Yz4Bc6De0Gh";
const SECRETS = [META.slice(4), GOOGLE.slice(4), ZERNIO.slice(4)];
const leaky = `HTTP 400 for https://graph.facebook.com/v25.0/me/media?access_token=${META} (Bearer ${ZERNIO}) google ${GOOGLE}`;

function setup(script: Record<string, FakeOutcome[]> = {}, platform: Platform = "instagram", opts: { canLookup?: boolean } = {}) {
  const clock = new FakeClock(T0);
  const store = new MemoryOutboxStore();
  const fake = new FakePlatform({ platform, script, canLookup: opts.canLookup }, clock);
  const sent: OutboxAlert[] = [];
  const lines: string[] = [];
  const cfg: EngineConfig = {
    adapters: { [platform]: fake.adapter() },
    dryRun: false,
    cadence: DEFAULT_CADENCE,
    timeZone: TZ,
    now: clock.now,
    nativeLeadMs: 0,
    alerts: { send: async (a) => void sent.push(a) },
    log: (l) => lines.push(l),
  };
  return { clock, store, fake, cfg, sent, lines };
}

function throwing(platform: Platform, make: () => unknown, findExisting?: PlatformAdapter["findExisting"]): PlatformAdapter {
  return {
    platform,
    publish: async () => {
      throw make();
    },
    findExisting,
  };
}

const expectClean = (...texts: Array<string | undefined>) => {
  for (const t of texts) for (const s of SECRETS) expect(t ?? "").not.toContain(s);
};

describe("B2/B3: tokens never reach last_error, alerts or logs", () => {
  it("rejection → queued: last_error and the log line are sanitised", async () => {
    const { store, cfg, lines } = setup();
    store.add(makePost({ id: "q", platform: "instagram", scheduledFor: T0 }));
    await runOutboxTick(store, { ...cfg, adapters: { instagram: throwing("instagram", () => new Error(leaky)) } });
    const p = store.posts.get("q")!;
    expect(p.status).toBe("queued");
    expect(p.lastError).toMatch(/HTTP 400/);
    expectClean(p.lastError, ...lines);
  });

  it("permanent failure → failed: last_error, alert message and the platform body are sanitised", async () => {
    const { store, cfg, sent, lines } = setup();
    store.add(makePost({ id: "f", platform: "instagram", scheduledFor: T0 }));
    const err = Object.assign(new NonRetryableError("instagram: HTTP 400"), { status: 400, body: { error: { message: leaky } } });
    await runOutboxTick(store, { ...cfg, adapters: { instagram: throwing("instagram", () => err) } });
    const p = store.posts.get("f")!;
    expect(p.status).toBe("failed");
    expect(p.lastError).toMatch(/body:/); // the platform's own words are kept (sanitised) for the dashboard
    expect(sent).toHaveLength(1);
    expectClean(p.lastError, sent[0]!.message, store.alerts[0]!.message, ...lines);
  });

  it("timeout → unknown: alert and last_error sanitised", async () => {
    const { store, cfg, sent, lines } = setup();
    store.add(makePost({ id: "u", platform: "instagram", scheduledFor: T0 }));
    await runOutboxTick(store, { ...cfg, adapters: { instagram: throwing("instagram", () => new TypeError(`fetch failed ${leaky}`)) } });
    const p = store.posts.get("u")!;
    expect(p.status).toBe("unknown");
    expectClean(p.lastError, sent[0]!.message, ...lines);
  });

  it("a failing existence check is sanitised too", async () => {
    const { store, cfg, lines } = setup();
    store.add(makePost({ id: "e", platform: "instagram", scheduledFor: T0, status: "queued", attempts: 1 }));
    const adapter: PlatformAdapter = { platform: "instagram", publish: async () => ({ platformPostId: "x" }), findExisting: async () => { throw new Error(leaky); } };
    await runOutboxTick(store, { ...cfg, adapters: { instagram: adapter } });
    expect(store.posts.get("e")!.lastError).toMatch(/existence check failed/);
    expectClean(store.posts.get("e")!.lastError, ...lines);
  });
});

describe("C5: publish-time caption guard", () => {
  it("a refusal → adapter never called, row failed, one alert", async () => {
    const { store, fake, cfg, sent } = setup();
    store.add(makePost({ id: "g", platform: "instagram", scheduledFor: T0, caption: "leg day" }));
    const seen: OutboxPost[] = [];
    const r = await runOutboxTick(store, { ...cfg, captionGuard: (p) => (seen.push(p), "caption failed privacy lint: privacy.place") });
    expect(seen.map((p) => p.id)).toEqual(["g"]);
    expect(fake.calls).toHaveLength(0);
    expect(r.failed).toBe(1);
    expect(store.posts.get("g")).toMatchObject({ status: "failed", lastError: "caption failed privacy lint: privacy.place" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "final-failure", postId: "g" });
    expect(sent[0]!.message).toMatch(/privacy lint/);
  });

  it("a guard that throws fails closed", async () => {
    const { store, fake, cfg } = setup();
    store.add(makePost({ id: "t", platform: "instagram", scheduledFor: T0 }));
    await runOutboxTick(store, { ...cfg, captionGuard: () => { throw new Error("lint crashed"); } });
    expect(fake.calls).toHaveLength(0);
    expect(store.posts.get("t")!.status).toBe("failed");
  });

  it("a clean caption (guard returns null) publishes", async () => {
    const { store, fake, cfg } = setup();
    store.add(makePost({ id: "c", platform: "instagram", scheduledFor: T0 }));
    await runOutboxTick(store, { ...cfg, captionGuard: () => null });
    expect(fake.created).toHaveLength(1);
  });

  it("dry-run: a refusal is logged, nothing is written", async () => {
    const { store, fake, cfg, lines } = setup();
    store.add(makePost({ id: "d", platform: "instagram", scheduledFor: T0 }));
    const r = await runOutboxTick(store, { ...cfg, dryRun: true, captionGuard: () => "caption failed privacy lint: privacy.place" });
    expect(fake.calls).toHaveLength(0);
    expect(store.history).toHaveLength(0);
    expect(store.alerts).toHaveLength(0);
    expect(r.skipped).toBe(1);
    expect(lines.join("\n")).toMatch(/dry-run: would refuse instagram d: caption failed privacy lint/);
  });
});

describe("A7: dry-run never touches a stale publishing row", () => {
  it("no markUnknown, no alert, no lookup", async () => {
    const { store, cfg, clock, sent } = setup();
    store.add(makePost({ id: "s", platform: "instagram", scheduledFor: T0, status: "publishing", updatedAt: T0 }));
    let lookups = 0;
    const adapter: PlatformAdapter = { platform: "instagram", publish: async () => ({ platformPostId: "x" }), findExisting: async () => ((lookups++), null) };
    clock.advanceMs(DEFAULT_RETRY_POLICY.publishTimeoutMs + 60_000);
    const r = await runOutboxTick(store, { ...cfg, dryRun: true, adapters: { instagram: adapter } });
    expect(r).toMatchObject({ unknown: 0, recovered: 0 });
    expect(lookups).toBe(0);
    expect(store.history).toHaveLength(0);
    expect(store.alerts).toHaveLength(0);
    expect(sent).toHaveLength(0);
    expect(store.posts.get("s")!.status).toBe("publishing");
  });
});

describe("A8: store failure after a successful publish", () => {
  it("row stays publishing; the stale path recovers it via findExisting; publish called exactly once; the attempt is counted", async () => {
    const { store, fake, cfg, clock } = setup();
    store.add(makePost({ id: "c", idempotencyKey: "idem-c8", platform: "instagram", scheduledFor: T0 }));
    store.crashBeforeMarkPublished.add("c");
    await expect(runOutboxTick(store, cfg)).rejects.toThrow(/simulated crash/);
    expect(store.posts.get("c")!.status).toBe("publishing");
    // Ticks inside the stale window leave it alone (not due, not stale yet).
    clock.advanceMs(60_000);
    await runOutboxTick(store, cfg);
    expect(store.posts.get("c")!.status).toBe("publishing");
    clock.advanceMs(DEFAULT_RETRY_POLICY.publishTimeoutMs);
    const r = await runOutboxTick(store, cfg);
    expect(r.recovered).toBe(1);
    for (let i = 0; i < 30; i++) {
      clock.advanceMs(60_000);
      await runOutboxTick(store, cfg);
    }
    expect(fake.calls).toHaveLength(1);
    expect(fake.created).toHaveLength(1);
    expect(store.posts.get("c")).toMatchObject({ status: "published", attempts: 1, platformPostId: "instagram-1" });
  });

  it("without a lookup the crashed attempt is counted, so a hand re-queue still checks existence before resending", async () => {
    const { store, fake, cfg, clock } = setup();
    store.add(makePost({ id: "y", idempotencyKey: "idem-y8", platform: "instagram", scheduledFor: T0 }));
    store.crashBeforeMarkPublished.add("y");
    await expect(runOutboxTick(store, cfg)).rejects.toThrow();
    clock.advanceMs(DEFAULT_RETRY_POLICY.publishTimeoutMs + 60_000);
    // Lookup unavailable during the stale pass (e.g. API down): unknown.
    const adapter = fake.adapter();
    const noLookup: PlatformAdapter = { platform: "instagram", publish: adapter.publish };
    await runOutboxTick(store, { ...cfg, adapters: { instagram: noLookup } });
    expect(store.posts.get("y")).toMatchObject({ status: "unknown", attempts: 1 });
    // A human re-queues it; the retry path must consult findExisting (attempts > 0), not resend.
    await store.markQueued("y", store.posts.get("y")!.attempts, clock.now().toISOString(), "manual retry", clock.now());
    const r = await runOutboxTick(store, cfg);
    expect(r.recovered).toBe(1);
    expect(fake.calls).toHaveLength(1);
    expect(fake.doublePosts()).toEqual([]);
  });
});

describe("A9: overlapping ticks on one store", () => {
  it("two concurrent runOutboxTick calls → one publish per post", async () => {
    const { store, fake, cfg } = setup({}, "tiktok");
    for (let i = 0; i < 3; i++) store.add(makePost({ id: `o${i}`, platform: "tiktok", scheduledFor: T0 }));
    const [a, b] = await Promise.all([runOutboxTick(store, cfg), runOutboxTick(store, cfg)]);
    expect(a.published + b.published).toBe(3);
    expect(fake.calls).toHaveLength(3);
    expect(fake.doublePosts()).toEqual([]);
  });

  it("overlap with a slow publish and a rejection: still one call per post per attempt", async () => {
    const { store, fake, cfg } = setup({ "idem-slow-r": ["reject"] }, "instagram");
    store.add(makePost({ id: "sr", idempotencyKey: "idem-slow-r", platform: "instagram", scheduledFor: T0 }));
    store.add(makePost({ id: "ok", idempotencyKey: "idem-ok", platform: "instagram", scheduledFor: T0 }));
    const inner = fake.adapter();
    const slow: PlatformAdapter = { ...inner, publish: async (p, o) => { await new Promise((r) => setTimeout(r, 5)); return inner.publish(p, o); } };
    const c = { ...cfg, adapters: { instagram: slow } };
    await Promise.all([runOutboxTick(store, c), runOutboxTick(store, c), runOutboxTick(store, c)]);
    expect(fake.calls.filter((x) => x.idempotencyKey === "idem-slow-r")).toHaveLength(1);
    expect(fake.calls.filter((x) => x.idempotencyKey === "idem-ok")).toHaveLength(1);
    expect(store.posts.get("sr")!.status).toBe("queued");
  });
});
