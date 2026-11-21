import { describe, expect, it } from "vitest";
import { makeItem, NOW } from "../../batches/__tests__/fixtures.js";
import { entryMissed, groupEntries } from "../../calendar/model.js";
import { isMissedSlot, parseWorkerStatus, postingBanner, postingState, sinceText, type PostingStatus } from "../posting.js";

const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const base: PostingStatus = { state: "live", lastTickAt: ago(MIN), missed: 0, oldestMissedAt: null };
const opts = { now: NOW, timeZone: "UTC" } as const;

describe("parseWorkerStatus (defensive)", () => {
  it("keeps the known fields and drops junk", () => {
    expect(parseWorkerStatus({ mode: "live", reason: null, startedAt: ago(MIN), lastTickAt: ago(MIN), missed: 3, dueNow: 1 })).toEqual({ mode: "live", startedAt: ago(MIN), lastTickAt: ago(MIN) });
    expect(parseWorkerStatus({ mode: "turbo", lastTickAt: "not a date" })).toEqual({ mode: null, startedAt: null, lastTickAt: null });
    expect(parseWorkerStatus(JSON.stringify({ mode: "dry-run", lastTickAt: ago(MIN) }))?.mode).toBe("dry-run");
    for (const bad of [null, undefined, 3, "nope", "[]", [], "{"]) expect(parseWorkerStatus(bad)).toBeNull();
  });
});

describe("postingState", () => {
  it("unknown without a row or a usable mode / time", () => {
    expect(postingState(null, NOW).state).toBe("unknown");
    expect(postingState({ mode: null, lastTickAt: ago(MIN), startedAt: null }, NOW).state).toBe("unknown");
    expect(postingState({ mode: "live", lastTickAt: null, startedAt: null }, NOW).state).toBe("unknown");
  });
  it("stale after 5 min, whatever the mode; start time counts before the first tick", () => {
    expect(postingState({ mode: "live", lastTickAt: ago(5 * MIN + 1000), startedAt: null }, NOW)).toEqual({ state: "stale", lastTickAt: ago(5 * MIN + 1000) });
    expect(postingState({ mode: "dry-run", lastTickAt: ago(6 * MIN), startedAt: null }, NOW).state).toBe("stale");
    expect(postingState({ mode: "live", lastTickAt: null, startedAt: ago(MIN) }, NOW).state).toBe("live");
    expect(postingState({ mode: "dry-run", lastTickAt: ago(4 * MIN), startedAt: null }, NOW).state).toBe("dry-run");
  });
});

describe("isMissedSlot (calendar chip)", () => {
  it("approved, not Snapchat, more than an hour late", () => {
    expect(isMissedSlot({ status: "approved", platform: "youtube", scheduledFor: ago(61 * MIN) }, NOW)).toBe(true);
    expect(isMissedSlot({ status: "approved", platform: "youtube", scheduledFor: ago(59 * MIN) }, NOW)).toBe(false);
    expect(isMissedSlot({ status: "approved", platform: "snapchat", scheduledFor: ago(3 * 60 * MIN) }, NOW)).toBe(false);
    for (const status of ["published", "rejected", "draft", "queued", "failed"]) expect(isMissedSlot({ status, platform: "tiktok", scheduledFor: ago(3 * 60 * MIN) }, NOW)).toBe(false);
    expect(isMissedSlot({ status: "approved", platform: "tiktok", scheduledFor: null }, NOW)).toBe(false);
  });
  it("flows into calendar entries", () => {
    const [late, ok] = groupEntries(
      [makeItem({ mediaId: "m1", status: "approved", platform: "tiktok", scheduledFor: ago(2 * 60 * MIN) }), makeItem({ mediaId: "m2", status: "approved", scheduledFor: ago(30 * MIN) })],
      { timeZone: "UTC", now: NOW },
    );
    expect(late!.platforms[0]!.missed).toBe(true);
    expect(entryMissed(late!)).toBe(true);
    expect(entryMissed(ok!)).toBe(false);
  });
});

describe("postingBanner copy", () => {
  it("dry run: warn with the fix", () => {
    expect(postingBanner({ ...base, state: "dry-run" }, { ...opts, surface: "home" })).toEqual({
      notices: [
        {
          tone: "warn",
          text: "Posting is off (dry run). Approved posts won't go out.",
          detail: "Turn it on: set DRY_RUN=false and WORKER_LIVE=1 on the server, then restart the worker.",
        },
      ],
      quiet: null,
    });
  });
  it("stale and unknown: danger", () => {
    const stale = postingBanner({ ...base, state: "stale", lastTickAt: "2026-11-13T09:14:00.000Z" }, { ...opts, surface: "home" });
    expect(stale.notices).toEqual([{ tone: "danger", text: "The worker hasn't checked in since 9:14 AM — nothing is posting." }]);
    expect(postingBanner({ ...base, state: "unknown", lastTickAt: null }, { ...opts, surface: "calendar" }).notices).toEqual([{ tone: "danger", text: "The worker hasn't reported yet." }]);
  });
  it("missed: warn, linked to the oldest missed post's week (creator zone)", () => {
    const v = postingBanner({ ...base, missed: 3, oldestMissedAt: "2026-11-09T23:30:00.000Z" }, { now: NOW, timeZone: "Etc/GMT-2", surface: "home" });
    expect(v.notices).toEqual([{ tone: "warn", text: "3 approved posts missed their time", href: "/calendar?view=week&d=2026-11-10", linkLabel: "Open week", action: { label: "Reschedule all", href: "/calendar?view=week&d=2026-11-10&reschedule=all" } }]);
    expect(postingBanner({ ...base, missed: 1, oldestMissedAt: ago(2 * 60 * MIN) }, { ...opts, surface: "home" }).notices[0]!.text).toBe("1 approved post missed its time");
    expect(postingBanner({ ...base, state: "dry-run", missed: 2, oldestMissedAt: ago(2 * 60 * MIN) }, { ...opts, surface: "home" }).notices.map((n) => n.tone)).toEqual(["warn", "warn"]);
  });
  it("missed, all inside the viewed range: 'marked below', no Open week link", () => {
    const st = { ...base, missed: 2, oldestMissedAt: "2026-11-11T10:00:00.000Z", newestMissedAt: "2026-11-12T10:00:00.000Z" };
    const v = postingBanner(st, { ...opts, surface: "calendar", range: { from: "2026-11-09", to: "2026-11-15" }, rescheduleHref: "/calendar?d=2026-11-13&reschedule=all" });
    expect(v.notices).toEqual([{ tone: "warn", text: "2 missed posts are marked below", action: { label: "Reschedule all", href: "/calendar?d=2026-11-13&reschedule=all" } }]);
    // One missed post outside the range keeps the link to its week.
    const out = postingBanner({ ...st, oldestMissedAt: "2026-11-02T10:00:00.000Z" }, { ...opts, surface: "calendar", range: { from: "2026-11-09", to: "2026-11-15" } });
    expect(out.notices[0]).toMatchObject({ href: "/calendar?view=week&d=2026-11-02", linkLabel: "Open week" });
  });
  it("live and fresh: nothing on Home, a quiet line on Calendar", () => {
    expect(postingBanner(base, { ...opts, surface: "home" })).toEqual({ notices: [], quiet: null });
    expect(postingBanner(base, { ...opts, surface: "calendar" })).toEqual({ notices: [], quiet: "Posting is on" });
  });
  it("since: time today, date + time otherwise, UTC marked on the fallback zone", () => {
    expect(sinceText("2026-11-13T09:14:00Z", NOW, "UTC")).toBe("9:14 AM");
    expect(sinceText("2026-11-12T22:05:00Z", NOW, "UTC")).toBe("Nov 12, 10:05 PM");
    expect(sinceText("2026-11-13T09:14:00Z", NOW, "UTC", true)).toBe("9:14 AM UTC");
  });
});
