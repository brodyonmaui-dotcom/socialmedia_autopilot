// No silent holds: a creator-approved (manual) reply the send tick holds gets its reason on the row, one
// engagement-failure alert per (platform, reason) per day, one log line per new reason; it stays planned and
// goes out exactly once when the cause is gone.
import { describe, expect, it } from "vitest";
import { runSendTick, threadErrorClass } from "../send.js";
import { DEFAULT_ENGAGEMENT } from "../settings.js";
import { MemoryEngagementStore } from "../testing/fake-store.js";
import { FakeCommentSource } from "../testing/fake-source.js";
import type { CommentSource, EngagementPlatform, SendTickConfig } from "../types.js";
import { KILL_PATTERN } from "../kill.js";

const NOW = new Date("2026-11-25T12:00:00Z");
const LATER = new Date("2026-11-25T12:05:00Z");
const NEXT_DAY = new Date("2026-11-26T12:30:00Z");
const BEFORE = "2026-11-25T11:00:00Z";
const SHADOW = DEFAULT_ENGAGEMENT; // modes shadow/shadow/off: manual rows skip the mode check

function setup(platform: EngagementPlatform = "youtube", src?: CommentSource) {
  const store = new MemoryEngagementStore();
  const source = src ?? new FakeCommentSource(platform, { missingThread: "empty" });
  const sources = new Map<EngagementPlatform, CommentSource>([[platform, source]]);
  const lines: string[] = [];
  const cfg = (over: Partial<SendTickConfig> = {}, at: Date = NOW): SendTickConfig => ({
    settings: SHADOW, dryRun: false, killEnv: false, now: () => at, log: (l) => lines.push(l), timeoutMs: 20, ...over,
  });
  return { store, sources, source, cfg, lines };
}
const manual = (store: MemoryEngagementStore, platform: EngagementPlatform, id = "m1") =>
  store.addAction({ id, platform, origin: "manual", notBefore: BEFORE, text: "👍", platformCommentId: `pc-${id}` });

describe("send tick: held manual replies are never silent", () => {
  it("no-capability (YouTube replies off): reason on the row, one alert, one log line; sends once fixed", async () => {
    const yt = new FakeCommentSource("youtube", { missingThread: "empty", canReply: false });
    yt.replyUnavailableReason = "YouTube replies are switched off on the server (YT_COMMENT_REPLIES=1 needed)";
    const { store, sources, cfg, lines } = setup("youtube", yt);
    manual(store, "youtube");
    manual(store, "youtube", "m2");
    const r = await runSendTick(store, sources, cfg());
    expect(r.skipped).toEqual({ "no-capability": 2 });
    expect(store.get("m1")).toMatchObject({ status: "planned", lastError: yt.replyUnavailableReason, attempts: 0 });
    expect(r.held).toEqual([
      { platform: "youtube", actionId: "m1", origin: "manual", reason: yt.replyUnavailableReason, transient: false },
      { platform: "youtube", actionId: "m2", origin: "manual", reason: yt.replyUnavailableReason, transient: false },
    ]);
    expect(store.alerts).toEqual([{ kind: "engagement-failure", platform: "youtube", actionId: null, message: `YouTube reply waiting: ${yt.replyUnavailableReason}`, at: NOW.toISOString() }]);
    expect(lines.filter((l) => l.includes("waiting youtube"))).toHaveLength(2); // one per row, first time

    // Next tick, same reason: no new log line, no new alert.
    await runSendTick(store, sources, cfg({}, LATER));
    expect(lines.filter((l) => l.includes("waiting youtube"))).toHaveLength(2);
    expect(store.alerts).toHaveLength(1);

    // Next day, still held: one fresh alert for the day.
    await runSendTick(store, sources, cfg({}, NEXT_DAY));
    expect(store.alerts).toHaveLength(2);

    // Fixed (YT_COMMENT_REPLIES=1): each row goes out exactly once.
    const fixed = new FakeCommentSource("youtube", { missingThread: "empty" });
    sources.set("youtube", fixed);
    const ok = await runSendTick(store, sources, cfg({}, NEXT_DAY));
    expect(ok.sent).toBe(2);
    await runSendTick(store, sources, cfg({}, NEXT_DAY));
    expect(fixed.calls.map((c) => c.platformCommentId)).toEqual(["pc-m1", "pc-m2"]);
    expect(store.get("m1").status).toBe("sent");
  });

  it("no source at all: plain 'not connected' reason", async () => {
    const { store, cfg } = setup();
    manual(store, "tiktok");
    const r = await runSendTick(store, new Map(), cfg());
    expect(r.held[0]?.reason).toBe("TikTok isn't connected on the server");
    expect(store.get("m1")).toMatchObject({ status: "planned", lastError: "TikTok isn't connected on the server" });
    expect(store.alerts).toHaveLength(1);
  });

  it("dry run and kill switch: reason + alert, status untouched, nothing sent", async () => {
    const { store, sources, source, cfg } = setup();
    manual(store, "youtube");
    await runSendTick(store, sources, cfg({ dryRun: true }));
    expect(store.get("m1")).toMatchObject({ status: "planned", lastError: expect.stringMatching(/^Worker is in dry run/) });
    await runSendTick(store, sources, cfg({ killEnv: true }, LATER));
    expect(store.get("m1")).toMatchObject({ status: "planned", lastError: "Replies are paused (kill switch is on)" });
    expect(store.alerts.map((a) => a.message)).toEqual([
      "YouTube reply waiting: Worker is in dry run (it sends only with DRY_RUN=false and the live start)",
      "YouTube reply waiting: Replies are paused (kill switch is on)",
    ]);
    expect((source as FakeCommentSource).calls).toEqual([]);
    const ok = await runSendTick(store, sources, cfg({}, LATER));
    expect(ok.sent).toBe(1);
  });

  it("a throwing thread check holds with its error class, alerts once, then sends once it reads", async () => {
    const src = new FakeCommentSource("tiktok", { missingThread: "empty" });
    let broken = true;
    const orig = src.fetchThread.bind(src);
    src.fetchThread = async (id: string) => {
      if (broken) throw new Error("tiktok (zernio) comments.get failed: HTTP 404 not_found Post 7311111111111111111 not found");
      return orig(id);
    };
    const { store, sources, cfg } = setup("tiktok", src);
    manual(store, "tiktok");
    await runSendTick(store, sources, cfg());
    await runSendTick(store, sources, cfg({}, LATER));
    expect(store.get("m1")).toMatchObject({ status: "planned", lastError: "TikTok thread couldn't be read: HTTP 404" });
    expect(store.alerts).toHaveLength(1);
    broken = false;
    const r = await runSendTick(store, sources, cfg({}, LATER));
    expect(r.sent).toBe(1);
    await runSendTick(store, sources, cfg({}, LATER));
    expect(src.calls).toHaveLength(1);
  });

  it("transient holds (limits) only set the reason text: no alert", async () => {
    const { store, sources, cfg } = setup();
    manual(store, "youtube");
    const tight = { ...SHADOW, limits: { ...SHADOW.limits, perPlatformPerHour: 0 } };
    const r = await runSendTick(store, sources, cfg({ settings: tight }));
    expect(r.held[0]).toMatchObject({ transient: true });
    expect(store.get("m1").lastError).toMatch(/^Waiting for the reply cap/);
    expect(store.alerts).toEqual([]);
  });

  it("auto rows keep the old behaviour (no reason written, no alert)", async () => {
    const { store, sources, cfg } = setup();
    store.addAction({ id: "a1", platform: "youtube", origin: "auto", notBefore: BEFORE });
    const r = await runSendTick(store, sources, cfg({ dryRun: true }));
    expect(r.held).toEqual([]);
    expect(store.get("a1").lastError).toBeNull();
    expect(store.alerts).toEqual([]);
  });

  it("held reasons never look like a platform block (they can't trip the kill switch)", () => {
    for (const t of ["Worker is in dry run (it sends only with DRY_RUN=false and the live start)", "Replies are paused (kill switch is on)", "Waiting for the reply cap to free up (youtube 10/10 per hour)"]) {
      expect(KILL_PATTERN.test(t)).toBe(false);
    }
  });

  it("threadErrorClass: short and stable", () => {
    expect(threadErrorClass(new Error("tiktok (zernio) comments.get failed: HTTP 400 PLATFORM_LIMITATION Business app only"))).toMatch(/^PLATFORM_LIMITATION/);
    expect(threadErrorClass(new Error("tiktok (zernio) comments.get failed: HTTP 404 Not found"))).toBe("HTTP 404");
    expect(threadErrorClass(new Error("x failed: HTTP 401 invalid_credentials"))).toBe("HTTP 401");
    expect(threadErrorClass(new Error("fetch failed"))).toBe("network error");
  });
});
