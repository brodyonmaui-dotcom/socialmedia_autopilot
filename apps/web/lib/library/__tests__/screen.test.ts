import { describe, expect, it } from "vitest";
import type { LibraryClip, TouchUpClip } from "../data.js";
import {
  cardStage,
  cardTags,
  clipAriaLabel,
  clipUseLines,
  durationText,
  fixAllPlan,
  fixingText,
  keepFixNote,
  libraryUrl,
  loudnessText,
  noteParams,
  groupClips,
  parseLibraryParams,
  pillarOptions,
  resultNote,
  safeBack,
  scheduledLong,
  scheduledShort,
  sizeText,
  statsFacts,
  tagOptions,
  touchUpHeadline,
  touchUpOrder,
  touchUpRedirect,
  withNote,
} from "../screen.js";

const ID = "11111111-2222-4333-8444-555555555555";
const ID2 = "aaaaaaaa-2222-4333-8444-555555555555";

const clip = (o: Partial<LibraryClip> = {}): LibraryClip => ({
  mediaId: ID,
  label: "demo-0001",
  durationS: 42,
  pillar: "gym",
  status: "ready",
  tags: [],
  flagged: 0,
  hasPoster: true,
  usedIn: 0,
  derivedFrom: null,
  folder: null,
  at: "2026-11-25T12:00:00.000Z",
  focused: false,
  href: "/library",
  ...o,
});

const tu = (o: Partial<TouchUpClip> = {}): TouchUpClip => ({
  mediaId: ID,
  label: "demo-0001",
  pillar: "gym",
  durationS: 33,
  hasPoster: true,
  issues: [{ code: "frozen-tail", text: "The last 3 seconds are frozen.", fixable: true }],
  fixOps: ["trim"],
  optionalOps: [],
  fix: { state: "none" },
  libraryHref: "/library?q=demo-0001",
  ...o,
});

describe("library URL state", () => {
  it("parses and sanitises the query", () => {
    expect(parseLibraryParams({ q: "  leg day  ", pillar: "gym", tag: "no-sound", cursor: "abc_-1", focus: ID, clip: ID2 })).toEqual({
      q: "leg day",
      pillar: "gym",
      tag: "no-sound",
      cursor: "abc_-1",
      focus: ID,
      clip: ID2,
      group: "week",
    });
    expect(parseLibraryParams({ q: ["a", "b"], pillar: "<x>", tag: "nope", cursor: "a/b", focus: "x", clip: "1" })).toEqual({
      q: "a",
      pillar: null,
      tag: null,
      cursor: null,
      focus: null,
      clip: null,
      group: "week",
    });
    expect(parseLibraryParams({}).q).toBe("");
  });

  it("builds stable URLs without empty keys", () => {
    expect(libraryUrl({})).toBe("/library");
    expect(libraryUrl({ q: "a b", tag: "flagged", clip: ID })).toBe(`/library?q=a+b&tag=flagged&clip=${ID}`);
  });

  it("filter options drop the cursor, focus and dialog and mark the current one", () => {
    const p = parseLibraryParams({ q: "x", pillar: "gym", cursor: "c1", clip: ID, focus: ID });
    const pills = pillarOptions(["gym", "meal"], p);
    expect(pills.map((o) => o.label)).toEqual(["All topics", "Gym", "Meal"]);
    expect(pills.find((o) => o.current)!.label).toBe("Gym");
    expect(pills[2]!.href).toBe("/library?q=x&pillar=meal");
    const tags = tagOptions(p);
    expect(tags[0]).toEqual({ label: "Any tag", href: "/library?q=x&pillar=gym", current: true });
    expect(tags[1]!.label).toBe("Needs a touch-up");
    expect(tags.find((t) => t.label === "No sound yet")!.href).toBe("/library?q=x&pillar=gym&tag=no-sound");
  });

  it("keeps an unknown current pillar in the list so the Dropdown shows it", () => {
    expect(pillarOptions([], parseLibraryParams({ pillar: "travel" })).map((o) => o.label)).toEqual(["All topics", "Travel"]);
  });
});

describe("clip facts", () => {
  it("formats durations, sizes and loudness", () => {
    expect(durationText(42.4)).toBe("0:42");
    expect(durationText(61)).toBe("1:01");
    expect(durationText(null)).toBeNull();
    expect(sizeText(18_400_000)).toBe("18.4 MB");
    expect(sizeText(900)).toBe("1 KB");
    expect(sizeText(null)).toBeNull();
    expect(loudnessText(-14)).toBe("−14.0 LUFS");
    expect(loudnessText(null)).toBe("No level");
  });

  it("schedule lines", () => {
    expect(scheduledShort(0)).toBeNull();
    expect(scheduledShort(2)).toBe("Scheduled 2×");
    expect(scheduledLong(1)).toBe("Scheduled in 1 post");
    expect(scheduledLong(0)).toBe("Not scheduled yet");
  });

  it("card tags: touch-up first, at most two", () => {
    const tags = [
      { code: "no-sound", label: "No sound yet" },
      { code: "landscape", label: "Landscape" },
    ];
    expect(cardTags(clip({ tags })).map((t) => t.label)).toEqual(["No sound yet", "Landscape"]);
    expect(cardTags(clip({ tags, flagged: 1 })).map((t) => t.label)).toEqual(["Needs a touch-up", "No sound yet"]);
    expect(clipAriaLabel(clip({ tags, usedIn: 2 }))).toBe("demo-0001, 0:42, Scheduled 2 times, No sound yet, Landscape");
  });

  it("before/after facts use dashes for unknowns", () => {
    expect(statsFacts(null).map((f) => f.value)).toEqual(["–", "–", "–"]);
    expect(statsFacts({ durationS: 30, loudnessLufs: -14.2, videoCodec: "h264", width: 1080, height: 1920, sizeBytes: 15_600_000 }).map((f) => f.value)).toEqual([
      "0:30",
      "−14.2 LUFS",
      "15.6 MB",
    ]);
  });
});

describe("touch-up", () => {
  it("headline", () => {
    expect(touchUpHeadline(1)).toBe("1 clip needs a touch-up");
    expect(touchUpHeadline(5)).toBe("5 clips need a touch-up");
  });

  it("card stage per fix state", () => {
    expect(cardStage(tu())).toBe("fix");
    expect(cardStage(tu({ fixOps: [] }))).toBe("unfixable");
    expect(cardStage(tu({ fix: { state: "queued", fixId: ID, ops: ["trim"], requestedAt: "" } }))).toBe("fixing");
    expect(cardStage(tu({ fix: { state: "running", fixId: ID, ops: ["trim"], startedAt: null } }))).toBe("fixing");
    expect(cardStage(tu({ fix: { state: "done", fixId: ID, ops: ["trim"], fixedMediaId: ID2, before: null, after: null } }))).toBe("review");
    expect(cardStage(tu({ fix: { state: "failed", fixId: ID, ops: ["trim"], reason: "x" } }))).toBe("failed");
  });

  it("orders decisions first, re-exports last, stable inside a stage", () => {
    const order = touchUpOrder([
      tu({ mediaId: "fix1" }),
      tu({ mediaId: "still", fixOps: [] }),
      tu({ mediaId: "busy", fix: { state: "running", fixId: ID, ops: ["trim"], startedAt: null } }),
      tu({ mediaId: "failed", fix: { state: "failed", fixId: ID, ops: ["trim"], reason: "x" } }),
      tu({ mediaId: "fix2" }),
      tu({ mediaId: "done", fix: { state: "done", fixId: ID, ops: ["trim"], fixedMediaId: ID2, before: null, after: null } }),
    ]).map((c) => c.mediaId);
    expect(order).toEqual(["done", "failed", "fix1", "fix2", "busy", "still"]);
  });

  it("fixing text names the steps (not the always-on strip)", () => {
    expect(fixingText({ state: "queued", fixId: ID, ops: ["trim", "strip"], requestedAt: "" })).toBe("Waiting its turn: trim the frozen or black ends.");
    expect(fixingText({ state: "running", fixId: ID, ops: ["strip"], startedAt: null })).toBe("Working on it.");
    expect(fixingText({ state: "none" })).toBe("");
  });

  it("Fix all: only clips with something fixable and no open fix; per-issue counts", () => {
    const plan = fixAllPlan([
      tu({ mediaId: "a" }),
      tu({ mediaId: "b", issues: [{ code: "frozen-tail", text: "", fixable: true }, { code: "loudness", text: "", fixable: true }], fixOps: ["trim", "loudness"] }),
      tu({ mediaId: "c", issues: [{ code: "frozen-middle", text: "", fixable: false }], fixOps: [] }),
      tu({ mediaId: "d", fix: { state: "queued", fixId: ID, ops: ["trim"], requestedAt: "" } }),
      tu({ mediaId: "e", fix: { state: "failed", fixId: ID, ops: ["trim"], reason: "x" } }),
    ]);
    expect(plan.ids).toEqual(["a", "b", "e"]);
    expect(plan.issues).toEqual([
      { code: "frozen-tail", name: "Frozen end", n: 3 },
      { code: "loudness", name: "Sound level", n: 1 },
    ]);
    expect(plan.steps).toEqual(["Trim the frozen or black ends", "Even out the sound level"]);
  });
});

describe("result notes", () => {
  it("keep-fix note wording", () => {
    expect(keepFixNote(2, 1)).toBe("Kept the fix. 2 draft posts now use it; 1 approved post stays on the original.");
    expect(keepFixNote(1, 0)).toBe("Kept the fix. 1 draft post now uses it.");
    expect(keepFixNote(0, 3)).toBe("Kept the fix. No draft posts used this clip; 3 approved posts stay on the original.");
  });

  it("round-trips through the URL and replaces an older note", () => {
    const url = withNote("/library/touch-up?done=original", noteParams({ kind: "kept", repointed: 2, stayed: 1 }));
    expect(url).toBe("/library/touch-up?done=kept&moved=2&stayed=1");
    const sp = Object.fromEntries(new URL(url, "http://x").searchParams);
    expect(resultNote(sp)).toEqual({ tone: "info", text: "Kept the fix. 2 draft posts now use it; 1 approved post stays on the original." });
    expect(withNote(`/library?clip=${ID}`, noteParams({ kind: "queued", queued: 1, already: 0, skipped: 0 }))).toBe(`/library?clip=${ID}&done=queued&n=1&already=0&skipped=0`);
  });

  it("queued, error and unknown notes", () => {
    expect(resultNote({ done: "queued", n: "3", already: "1", skipped: "0" })!.text).toBe("Fixing 3 clips. Originals are kept. 1 was already being fixed.");
    expect(resultNote({ done: "error", reason: "unknown fix" })).toEqual({ tone: "danger", text: "That didn't work: unknown fix. Nothing was changed." });
    expect(resultNote({ done: "error", reason: "<script>" })!.text).toBe("That didn't work: something went wrong. Nothing was changed.");
    expect(resultNote({ done: "nope" })).toBeNull();
    expect(resultNote({})).toBeNull();
  });

  it("safeBack only allows library paths", () => {
    expect(safeBack("/library?q=a")).toBe("/library?q=a");
    expect(safeBack("/library/touch-up")).toBe("/library/touch-up");
    expect(safeBack("/libraryx")).toBe("/library/touch-up");
    expect(safeBack("//evil.example/library")).toBe("/library/touch-up");
    expect(safeBack("https://evil.example")).toBe("/library/touch-up");
    expect(safeBack(undefined, "/library")).toBe("/library");
  });

  it("old /touch-up keeps its query", () => {
    expect(touchUpRedirect({})).toBe("/library/touch-up");
    expect(touchUpRedirect({ done: "kept", moved: "2", x: ["a", "b"] })).toBe("/library/touch-up?done=kept&moved=2&x=a&x=b");
  });
});

describe("clip dialog: where it's used", () => {
  // 2099-11-24 is a Tuesday. Zones are passed in (the calendar's creator zone); none is hard-coded in the app.
  const uses = [
    { platform: "instagram", scheduledFor: new Date("2099-11-24T18:00:00Z"), status: "approved" },
    { platform: "tiktok", scheduledFor: null, status: "draft" },
    { platform: "youtube", scheduledFor: new Date("2099-11-02T09:05:00Z"), status: "published" },
    { platform: "snapchat", scheduledFor: new Date("2099-11-03T09:05:00Z"), status: "queued" },
  ];

  it("platform · creator-local day and time, untimed says so, status words only from the status", () => {
    const lines = clipUseLines(uses, "UTC");
    expect(lines.map((l) => l.text)).toEqual([
      "Instagram · Tue 24 Nov, 6:00 PM",
      "TikTok · not timed yet · needs approval",
      "YouTube · Mon 2 Nov, 9:05 AM · posted",
      "Snapchat · Tue 3 Nov, 9:05 AM",
    ]);
    expect(new Set(lines.map((l) => l.key)).size).toBe(4);
  });

  it("links to the calendar week that holds the post (Monday of the local day)", () => {
    const lines = clipUseLines(uses, "UTC");
    expect(lines.map((l) => l.href)).toEqual(["/calendar?view=week&d=2099-11-23", "/calendar", "/calendar?view=week&d=2099-11-02", "/calendar?view=week&d=2099-11-02"]);
  });

  it("uses the zone it is given (day can shift across midnight)", () => {
    const late = [{ platform: "instagram", scheduledFor: new Date("2099-11-23T23:30:00Z"), status: "approved" }];
    expect(clipUseLines(late, "UTC")[0]!.text).toBe("Instagram · Mon 23 Nov, 11:30 PM");
    const east = clipUseLines(late, "Etc/GMT-2")[0]!;
    expect(east.text).toBe("Instagram · Tue 24 Nov, 1:30 AM");
    expect(east.href).toBe("/calendar?view=week&d=2099-11-23");
    expect(clipUseLines([], "UTC")).toEqual([]);
  });
});

describe("keepAllNote (F20 C)", () => {
  it("says what is still in flight", async () => {
    const { keepAllNote } = await import("../screen.js");
    expect(keepAllNote(12, 0, 0, 8, 3)).toBe("Kept 12 · 8 still fixing · 3 can't be fixed automatically");
    expect(keepAllNote(1, 0, 0)).toBe("Kept 1");
  });
});

describe("library grouping", () => {
  const at = (d: string) => `${d}T12:00:00.000Z`;
  const clips = [
    clip({ mediaId: "a", at: at("2026-11-26") }),
    clip({ mediaId: "b", at: at("2026-11-24") }),
    clip({ mediaId: "c", at: at("2026-11-17") }),
    clip({ mediaId: "d", at: at("2026-11-10"), folder: "Upper body" }),
    clip({ mediaId: "e", at: at("2026-11-25"), folder: "Week of Nov 23" }),
  ];

  it("group param: week by default, folder and none kept, junk falls back; the URL leaves week out", () => {
    expect(parseLibraryParams({}).group).toBe("week");
    expect(parseLibraryParams({ group: "folder" }).group).toBe("folder");
    expect(parseLibraryParams({ group: "none" }).group).toBe("none");
    expect(parseLibraryParams({ group: "x" }).group).toBe("week");
    expect(libraryUrl({ group: "week" })).toBe("/library");
    expect(libraryUrl({ q: "a", group: "folder" })).toBe("/library?q=a&group=folder");
  });

  it("week: folder label if set, else the week of captured/created; newest section first, with counts", () => {
    const s = groupClips(clips, "week", "UTC");
    expect(s.map((x) => [x.title, x.count])).toEqual([["Week of Nov 23", 3], ["Week of Nov 16", 1], ["Upper body", 1]]);
    expect(s[0]!.clips.map((c) => c.mediaId)).toEqual(["a", "b", "e"]);
  });

  it("week uses the creator zone for the day", () => {
    const s = groupClips([clip({ at: "2026-11-29T23:00:00.000Z" })], "week", "Pacific/Auckland");
    expect(s[0]!.title).toBe("Week of Nov 30");
  });

  it("folder: labels newest first, unlabelled clips last under No folder", () => {
    const s = groupClips(clips, "folder", "UTC");
    expect(s.map((x) => [x.title, x.count])).toEqual([["Week of Nov 23", 1], ["Upper body", 1], ["No folder", 3]]);
  });

  it("none: one flat section without a title; empty list: no sections", () => {
    expect(groupClips(clips, "none", "UTC")).toMatchObject([{ title: null, count: 5 }]);
    expect(groupClips([], "week", "UTC")).toEqual([]);
  });
});
