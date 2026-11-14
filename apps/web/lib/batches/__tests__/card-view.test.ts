import { describe, expect, it } from "vitest";
import {
  approvalProgress,
  autoCheckText,
  batchStatusBadge,
  canConfirmReset,
  cardWarnings,
  countsMeta,
  handoffText,
  isoWeek,
  itemStatusBadge,
  keyTailLabel,
  needsYouCount,
  PAST_TIME_TEXT,
  pastTimeChip,
  stuckActions,
  weekIndex,
} from "../card-view.js";
import { RESET_CHECKLIST } from "../reset.js";
import { countByStatus, ITEM_STATUSES, type ItemStatus } from "../types.js";
import { scheduledLabel } from "../view-model.js";

const counts = (s: ItemStatus[]) => countByStatus(s.map((status) => ({ status })));

describe("canConfirmReset", () => {
  const ig = [...RESET_CHECKLIST.instagram];
  it("IG: needs every box and a finished, non-hit automatic check", () => {
    expect(canConfirmReset({ platform: "instagram", checked: [], check: "not-found" })).toBe(false);
    expect(canConfirmReset({ platform: "instagram", checked: ig.slice(0, 2), check: "not-found" })).toBe(false);
    expect(canConfirmReset({ platform: "instagram", checked: ig, check: "checking" })).toBe(false);
    expect(canConfirmReset({ platform: "instagram", checked: ig, check: "found" })).toBe(false);
    expect(canConfirmReset({ platform: "instagram", checked: ig, check: "not-found" })).toBe(true);
    expect(canConfirmReset({ platform: "instagram", checked: ig, check: "error" })).toBe(true);
  });
  it("YouTube: the boxes decide; Snapchat never", () => {
    const yt = [...RESET_CHECKLIST.youtube];
    expect(canConfirmReset({ platform: "youtube", checked: yt.slice(0, 1), check: "n/a" })).toBe(false);
    expect(canConfirmReset({ platform: "youtube", checked: yt, check: "n/a" })).toBe(true);
    expect(canConfirmReset({ platform: "snapchat", checked: yt, check: "n/a" })).toBe(false);
  });
});

describe("stuckActions", () => {
  it("record is on every failed/unknown item except Snapchat, even with a post id (canReset false)", () => {
    expect(stuckActions({ status: "failed", platform: "instagram", canReset: true })).toEqual({ reset: true, record: true, handoffNote: false });
    expect(stuckActions({ status: "unknown", platform: "youtube", canReset: false })).toEqual({ reset: false, record: true, handoffNote: false });
    expect(stuckActions({ status: "failed", platform: "tiktok" })).toEqual({ reset: false, record: true, handoffNote: false });
  });
  it("Snapchat: no buttons, the handoff note instead", () => {
    expect(stuckActions({ status: "failed", platform: "snapchat", canReset: true })).toEqual({ reset: false, record: false, handoffNote: true });
  });
  it("nothing for other statuses", () => {
    for (const s of ["draft", "approved", "queued", "publishing", "published", "rejected"] as const) {
      expect(stuckActions({ status: s, platform: "instagram", canReset: true })).toEqual({ reset: false, record: false, handoffNote: false });
    }
  });
});

describe("pastTimeChip", () => {
  const now = new Date("2026-11-16T12:00:00.000Z");
  it("a draft whose time has passed gets the warn chip", () => {
    expect(pastTimeChip({ status: "draft", scheduledFor: "2026-11-16T09:00:00.000Z" }, now)).toBe(PAST_TIME_TEXT);
    expect(PAST_TIME_TEXT).toBe("Past time: pick a new time before approving");
  });
  it("future, untimed, invalid or non-draft → null", () => {
    expect(pastTimeChip({ status: "draft", scheduledFor: "2026-11-17T09:00:00.000Z" }, now)).toBeNull();
    expect(pastTimeChip({ status: "draft", scheduledFor: null }, now)).toBeNull();
    expect(pastTimeChip({ status: "draft", scheduledFor: "nope" }, now)).toBeNull();
    expect(pastTimeChip({ status: "approved", scheduledFor: "2026-11-16T09:00:00.000Z" }, now)).toBeNull();
    expect(pastTimeChip({ status: "failed", scheduledFor: "2026-11-16T09:00:00.000Z" }, now)).toBeNull();
  });
  it("the chip replaces the duplicate time.past warning line, nothing else", () => {
    const ws = [{ code: "time.past" }, { code: "caption.empty" }];
    expect(cardWarnings(ws, true)).toEqual([{ code: "caption.empty" }]);
    expect(cardWarnings(ws, false)).toEqual(ws);
  });
});

describe("badges", () => {
  it("approved batch → accent, draft → neutral", () => {
    expect(batchStatusBadge("approved")).toEqual({ tone: "accent", label: "Approved" });
    expect(batchStatusBadge("draft").tone).toBe("neutral");
  });
  it("every item status has a badge; failed = danger, unknown = warn", () => {
    for (const s of ITEM_STATUSES) expect(itemStatusBadge(s).label.length).toBeGreaterThan(0);
    expect(itemStatusBadge("failed").tone).toBe("danger");
    expect(itemStatusBadge("unknown").tone).toBe("warn");
  });
});

describe("counts", () => {
  it("meta lists the live total then non-zero buckets", () => {
    const c = counts(["draft", "draft", "approved", "queued", "failed", "unknown", "rejected"]);
    expect(countsMeta(c)).toBe("6 posts · 2 draft · 2 approved · 2 need you · 1 rejected");
    expect(countsMeta(counts([]))).toBe("0 posts");
    expect(needsYouCount(c)).toBe(2);
  });
});

describe("isoWeek", () => {
  it("numbers weeks per ISO-8601", () => {
    expect(isoWeek("2026-11-16")).toBe(47);
    expect(isoWeek("2026-01-01")).toBe(1); // Thursday
    expect(isoWeek("2021-01-03")).toBe(53); // Sunday of 2020-W53
    expect(isoWeek("2099-01-05")).toBe(2);
    expect(weekIndex("2027-01-04")).toBe("W01");
    expect(isoWeek("nope")).toBe(0);
  });
});

describe("handoffText", () => {
  it("failed/unknown get the F11 panel, never 'scheduled on the platform'", () => {
    expect(handoffText({ status: "failed", handedOff: true }, false)).toBeNull();
    expect(handoffText({ status: "unknown", handedOff: true }, false)).toBeNull();
  });
  it("other handed-off statuses keep the old line; published with a link shows the link instead", () => {
    expect(handoffText({ status: "publishing", handedOff: true }, false)).toMatch(/scheduled on the platform/);
    expect(handoffText({ status: "published", handedOff: true }, true)).toBeNull();
    expect(handoffText({ status: "draft", handedOff: false }, false)).toBeNull();
  });
});

describe("sheet text", () => {
  it("auto-check wording", () => {
    expect(autoCheckText("not-found")).toEqual({ tone: "neutral", text: "Automatic check: not found in the last 25 posts" });
    expect(autoCheckText("error")).toEqual({ tone: "warn", text: "Automatic check failed: check by hand" });
    expect(autoCheckText("found")?.tone).toBe("accent");
    expect(autoCheckText("n/a")).toBeNull();
  });
  it("key tail", () => {
    expect(keyTailLabel("abc123")).toBe("key …abc123");
    expect(keyTailLabel(null)).toBe("key not available");
  });
  it("scheduled label in the creator's zone", () => {
    expect(scheduledLabel("2026-11-17T09:00:00.000Z", "UTC")).toBe("Tue 17 Nov · 09:00");
    expect(scheduledLabel(null, "UTC")).toBe("no time");
  });
});

describe("approvalProgress", () => {
  it("counts approved-or-later out of the live total", () => {
    expect(approvalProgress(counts(["draft", "approved", "queued", "published", "failed", "rejected"]))).toEqual({ done: 3, total: 5 });
  });
});
