import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AlertView } from "../../../lib/alerts/queries.js";
import { alertCalendarHref } from "../../../lib/alerts/view.js";

// The row posts to a server action; the markup test only needs a function reference.
vi.mock("../../../app/alerts/actions.js", () => ({ acknowledgeAction: async () => {} }));
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

  it("an unlinked acknowledged alert has no actions", () => {
    const html = renderToStaticMarkup(h(AlertRow, { alert: alert({ batchId: null, weekStart: null, acknowledgedAt: "2099-01-06T11:00:00.000Z" }), when: "2 h ago" }));
    expect(html).not.toContain("Open in calendar");
    expect(html).not.toContain("Acknowledge</button>");
  });
});
