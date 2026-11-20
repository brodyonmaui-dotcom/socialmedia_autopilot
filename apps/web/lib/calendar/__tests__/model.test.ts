import { DEFAULT_CADENCE } from "@autopilot/core";
import { describe, expect, it } from "vitest";
import { makeBatch, makeItem, NOW } from "../../batches/__tests__/fixtures.js";
import type { WarningContext } from "../../batches/warnings.js";
import {
  approveAllView,
  batchRedirect,
  cardChip,
  linksFromHome,
  lineState,
  calendarHref,
  dayEntries,
  dayTitle,
  groupEntries,
  monthMatrix,
  parseCalendarState,
  rollUp,
  rollUpBadge,
  safeBack,
  stepAnchor,
  viewRange,
  weekCells,
  weekTitle,
  withResult,
} from "../model.js";
import { approveNote, planApproveSome, planMove } from "../plan.js";

const UTC = { timeZone: "UTC", now: NOW };

describe("grouping into entries", () => {
  it("one clip on three platforms on one day → one entry, platforms in order", () => {
    const items = [
      makeItem({ mediaId: "m1", platform: "youtube", title: "Leg day basics", scheduledFor: "2026-11-18T18:00:00Z" }),
      makeItem({ mediaId: "m1", platform: "instagram", scheduledFor: "2026-11-18T17:00:00Z" }),
      makeItem({ mediaId: "m1", platform: "tiktok", scheduledFor: "2026-11-18T19:00:00Z", status: "approved" }),
    ];
    const e = groupEntries(items, UTC);
    expect(e).toHaveLength(1);
    expect(e[0]!.platforms.map((p) => p.platform)).toEqual(["instagram", "youtube", "tiktok"]);
    expect(e[0]).toMatchObject({ day: "2026-11-18", title: "Leg day basics", firstTime: "17:00", status: "needs-you", statusLabel: "2 of 3 need approval", needsYou: true });
  });

  it("the same clip on two days → two entries; untimed drafts get day null", () => {
    const e = groupEntries(
      [
        makeItem({ mediaId: "m1", scheduledFor: "2026-11-18T17:00:00Z" }),
        makeItem({ mediaId: "m1", platform: "youtube", title: "T", scheduledFor: "2026-11-19T17:00:00Z" }),
        makeItem({ mediaId: "m2", scheduledFor: null }),
      ],
      UTC,
    );
    expect(e.map((x) => x.day)).toEqual(["2026-11-18", "2026-11-19", null]);
  });

  it("days are creator-local: 23:30 UTC is the next day two hours east", () => {
    const e = groupEntries([makeItem({ scheduledFor: "2026-11-18T23:30:00Z" })], { timeZone: "Etc/GMT-2", now: NOW });
    expect(e[0]).toMatchObject({ day: "2026-11-19", firstTime: "01:30" });
  });

  it("title: YouTube title, else caption first line, else media label", () => {
    expect(groupEntries([makeItem({ media: { label: "leg-day" }, caption: "" })], UTC)[0]!.title).toBe("leg-day");
    expect(groupEntries([makeItem({ media: { label: "" }, caption: "\n  First line\nsecond" })], UTC)[0]!.title).toBe("First line");
  });

  it("rejected items are hidden unless Show rejected is on", () => {
    const items = [makeItem({ status: "rejected" })];
    expect(groupEntries(items, UTC)).toEqual([]);
    expect(groupEntries(items, { ...UTC, showRejected: true })[0]!.statusLabel).toBe("Rejected");
  });

  it("can-flags: block warnings and past times can't be approved; failed items can be reset/recorded, Snapchat only by hand", () => {
    const [blocked] = groupEntries([makeItem({ warnings: [{ code: "caption.missing", severity: "block", message: "needs a caption" }] })], UTC);
    expect(blocked!.platforms[0]!.canApprove).toBe(false);
    const [past] = groupEntries([makeItem({ scheduledFor: "2026-11-10T10:00:00Z" })], UTC);
    expect(past!.platforms[0]!.canApprove).toBe(false);
    const [ok] = groupEntries([makeItem()], UTC);
    expect(ok!.platforms[0]!.canApprove).toBe(true);
    const [failed] = groupEntries([makeItem({ status: "failed", canReset: true })], UTC);
    expect(failed!.platforms[0]).toMatchObject({ canReset: true, canRecord: true, statusLabel: "Failed", tone: "danger" });
    const [snap] = groupEntries([makeItem({ platform: "snapchat", status: "approved", scheduledFor: "2026-11-13T09:00:00Z" })], UTC);
    expect(snap).toMatchObject({ statusLabel: "Share by hand" });
    expect(snap!.platforms[0]!.canRecord).toBe(false);
  });
});

describe("roll-up precedence", () => {
  it("needs-you > failed/unknown > approved > published > rejected", () => {
    expect(rollUp(["published", "approved", "draft"])).toBe("needs-you");
    expect(rollUp(["published", "unknown", "approved"])).toBe("attention");
    expect(rollUp(["published", "queued"])).toBe("approved");
    expect(rollUp(["published", "rejected"])).toBe("published");
    expect(rollUp(["rejected"])).toBe("rejected");
    expect(rollUpBadge(["unknown", "failed"])).toEqual({ label: "Failed", tone: "danger" });
    expect(rollUpBadge(["unknown"])).toEqual({ label: "Check it", tone: "warn" });
    expect(rollUpBadge(["approved", "publishing"]).label).toBe("Posting");
  });
  it("?status=draft puts drafts first in the Day Dialog", () => {
    const e = groupEntries([makeItem({ mediaId: "a", status: "approved", scheduledFor: "2026-11-18T08:00:00Z" }), makeItem({ mediaId: "b", scheduledFor: "2026-11-18T20:00:00Z" })], UTC);
    expect(dayEntries(e, "2026-11-18").map((x) => x.mediaId)).toEqual(["a", "b"]);
    expect(dayEntries(e, "2026-11-18", true).map((x) => x.mediaId)).toEqual(["b", "a"]);
  });
});

describe("month and week matrices", () => {
  it("weeks start Monday and include the neighbouring months' days", () => {
    const m = monthMatrix("2026-11-18", "2026-11-18");
    expect(m[0]![0]!.day).toBe("2026-10-26");
    expect(m[0]![0]!.inMonth).toBe(false);
    expect(m[0]![6]!.day).toBe("2026-11-01");
    expect(m.at(-1)!.at(-1)!.day).toBe("2026-12-06");
    expect(m.every((w) => w.length === 7)).toBe(true);
    expect(m.flat().filter((c) => c.isToday).map((c) => c.day)).toEqual(["2026-11-18"]);
  });
  it("crosses a year boundary and a DST change without skipping or repeating a day", () => {
    const dec = monthMatrix("2026-12-05", "2026-12-05").flat().map((c) => c.day);
    expect(dec.at(-1)).toBe("2027-01-03");
    // November 2026 holds a DST change in some zones; the grid is calendar dates, so 35 distinct, consecutive days.
    const nov = monthMatrix("2026-11-01", "2026-11-01").flat().map((c) => c.day);
    expect(new Set(nov).size).toBe(nov.length);
    for (let i = 1; i < nov.length; i++) expect(Date.parse(`${nov[i]}T00:00:00Z`) - Date.parse(`${nov[i - 1]}T00:00:00Z`)).toBe(86_400_000);
    // An evening post on the DST-change day lands on its local day.
    const [e] = groupEntries([makeItem({ scheduledFor: "2026-11-01T23:30:00Z" })], { timeZone: "America/New_York", now: new Date("2026-10-01T00:00:00Z") });
    expect(e).toMatchObject({ day: "2026-11-01", firstTime: "18:30" });
  });
  it("cells count posts, dots per platform and flag days needing him", () => {
    const e = groupEntries(
      [makeItem({ mediaId: "a", scheduledFor: "2026-11-18T08:00:00Z" }), makeItem({ mediaId: "a", platform: "youtube", title: "x", scheduledFor: "2026-11-18T09:00:00Z" }), makeItem({ mediaId: "b", status: "approved", scheduledFor: "2026-11-19T09:00:00Z" })],
      UTC,
    );
    const w = weekCells("2026-11-18", "2026-11-18", e);
    expect(w.map((c) => c.day)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(w[2]).toMatchObject({ count: 2, dots: ["instagram", "youtube"], needsYou: true, hasDrafts: true });
    expect(w[3]).toMatchObject({ count: 1, needsYou: false });
  });
  it("view ranges and stepping", () => {
    expect(viewRange("week", "2026-11-18")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(viewRange("month", "2026-11-18")).toEqual({ from: "2026-10-26", to: "2026-12-06" });
    expect(stepAnchor("month", "2026-12-18", 1)).toBe("2027-01-01");
    expect(stepAnchor("week", "2026-11-18", -1)).toBe("2026-11-09");
  });
  it("labels are dates", () => {
    expect(weekTitle("2026-11-18")).toBe("Nov 16 – 22");
    expect(weekTitle("2026-12-02")).toBe("Nov 30 – Dec 6");
    expect(dayTitle("2026-11-18")).toBe("Wednesday, November 18");
  });
});

describe("URL state and redirects", () => {
  it("parses and rebuilds linkable state; invalid values fall back", () => {
    const s = parseCalendarState({ view: "week", d: "2026-11-18", day: "2026-02-30", status: "draft", edit: "nope" }, "2026-11-16");
    expect(s).toMatchObject({ view: "week", d: "2026-11-18", day: null, drafts: true, edit: null });
    expect(calendarHref(s, { day: "2026-11-19" })).toBe("/calendar?view=week&d=2026-11-18&status=draft&day=2026-11-19");
    expect(parseCalendarState({}, "2026-11-16")).toMatchObject({ view: "month", d: "2026-11-16" });
  });
  it("old batch links go to the week view of that week", () => {
    expect(batchRedirect("2026-11-16")).toBe("/calendar?view=week&d=2026-11-16");
    expect(batchRedirect(null)).toBe("/calendar");
    expect(batchRedirect("garbage")).toBe("/calendar");
  });
  it("return paths stay inside the app; results replace old ones", () => {
    expect(safeBack("https://evil.example.com")).toBe("/calendar");
    expect(safeBack("//evil.example.com")).toBe("/calendar");
    expect(safeBack("/")).toBe("/");
    expect(withResult("/calendar?d=2026-11-18&note=old&move=x", { error: "nope" }, ["move"])).toBe("/calendar?d=2026-11-18&error=nope");
    expect(withResult("/calendar?d=2026-11-18&note=old&move=x", { note: "ok" }, ["move"])).toBe("/calendar?d=2026-11-18&note=ok");
  });
});

describe("action planning", () => {
  it("planApproveSome approves only what passes planTransition and names what stayed", () => {
    const good = makeItem({ platform: "instagram" });
    const bad = makeItem({ platform: "tiktok", warnings: [{ code: "caption.missing", severity: "block", message: "needs a caption" }] });
    const plan = planApproveSome(makeBatch([good, bad]), [good.id, bad.id], NOW);
    expect(plan.approved.map((a) => a.itemId)).toEqual([good.id]);
    expect(plan.changes.every((c) => c.to === "approved" && c.eventKind === "approve")).toBe(true);
    expect(plan.stayed).toEqual([{ itemId: bad.id, platform: "tiktok", reason: "needs a caption" }]);
    expect(approveNote(1, plan.stayed)).toBe("Approved 1. 1 stayed: TikTok needs a caption");
    expect(planApproveSome(makeBatch([bad]), [bad.id], NOW).changes).toEqual([]);
  });

  const ctx: WarningContext = { now: NOW, cadence: { ...DEFAULT_CADENCE, dailyCaps: { instagram: 1, youtube: 5, tiktok: 5, snapchat: 1 } }, timeZone: "UTC", existing: [], blocklist: [] };
  it("planMove keeps each post's time, re-validates caps and refuses the past", () => {
    const a = makeItem({ status: "approved", scheduledFor: "2026-11-18T17:00:00Z" });
    const ok = planMove(makeBatch([a]), ctx, [a.id], "2026-11-20", null, NOW);
    expect(ok.ok && ok.changes[0]).toMatchObject({ eventKind: "edit", to: "draft", patch: { scheduled_for: "2026-11-20T17:00:00.000Z" } });
    expect(planMove(makeBatch([a]), ctx, [a.id], "2026-11-01", null, NOW)).toEqual({ ok: false, reason: "can't move there: time is in the past" });
    const other = makeItem({ status: "approved", scheduledFor: "2026-11-20T09:00:00Z" });
    const capped = planMove(makeBatch([a, other]), ctx, [a.id], "2026-11-20", null, NOW);
    expect(capped.ok).toBe(false);
    expect(!capped.ok && capped.reason).toMatch(/^can't move there: instagram: 2 posts on 2026-11-20, cap 1/);
    const handed = makeItem({ status: "published", platformPostId: "x" });
    expect(planMove(makeBatch([handed]), ctx, [handed.id], "2026-11-20", "10:00", NOW)).toMatchObject({ ok: false });
  });
});

describe("one state per platform line (F19)", () => {
  const at = (h: number) => `2026-11-18T${String(h).padStart(2, "0")}:00:00.000Z`;
  const block = [{ severity: "block" as const, message: "needs a caption", field: "caption" as const }];

  it("draft: approvable → needs-approval; blocked / past / untimed → needs-fix with the reason", () => {
    expect(lineState(makeItem(), NOW)).toEqual({ state: "needs-approval", fix: null });
    expect(lineState(makeItem({ warnings: block as never }), NOW)).toEqual({ state: "needs-fix", fix: "needs a caption" });
    expect(lineState(makeItem({ scheduledFor: "2026-11-12T10:00:00Z" }), NOW)).toEqual({ state: "needs-fix", fix: "time is in the past" });
    expect(lineState(makeItem({ scheduledFor: null }), NOW)).toEqual({ state: "needs-fix", fix: "no time set" });
  });

  it("other statuses", () => {
    expect(lineState(makeItem({ status: "approved" }), NOW).state).toBe("approved");
    expect(lineState(makeItem({ status: "approved", scheduledFor: "2026-11-13T09:00:00Z" }), NOW).state).toBe("missed");
    expect(lineState(makeItem({ status: "published" }), NOW).state).toBe("posted");
    expect(lineState(makeItem({ status: "failed" }), NOW).state).toBe("failed");
    expect(lineState(makeItem({ status: "unknown" }), NOW).state).toBe("unknown");
    expect(lineState(makeItem({ status: "approved", platform: "snapchat", scheduledFor: "2026-11-13T11:30:00Z" }), NOW).state).toBe("share-by-hand");
  });

  it("card chip: same → label; mixed → a count; never a bare 'Needs approval' over approved lines", () => {
    expect(cardChip(["approved", "approved"]).label).toBe("Approved");
    expect(cardChip(["needs-approval", "approved", "approved"]).label).toBe("1 of 3 needs approval");
    expect(cardChip(["needs-approval", "needs-approval", "approved"]).label).toBe("2 of 3 need approval");
    expect(cardChip(["needs-fix", "approved"]).label).toBe("1 of 2 needs a fix");
    expect(cardChip(["approved", "posted"]).label).toBe("Approved");
    expect(cardChip(["posted", "posted"]).label).toBe("Posted");
    expect(cardChip(["failed", "needs-approval"]).label).toBe("1 of 2 needs approval");
  });

  it("one approved + one draft sibling: the card is not 'Needs approval'", () => {
    const [e] = groupEntries([makeItem({ mediaId: "m", platform: "instagram", status: "approved", scheduledFor: at(15) }), makeItem({ mediaId: "m", platform: "tiktok", scheduledFor: at(16) })], UTC);
    expect(e!.statusLabel).toBe("1 of 2 needs approval");
    expect(e!.platforms.map((p) => p.state)).toEqual(["approved", "needs-approval"]);
    expect(e!.platforms[1]!.time12).toBe("4:00 PM");
  });
});

describe("Approve all count (F19): same states as the cards", () => {
  const at = (h: number) => `2026-11-18T${String(h).padStart(2, "0")}:00:00.000Z`;
  const block = [{ severity: "block" as const, message: "needs a caption", field: "caption" as const }];

  it("counts only needs-approval lines; blocked / past / untimed stay out and are listed with a reason", () => {
    const items = [
      makeItem({ mediaId: "a", platform: "instagram", caption: "Day 3 quiet session\nmore", scheduledFor: at(9) }),
      makeItem({ mediaId: "a", platform: "tiktok", scheduledFor: at(10) }),
      makeItem({ mediaId: "b", platform: "tiktok", scheduledFor: at(8) }),
      makeItem({ mediaId: "c", platform: "youtube", title: "Blocked one", warnings: block as never, scheduledFor: at(11) }),
      makeItem({ mediaId: "d", platform: "instagram", scheduledFor: "2026-11-12T10:00:00Z" }),
      makeItem({ mediaId: "e", platform: "instagram", status: "approved", scheduledFor: at(12) }),
    ];
    const entries = groupEntries(items, UTC);
    const v = approveAllView(entries);
    expect(v.total).toBe(3);
    expect(v.groups.map((g) => [g.platform, g.lines.length])).toEqual([["instagram", 1], ["tiktok", 2]]);
    expect(v.groups[0]!.lines[0]).toMatchObject({ title: "Day 3 quiet session", when: "Wed, Nov 18 · 9:00 AM" });
    expect(v.notIncluded.map((n) => n.reason).sort()).toEqual(["needs a caption", "time is in the past"]);
    // The card chips agree: exactly these lines are "needs-approval".
    expect(entries.flatMap((e) => e.platforms).filter((p) => p.state === "needs-approval")).toHaveLength(v.total);
  });

  it("clips long titles to 60 characters and falls back to the entry title", () => {
    const long = "x".repeat(90);
    const v = approveAllView(groupEntries([makeItem({ caption: long, scheduledFor: at(9) })], UTC));
    expect(v.groups[0]!.lines[0]!.title.length).toBeLessThanOrEqual(60);
    expect(approveAllView([]).total).toBe(0);
  });

  it("agrees with the server plan (planApproveSome) on which drafts go through", () => {
    const items = [makeItem({ id: "ok", scheduledFor: at(9) }), makeItem({ id: "blk", warnings: block as never, scheduledFor: at(9) }), makeItem({ id: "past", scheduledFor: "2026-11-12T10:00:00Z" })];
    const plan = planApproveSome(makeBatch(items), items.map((i) => i.id), NOW);
    const v = approveAllView(groupEntries(items, UTC));
    expect(v.groups.flatMap((g) => g.lines.map((l) => l.itemId)).sort()).toEqual(plan.approved.map((a) => a.itemId).sort());
  });
});

describe("links from Home and ?reschedule", () => {
  it("opens dialogs on the calendar week of the post", () => {
    const l = linksFromHome("2026-11-13");
    expect(l.move("11111111-1111-1111-1111-111111111111|2026-11-18")).toBe("/calendar?view=week&d=2026-11-18&move=11111111-1111-1111-1111-111111111111%7C2026-11-18");
    expect(l.reschedule("11111111-1111-1111-1111-111111111111", "2026-11-12")).toContain("reschedule=11111111");
  });
  it("round-trips ?reschedule=all", () => {
    const s = parseCalendarState({ reschedule: "all" }, "2026-11-13");
    expect(s.reschedule).toBe("all");
    expect(calendarHref(s, { reschedule: s.reschedule })).toContain("reschedule=all");
    expect(parseCalendarState({ reschedule: "nope" }, "2026-11-13").reschedule).toBeNull();
  });
});
