import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AlertView } from "../../../lib/alerts/queries.js";
import { alertCalendarHref } from "../../../lib/alerts/view.js";

// The row posts to a server action; the markup test only needs a function reference.
vi.mock("../../../app/alerts/actions.js", () => ({ acknowledgeAction: async () => {} }));
vi.mock("../../../app/calendar/actions.js", () => ({ approveItemsAction: async () => {}, rescheduleMissedAction: async () => {} }));
vi.mock("../../../app/inbox/actions.js", () => ({ approveAndSendAction: async () => {} }));
const { AlertRow } = await import("../AlertRow.js");

const BATCH = "b0000000-0000-4000-8000-000000000001";
const alert = (over: Partial<AlertView> = {}): AlertView => ({
  id: "a0000000-0000-4000-8000-000000000001",
  kind: "duplicate",
  source: "instagram",
  message: "Already posted once.",
  createdAt: "2099-01-06T10:00:00.000Z",
  acknowledgedAt: null,
  batchId: BATCH,
  weekStart: "2099-01-05",
  batchItemId: "10000000-0000-4000-8000-000000000001",
  platform: "instagram",
  itemTitle: "Day 3",
  scheduledFor: "2099-01-06T09:00:00.000Z",
  commentId: null,
  commentPlatform: null,
  commentText: null,
  draftReply: null,
  ...over,
});

describe("alerts: Open in calendar", () => {
  it("alertCalendarHref goes straight to the batch's week, not via /batches/<id>", () => {
    expect(alertCalendarHref(alert())).toBe("/calendar?view=week&d=2099-01-05");
    expect(alertCalendarHref(alert({ weekStart: null }))).toBe("/calendar");
    expect(alertCalendarHref(alert({ batchId: null, weekStart: null, batchItemId: null }))).toBeNull();
  });

  it("the row links to the week view", () => {
    const html = renderToStaticMarkup(h(AlertRow, { alert: alert(), when: "2 h ago" }));
    expect(html).toContain('href="/calendar?view=week&amp;d=2099-01-05"');
    expect(html).toContain("Open in calendar");
    expect(html).not.toContain("/batches/");
  });

  it("a reply-ready row shows the comment, the draft and both actions; no 'Urgent' word", () => {
    const c = "c0000000-0000-4000-8000-000000000001";
    const html = renderToStaticMarkup(h(AlertRow, { alert: alert({ kind: "reply-ready", batchId: null, batchItemId: null, weekStart: null, commentId: c, commentPlatform: "instagram", commentText: "Love it", draftReply: "Thanks!" }), when: "1 h ago" }));
    expect(html).toContain("Reply drafted for a comment on Instagram");
    expect(html).toContain("Love it");
    expect(html).toContain("Thanks!");
    expect(html).toContain("Approve &amp; send");
    expect(html).toContain(`href="/inbox/item/${c}"`);
    expect(html).not.toContain("Urgent");
  });

  it("a missed-slot row offers the proposed slot", () => {
    const html = renderToStaticMarkup(h(AlertRow, { alert: alert({ kind: "missed-slot", platform: "youtube", source: "youtube" }), when: "1 h ago", proposedAt: "2099-01-07T09:30:00.000Z" }));
    expect(html).toContain("Auto-schedule at nearest slot (Wed 9:30 AM)");
    expect(html).toContain("was due Tue 9:00 AM");
  });

  it("an unlinked acknowledged alert has no actions", () => {
    const html = renderToStaticMarkup(h(AlertRow, { alert: alert({ batchId: null, weekStart: null, acknowledgedAt: "2099-01-06T11:00:00.000Z" }), when: "2 h ago" }));
    expect(html).not.toContain("Open in calendar");
    expect(html).not.toContain("Acknowledge</button>");
  });
});
