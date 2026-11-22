import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { liveRows } from "../live.js";
import type { InboxGroup } from "../../inbox/groups.js";

vi.mock("../../../app/alerts/actions.js", () => ({ acknowledgeAction: async () => {} }));
vi.mock("../../../components/ui/theme-server.js", () => ({ getTheme: async () => "light" }));
const { NotificationsPopover } = await import("../../../components/ui/NotificationsPopover.js");

const g = (over: Partial<InboxGroup> = {}): InboxGroup => ({
  platform: "instagram", drafted: 0, needsYou: 0, dmsOpen: 0, newest: null, newestDm: null, ...over,
});
const item = (id: string, handle: string | null, text: string, at = "2099-01-01T10:00:00.000Z") => ({ id, authorHandle: handle, text, at });

describe("liveRows", () => {
  it("one row for many drafted replies, linking the Inbox filtered to that platform", () => {
    const rows = liveRows([g({ drafted: 7, newest: item("c1", "fan", "nice abs") })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "7 replies drafted to your Instagram comments", href: "/inbox?filter=drafted&platform=instagram", action: "Review replies" });
  });

  it("needs-you count is its own row; drafted and needs-you stay separate", () => {
    const rows = liveRows([g({ drafted: 2, needsYou: 3, newest: item("c1", "fan", "x") })]);
    expect(rows.map((r) => r.title).sort()).toEqual(["2 replies drafted to your Instagram comments", "3 Instagram comments need you"]);
    expect(rows.find((r) => r.id.startsWith("needs"))!.href).toBe("/inbox?filter=needs-you&platform=instagram");
  });

  it("a single comment shows the comment and opens the item", () => {
    const rows = liveRows([g({ needsYou: 1, newest: item("c9", "gym_fan", "nice abs") })]);
    expect(rows).toEqual([expect.objectContaining({ title: "Comment from @gym_fan: “nice abs”", href: "/inbox/item/c9" })]);
  });

  it("DMs link /inbox/dms", () => {
    expect(liveRows([g({ dmsOpen: 1, newestDm: item("t1", "pal", "hi") })])[0]).toMatchObject({ title: "DM from @pal", href: "/inbox/dms" });
    expect(liveRows([g({ dmsOpen: 3 })])[0]!.title).toBe("3 Instagram DMs waiting");
  });

  it("nothing open → no rows; newest row first across platforms", () => {
    expect(liveRows([])).toEqual([]);
    const rows = liveRows([
      g({ drafted: 2, newest: item("a", "x", "t", "2099-01-01T10:00:00.000Z") }),
      g({ platform: "youtube", drafted: 3, newest: item("b", "y", "t", "2099-01-02T10:00:00.000Z") }),
    ]);
    expect(rows.map((r) => r.platform)).toEqual(["youtube", "instagram"]);
  });
});

describe("pop-over rows", () => {
  it("the bell badge is the row count (live groups + events)", () => {
    const html = renderToStaticMarkup(
      h(NotificationsPopover, {
        items: [
          { id: "drafted-instagram", kind: "Instagram", message: "7 replies drafted to your Instagram comments", age: "2 days ago", urgent: false, href: "/inbox?filter=drafted&platform=instagram", action: "Review replies", ackable: false },
          { id: "ev1", kind: "Failed", message: "An Instagram post failed to send", age: "5 min ago", urgent: true, href: "/calendar", action: "Open in calendar", ackable: true },
        ],
        openCount: 2,
        ackAction: async () => {},
      }),
    );
    // Closed pop-over renders only the trigger: the badge counts rows.
    expect(html).toContain('aria-label="Notifications, 2 open"');
  });
});
