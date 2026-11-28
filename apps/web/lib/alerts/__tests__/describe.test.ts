import { describe, expect, it } from "vitest";
import { ALERT_KINDS, type AlertKind } from "@autopilot/core";
import type { AlertView } from "../queries.js";
import { previewTitle } from "../queries.js";
import { describeAlert, handleSummary } from "../view.js";

const NOW = new Date("2099-01-08T18:00:00.000Z");
const TZ = "UTC";
const view = (over: Partial<AlertView> = {}): AlertView => ({
  id: "a0000000-0000-4000-8000-000000000001",
  kind: "duplicate",
  source: "youtube",
  message: "Something happened.",
  createdAt: "2099-01-08T10:00:00.000Z",
  acknowledgedAt: null,
  batchId: "b0000000-0000-4000-8000-000000000001",
  weekStart: "2099-01-05",
  batchItemId: "10000000-0000-4000-8000-000000000001",
  platform: "youtube",
  itemTitle: "Day 10: the long climb",
  scheduledFor: "2099-01-08T08:00:00.000Z", // a Thursday
  commentId: null,
  commentPlatform: null,
  commentText: null,
  draftReply: null,
  ...over,
});
const COMMENT = "c0000000-0000-4000-8000-000000000001";

describe("describeAlert", () => {
  it("describes every alert kind (fails when a new kind has no description)", () => {
    for (const kind of ALERT_KINDS as readonly AlertKind[]) {
      const d = describeAlert(view({ kind }), NOW, TZ);
      expect(d.title.length, kind).toBeGreaterThan(8);
      expect(d.title, kind).not.toMatch(/^(urgent|ready)$/i);
      expect(Array.isArray(d.actions), kind).toBe(true);
    }
  });

  it("duplicate-held (F26 A): names the platform, says why, links the calendar week", () => {
    const d = describeAlert(view({ kind: "duplicate-held", source: "instagram", platform: "instagram", message: "This video was already posted on Instagram on Fri Nov 20" }), NOW, TZ);
    expect(d.title).toBe("A Instagram post was held: this video already went out there");
    expect(d.body).toContain("already posted on Instagram");
    expect(d.why).toMatch(/first copy/);
    expect(d.actions.some((a) => a.kind === "link")).toBe(true);
  });

  it("reply-ready: comment + draft quote, Approve & send and Open in Inbox", () => {
    const d = describeAlert(view({ kind: "reply-ready", source: "instagram", platform: null, batchId: null, batchItemId: null, commentId: COMMENT, commentPlatform: "instagram", commentText: "Love this!", draftReply: "Thank you!" }), NOW, TZ);
    expect(d.title).toBe("Reply drafted for a comment on Instagram");
    expect(d.quote).toEqual({ comment: "Love this!", reply: "Thank you!" });
    expect(d.actions).toEqual([
      { kind: "approve-reply", label: "Approve & send", commentId: COMMENT },
      { kind: "link", label: "Open in Inbox", href: `/inbox/item/${COMMENT}` },
    ]);
  });

  it("reply-ready digest: count from the message, Open Inbox", () => {
    const d = describeAlert(view({ kind: "reply-ready", message: "3 replies drafted, 1 flagged", source: "all", commentId: null, batchId: null, batchItemId: null }), NOW, TZ);
    expect(d.title).toBe("3 replies are drafted and waiting");
    expect(d.quote).toBeUndefined();
    expect(d.actions).toEqual([{ kind: "link", label: "Open Inbox", href: "/inbox" }]);
  });

  it("missed-slot: 12-hour due time, why, reschedule with the proposed slot", () => {
    const d = describeAlert(view({ kind: "missed-slot" }), NOW, TZ, { proposedAt: "2099-01-09T09:30:00.000Z" });
    expect(d.title).toBe("A YouTube post missed its time");
    expect(d.body).toBe("Day 10: the long climb was due Thu 8:00 AM");
    expect(d.why).toBe("Held so late posts don't go out in a burst.");
    expect(d.actions[0]).toEqual({
      kind: "reschedule",
      label: "Auto-schedule at nearest slot (Fri 9:30 AM)",
      itemId: "10000000-0000-4000-8000-000000000001",
      returnTo: "/notifications",
    });
    expect(d.actions[1]).toMatchObject({ kind: "link", label: "Open in calendar" });
  });

  it("missed-slot without a free slot offers only the calendar", () => {
    const d = describeAlert(view({ kind: "missed-slot" }), NOW, TZ);
    expect(d.actions.map((a) => a.kind)).toEqual(["link"]);
  });

  it("ready-for-approval: Approve + calendar", () => {
    const d = describeAlert(view({ kind: "ready-for-approval" }), NOW, TZ);
    expect(d.actions[0]).toEqual({ kind: "approve-item", label: "Approve", item: "b0000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001" });
    expect(d.actions[1]).toMatchObject({ kind: "link", label: "Open in calendar" });
  });

  it("failure kinds open the calendar", () => {
    for (const kind of ["final-failure", "unknown-outcome"] as const) {
      const d = describeAlert(view({ kind }), NOW, TZ);
      expect(d.title).toContain("YouTube");
      expect(d.actions).toEqual([{ kind: "link", label: "Open in calendar", href: "/calendar?view=week&d=2099-01-05" }]);
    }
  });

  it("token-health names the connection and the runbook", () => {
    const d = describeAlert(view({ kind: "token-health", source: "meta", batchId: null, batchItemId: null }), NOW, TZ);
    expect(d.title).toContain("Meta");
    expect(d.why).toContain("token-renewal");
  });

  it("hides the source 'all' and never says Urgent", () => {
    for (const kind of ALERT_KINDS as readonly AlertKind[]) {
      const d = describeAlert(view({ kind, source: "all", platform: null }), NOW, TZ);
      expect(JSON.stringify(d), kind).not.toMatch(/All platforms|Urgent/);
    }
  });

  it("title preview is capped at 80 chars (first caption line only)", () => {
    const t = previewTitle(null, `${"x".repeat(200)}\nsecond line`)!;
    expect(t.length).toBe(80);
    expect(previewTitle("  ", "line one\nline two")).toBe("line one");
    expect(previewTitle(null, null)).toBeNull();
  });

  it("header summary", () => {
    expect(handleSummary({})).toBe("Nothing needs you right now.");
    expect(handleSummary({ "reply-ready": 2, "missed-slot": 1 })).toBe("3 to handle: 2 reply ready, 1 missed post");
  });
});
