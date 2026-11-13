import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY_POLICY, backoffMs } from "@autopilot/core";
import { runSendTick } from "../send.js";
import { DEFAULT_ENGAGEMENT } from "../settings.js";
import { MemoryEngagementStore } from "../testing/fake-store.js";
import { FakeCommentSource, fakeThread, type FakeSourceOptions } from "../testing/fake-source.js";
import type { EngagementPlatform, EngagementSettings, SendTickConfig } from "../types.js";

const NOW = new Date("2026-11-13T12:00:00Z");
const LIVE: EngagementSettings = {
  ...DEFAULT_ENGAGEMENT,
  mode: { instagram: "live", youtube: "live", tiktok: "live" },
  hideEnabled: { instagram: true, youtube: true, tiktok: true },
};
const BEFORE = "2026-11-13T11:00:00Z";

function setup(opts: FakeSourceOptions = {}) {
  const store = new MemoryEngagementStore();
  // Threads exist (no own replies) unless a test scripts them: the tick re-reads the thread before every send.
  const src = new FakeCommentSource("instagram", { missingThread: "empty", ...opts });
  const sources = new Map<EngagementPlatform, FakeCommentSource>([["instagram", src]]);
  const lines: string[] = [];
  const cfg = (over: Partial<SendTickConfig> = {}, at: Date = NOW): SendTickConfig => ({
    settings: LIVE, dryRun: false, killEnv: false, now: () => at, log: (l) => lines.push(l), timeoutMs: 20, ...over,
  });
  return { store, src, sources, cfg, lines };
}

describe("runSendTick", () => {
  it("live: sends a due reply with the row's idempotency key and marks it sent", async () => {
    const { store, src, sources, cfg } = setup();
    const a = store.addAction({ id: "a1", notBefore: BEFORE, idempotencyKey: "engage:xyz" });
    const r = await runSendTick(store, sources, cfg());
    expect(r).toMatchObject({ considered: 1, sent: 1, failed: 0, unknown: 0, retried: 0, killedNow: null });
    expect(src.calls).toEqual([{ op: "reply", platformCommentId: a.platformCommentId, text: "thanks!", idempotencyKey: "engage:xyz" }]);
    expect(store.get("a1")).toMatchObject({ status: "sent", platformActionId: "reply-1", attempts: 1 });
  });

  it("dry-run sends nothing and changes no status (default when dryRun is undefined too)", async () => {
    const { store, src, sources, cfg } = setup();
    store.addAction({ id: "a1", notBefore: BEFORE });
    const r = await runSendTick(store, sources, cfg({ dryRun: true }));
    expect(r.skipped).toEqual({ "dry-run": 1 });
    const r2 = await runSendTick(store, sources, cfg({ dryRun: undefined as unknown as boolean }));
    expect(r2.skipped).toEqual({ "dry-run": 1 });
    expect(src.calls).toEqual([]);
    expect(store.get("a1").status).toBe("planned");
  });

  it("shadow rows are never listed or sent (the store lists planned only)", async () => {
    const { store, src, sources, cfg } = setup();
    for (const status of ["shadow", "sent", "failed", "unknown", "cancelled", "sending"] as const) store.addAction({ status, notBefore: BEFORE });
    expect(await store.listDueActions(NOW)).toEqual([]);
    const r = await runSendTick(store, sources, cfg());
    expect(r.considered).toBe(0);
    expect(src.calls).toEqual([]);
  });

  it("killed via the setting or via env sends nothing", async () => {
    const { store, src, sources, cfg } = setup();
    store.addAction({ id: "a1", notBefore: BEFORE });
    expect((await runSendTick(store, sources, cfg({ settings: { ...LIVE, killed: true } }))).skipped).toEqual({ killed: 1 });
    expect((await runSendTick(store, sources, cfg({ killEnv: true }))).skipped).toEqual({ killed: 1 });
    expect(src.calls).toEqual([]);
    expect(store.get("a1").status).toBe("planned");
  });

  it("an auto row on a shadow platform waits (mode), no status change", async () => {
    const { store, src, sources, cfg } = setup();
    store.addAction({ id: "a1", notBefore: BEFORE });
    expect((await runSendTick(store, sources, cfg({ settings: DEFAULT_ENGAGEMENT }))).skipped).toEqual({ mode: 1 });
    expect(src.calls).toEqual([]);
    expect(store.get("a1").status).toBe("planned");
  });

  it("too-early waits, then sends once now passes notBefore", async () => {
    const { store, src, sources, cfg } = setup();
    store.addAction({ id: "a1", notBefore: "2026-11-13T12:10:00Z" });
    const r1 = await runSendTick(store, sources, cfg());
    expect(r1.sent).toBe(0);
    expect(src.calls).toEqual([]);
    expect(store.get("a1").status).toBe("planned");
    const r2 = await runSendTick(store, sources, cfg({}, new Date("2026-11-13T12:10:01Z")));
    expect(r2.sent).toBe(1);
    expect(src.calls).toHaveLength(1);
  });

  it("limit reached → skipped, nothing sent", async () => {
    const { store, src, sources, cfg } = setup();
    for (let i = 0; i < LIVE.limits.perPlatformPerHour; i++)
      store.sentTexts.push({ platform: "instagram", authorId: `x${i}`, text: "hi", sentAt: "2026-11-13T11:30:00Z" });
    store.addAction({ id: "a1", notBefore: BEFORE });
    const r = await runSendTick(store, sources, cfg());
    expect(r.skipped).toEqual({ limit: 1 });
    expect(src.calls).toEqual([]);
  });

  it("limits apply within one tick: the 11th reply in an hour waits", async () => {
    const { store, src, sources, cfg } = setup();
    for (let i = 0; i < 11; i++) store.addAction({ notBefore: BEFORE });
    const r = await runSendTick(store, sources, cfg());
    expect(r.sent).toBe(10);
    expect(r.skipped).toEqual({ limit: 1 });
    expect(src.calls).toHaveLength(10);
  });

  it("a timeout → unknown + alert, and a second tick does NOT retry it", async () => {
    const { store, src, sources, cfg } = setup({ behaviours: { "pc-a1": "timeout" } });
    store.addAction({ id: "a1", notBefore: BEFORE });
    const r = await runSendTick(store, sources, cfg());
    expect(r.unknown).toBe(1);
    expect(r.alerts.map((a) => a.kind)).toEqual(["engagement-unknown"]);
    expect(store.get("a1").status).toBe("unknown");
    const r2 = await runSendTick(store, sources, cfg({}, new Date(NOW.getTime() + 3_600_000)));
    expect(r2.considered).toBe(0);
    expect(src.calls).toHaveLength(1);
  });

  it("a retry whose thread already has our reply → markSent, zero source calls, counted already-exists", async () => {
    const { store, src, sources, cfg } = setup({ threads: { "pc-a1": fakeThread("instagram", "pc-a1", [{ id: "r-9", text: "@fan  Thanks! " }]) } });
    store.addAction({ id: "a1", notBefore: BEFORE, attempts: 1, lastError: "bad request" });
    const r = await runSendTick(store, sources, cfg());
    expect(r.skipped).toEqual({ "already-exists": 1 });
    expect(r.sent).toBe(0);
    expect(src.calls).toEqual([]);
    expect(src.threadCalls).toEqual(["pc-a1"]);
    expect(store.get("a1")).toMatchObject({ status: "sent", platformActionId: "r-9" });
  });

  it("a retry whose comment is gone → failed, nothing sent", async () => {
    const { store, src, sources, cfg } = setup({ threads: { "pc-a1": null } });
    store.addAction({ id: "a1", notBefore: BEFORE, attempts: 1 });
    await runSendTick(store, sources, cfg());
    expect(store.get("a1")).toMatchObject({ status: "failed", lastError: "comment gone" });
    expect(src.calls).toEqual([]);
  });

  it("an auto retry where a human already replied with different text → skipped human-replied, stays planned", async () => {
    const { store, src, sources, cfg } = setup({ threads: { "pc-a1": fakeThread("instagram", "pc-a1", [{ id: "r-1", text: "so glad you liked it" }]) } });
    store.addAction({ id: "a1", notBefore: BEFORE, attempts: 1 });
    const r = await runSendTick(store, sources, cfg());
    expect(r.skipped).toEqual({ "human-replied": 1 });
    expect(src.calls).toEqual([]);
    expect(store.get("a1").status).toBe("planned");
  });

  it("a first-attempt auto reply where the creator replied during the veto window → human-replied, nothing sent (F7 A15)", async () => {
    const { store, src, sources, cfg } = setup({ threads: { "pc-a1": fakeThread("instagram", "pc-a1", [{ id: "r-1", text: "haha thanks" }]) } });
    store.addAction({ id: "a1", notBefore: BEFORE });
    const r = await runSendTick(store, sources, cfg());
    expect(r.skipped).toEqual({ "human-replied": 1 });
    expect(src.calls).toEqual([]);
    expect(store.get("a1").status).toBe("planned");
  });

  it("manual actions always pre-flight the thread, then send", async () => {
    const { store, src, sources, cfg } = setup({ threads: { "pc-a1": fakeThread("instagram", "pc-a1") } });
    store.addAction({ id: "a1", notBefore: BEFORE, origin: "manual", text: "thank you so much" });
    const r = await runSendTick(store, sources, cfg({ settings: DEFAULT_ENGAGEMENT }));
    expect(r.sent).toBe(1);
    expect(src.threadCalls).toEqual(["pc-a1"]);
  });

  it("a permanent error → failed + alert in one attempt", async () => {
    const { store, src, sources, cfg } = setup({ behaviours: { "pc-a1": "permanent" } });
    store.addAction({ id: "a1", notBefore: BEFORE });
    const r = await runSendTick(store, sources, cfg());
    expect(r.failed).toBe(1);
    expect(r.alerts.map((a) => a.kind)).toEqual(["engagement-failure"]);
    expect(store.get("a1")).toMatchObject({ status: "failed", attempts: 1 });
    expect(src.calls).toHaveLength(1);
  });

  it("a rejected error → retried with backoff, then ok → sent", async () => {
    const { store, src, sources, cfg } = setup({ behaviours: { "pc-a1": ["reject", "ok"] }, threads: { "pc-a1": fakeThread("instagram", "pc-a1") } });
    store.addAction({ id: "a1", notBefore: BEFORE });
    const r1 = await runSendTick(store, sources, cfg());
    expect(r1.retried).toBe(1);
    const row = store.get("a1");
    expect(row).toMatchObject({ status: "planned", attempts: 1, lastError: "bad request" });
    expect(Date.parse(row.nextAttemptAt!)).toBe(NOW.getTime() + backoffMs(1, DEFAULT_RETRY_POLICY));
    // Not due yet: nothing happens one minute later.
    expect((await runSendTick(store, sources, cfg({}, new Date(NOW.getTime() + 60_000)))).considered).toBe(0);
    const r2 = await runSendTick(store, sources, cfg({}, new Date(Date.parse(row.nextAttemptAt!))));
    expect(r2.sent).toBe(1);
    expect(src.threadCalls).toEqual(["pc-a1", "pc-a1"]); // thread re-read before the first send and before the retry
    expect(src.calls).toHaveLength(2);
    expect(store.get("a1")).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("'Action Blocked' → kill tripped, killedNow set, remaining actions untouched, alert engagement-kill", async () => {
    const { store, src, sources, cfg } = setup({ behaviours: { "pc-a1": "block" } });
    store.addAction({ id: "a1", notBefore: "2026-11-13T10:00:00Z" });
    store.addAction({ id: "a2", notBefore: BEFORE });
    store.addAction({ id: "a3", notBefore: BEFORE });
    const r = await runSendTick(store, sources, cfg());
    expect(r.killedNow).toBe("platform block/limit signal: Action Block");
    expect(store.killed).toHaveLength(1);
    expect(store.isKilled).toBe(true);
    expect(r.alerts.map((a) => a.kind)).toContain("engagement-kill");
    expect(src.calls.map((c) => c.platformCommentId)).toEqual(["pc-a1"]);
    expect(store.get("a2").status).toBe("planned");
    expect(store.get("a3").status).toBe("planned");
  });

  it("3 consecutive failures trip the kill switch", async () => {
    const { store, sources, cfg } = setup({ behaviours: { "pc-a1": "permanent", "pc-a2": "permanent", "pc-a3": "permanent" } });
    for (const id of ["a1", "a2", "a3", "a4"]) store.addAction({ id, notBefore: BEFORE });
    const r = await runSendTick(store, sources, cfg());
    expect(r.failed).toBe(3);
    expect(r.killedNow).toBe("3 consecutive send failures");
    expect(store.get("a4").status).toBe("planned");
  });

  it("claim lost → no send, not counted", async () => {
    const { store, src, sources, cfg, lines } = setup();
    store.addAction({ id: "a1", notBefore: BEFORE });
    store.loseClaims.add("a1");
    const r = await runSendTick(store, sources, cfg());
    expect(r).toMatchObject({ considered: 1, sent: 0, skipped: {} });
    expect(src.calls).toEqual([]);
    expect(lines.some((l) => l.includes("claim lost"))).toBe(true);
  });

  it("no source capability → no-capability, nothing sent", async () => {
    const { store, src, sources, cfg } = setup({ canHide: false });
    store.addAction({ id: "a1", notBefore: BEFORE, kind: "hide", text: null });
    const r = await runSendTick(store, sources, cfg());
    expect(r.skipped).toEqual({ "no-capability": 1 });
    expect(src.calls).toEqual([]);
  });

  it("hide sends via source.hide", async () => {
    const { store, src, sources, cfg } = setup();
    store.addAction({ id: "a1", notBefore: BEFORE, kind: "hide", text: null });
    const r = await runSendTick(store, sources, cfg());
    expect(r.sent).toBe(1);
    expect(src.calls).toEqual([{ op: "hide", platformCommentId: "pc-a1" }]);
    expect(store.get("a1")).toMatchObject({ status: "sent", platformActionId: null });
  });

  it("redacts token-like strings in last_error", async () => {
    const { store, sources, cfg, lines } = setup({ behaviours: { "pc-a1": "reject" }, rejectMessage: "bad request: https://graph.example/x?access_token=abc&y=1 Authorization: Bearer sk.secret123 key=zzz" });
    store.addAction({ id: "a1", notBefore: BEFORE });
    await runSendTick(store, sources, cfg());
    const err = store.get("a1").lastError!;
    expect(err).toContain("access_token=[redacted]");
    expect(err).toContain("Bearer [redacted]");
    expect(err).toContain("key=[redacted]");
    expect(err).not.toMatch(/abc|sk\.secret123|zzz/);
    expect(lines.join("\n")).not.toMatch(/access_token=abc/);
  });
});
