import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE } from "../cadence.js";
import { DEFAULT_MISSED_GRACE_MS, NATIVE_MIN_LEAD_MS, runOutboxTick, type EngineConfig } from "../outbox/engine.js";
import { FakeClock, FakePlatform, MemoryOutboxStore, makePost } from "../testing/fakes.js";
import { ALERT_KINDS, PUSH_KINDS_DEFAULT, type OutboxAlert, type OutboxPost, type Platform, type PublishOptions } from "../types.js";

// F18 I1: missed-slot guard (approved posts > 60 min late are held + alerted, never sent) and the
// native-platform clamp (a late-but-in-grace YouTube/TikTok post is handed off at now + 5 min).
const TZ = "America/New_York";
const T0 = "2026-11-19T15:00:00Z"; // 10:00 local
const minutes = (n: number) => n * 60_000;
const ago = (n: number) => new Date(Date.parse(T0) - minutes(n)).toISOString();

function setup(platform: Platform, nativeLeadMs = 24 * 3_600_000) {
  const clock = new FakeClock(T0);
  const store = new MemoryOutboxStore();
  const fake = new FakePlatform({ platform }, clock);
  const base = fake.adapter();
  const handed: OutboxPost[] = [];
  const sent: OutboxAlert[] = [];
  const lines: string[] = [];
  const cfg: EngineConfig = {
    adapters: { [platform]: { ...base, publish: (p: OutboxPost, o?: PublishOptions) => (handed.push({ ...p }), base.publish(p, o)) } },
    dryRun: false,
    cadence: DEFAULT_CADENCE,
    timeZone: TZ,
    now: clock.now,
    nativeLeadMs,
    alerts: { send: async (a) => void sent.push(a) },
    log: (l) => lines.push(l),
  };
  return { clock, store, fake, cfg, handed, sent, lines };
}

describe("missed-slot guard", () => {
  it("defaults: 60 min grace, 5 min native lead", () => {
    expect(DEFAULT_MISSED_GRACE_MS).toBe(minutes(60));
    expect(NATIVE_MIN_LEAD_MS).toBe(minutes(5));
  });

  it("missed-slot is a page-only alert kind", () => {
    expect(ALERT_KINDS).toContain("missed-slot");
    expect(PUSH_KINDS_DEFAULT).not.toContain("missed-slot");
  });

  for (const platform of ["instagram", "youtube", "tiktok"] as const) {
    it(`${platform}: 61 min late → not sent, missed 1, one missed-slot alert, still approved; a second tick adds no alert`, async () => {
      const { store, fake, cfg, sent } = setup(platform);
      store.add(makePost({ id: "late", platform, scheduledFor: ago(61), caption: "secret caption text" }));
      const r1 = await runOutboxTick(store, cfg);
      expect(r1.missed).toBe(1);
      expect(r1.published).toBe(0);
      expect(fake.calls).toHaveLength(0);
      expect(store.posts.get("late")!.status).toBe("approved");
      expect(store.history).toHaveLength(0); // no write to the row at all
      expect(store.alerts).toHaveLength(1);
      expect(store.alerts[0]).toMatchObject({ kind: "missed-slot", platform, postId: "late" });
      // Scheduled 13:59Z = 08:59 local on 2026-11-19.
      expect(store.alerts[0]!.message).toBe(`post missed its time (${platform}, 8:59 AM 2026-11-19); move it in the calendar`);
      expect(store.alerts[0]!.message).not.toContain("secret");
      expect(sent).toHaveLength(1);

      const r2 = await runOutboxTick(store, cfg);
      expect(r2.missed).toBe(1);
      expect(r2.alerts).toHaveLength(0);
      expect(store.alerts).toHaveLength(1);
      expect(sent).toHaveLength(1);
      expect(fake.calls).toHaveLength(0);
      expect(store.posts.get("late")!.status).toBe("approved");
    });
  }

  it("59 min late → sent (instagram fires at once)", async () => {
    const { store, fake, cfg, handed } = setup("instagram");
    store.add(makePost({ id: "ok", platform: "instagram", scheduledFor: ago(59) }));
    const r = await runOutboxTick(store, cfg);
    expect(r).toMatchObject({ missed: 0, published: 1 });
    expect(fake.created).toHaveLength(1);
    expect(handed[0]!.scheduledFor).toBe(ago(59)); // Instagram is not clamped
    expect(store.alerts).toHaveLength(0);
  });

  it("the guard runs before the cap guard: a missed post never raises cap-breach", async () => {
    const { store, cfg } = setup("instagram");
    store.add(makePost({ id: "late", platform: "instagram", scheduledFor: ago(61) }));
    const r = await runOutboxTick(store, { ...cfg, cadence: { dailyCaps: { ...DEFAULT_CADENCE.dailyCaps, instagram: 0 } } });
    expect(r.missed).toBe(1);
    expect(store.alerts.map((a) => a.kind)).toEqual(["missed-slot"]);
  });

  it("a configurable grace is honoured", async () => {
    const { store, fake, cfg } = setup("instagram");
    store.add(makePost({ id: "p", platform: "instagram", scheduledFor: ago(20) }));
    const r = await runOutboxTick(store, { ...cfg, missedGraceMs: minutes(15) });
    expect(r.missed).toBe(1);
    expect(fake.calls).toHaveLength(0);
  });

  it("a queued retry 3 h late still retries", async () => {
    const { store, fake, cfg } = setup("instagram");
    store.add(makePost({ id: "q", platform: "instagram", scheduledFor: ago(180), status: "queued", attempts: 1, nextAttemptAt: ago(1) }));
    const r = await runOutboxTick(store, cfg);
    expect(r.missed).toBe(0);
    expect(fake.calls).toHaveLength(1);
    expect(store.posts.get("q")!.status).toBe("published");
    expect(store.alerts).toHaveLength(0);
  });

  it("dry-run: the guard and its alert apply too; nothing is published or written", async () => {
    const { store, fake, cfg, lines } = setup("youtube");
    store.add(makePost({ id: "late", platform: "youtube", scheduledFor: ago(61) }));
    store.add(makePost({ id: "fine", platform: "youtube", scheduledFor: ago(10) }));
    const r = await runOutboxTick(store, { ...cfg, dryRun: true });
    expect(r).toMatchObject({ dryRun: true, missed: 1, published: 0 });
    expect(fake.calls).toHaveLength(0);
    expect(store.history).toHaveLength(0);
    expect(store.all().map((p) => p.status)).toEqual(["approved", "approved"]);
    expect(store.alerts.map((a) => [a.kind, a.postId])).toEqual([["missed-slot", "late"]]);
    expect(lines.filter((l) => l.includes("would publish"))).toHaveLength(1);
    expect(lines.some((l) => l.includes("late"))).toBe(false); // no per-item line for a missed post
  });
});

describe("native clamp (late but within grace)", () => {
  for (const platform of ["youtube", "tiktok"] as const) {
    it(`${platform}: 10 min late → handed off with scheduledFor = now + 5 min; the stored row keeps its time and key`, async () => {
      const { store, cfg, handed } = setup(platform);
      store.add(makePost({ id: "p", idempotencyKey: "idem-p", platform, scheduledFor: ago(10) }));
      const r = await runOutboxTick(store, cfg);
      expect(r).toMatchObject({ missed: 0, published: 1 });
      expect(handed).toHaveLength(1);
      expect(Date.parse(handed[0]!.scheduledFor)).toBeGreaterThanOrEqual(Date.parse(T0) + minutes(5));
      expect(handed[0]!.idempotencyKey).toBe("idem-p");
      expect(store.posts.get("p")!.scheduledFor).toBe(ago(10));
      expect(store.posts.get("p")!.idempotencyKey).toBe("idem-p");
    });
  }

  it("youtube 2 min ahead is also pushed to now + 5 min", async () => {
    const { store, cfg, handed } = setup("youtube");
    store.add(makePost({ id: "p", platform: "youtube", scheduledFor: ago(-2) }));
    await runOutboxTick(store, cfg);
    expect(handed[0]!.scheduledFor).toBe(new Date(Date.parse(T0) + minutes(5)).toISOString());
  });

  it("a future youtube post 20 h ahead is sent with its own time", async () => {
    const { store, cfg, handed } = setup("youtube");
    const at = new Date(Date.parse(T0) + 20 * 3_600_000).toISOString();
    store.add(makePost({ id: "p", platform: "youtube", scheduledFor: at }));
    const r = await runOutboxTick(store, cfg);
    expect(r.published).toBe(1);
    expect(handed[0]!.scheduledFor).toBe(at);
  });
});
