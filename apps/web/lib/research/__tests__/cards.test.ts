import { describe, expect, it } from "vitest";
import {
  aboutWithoutQuote,
  cleanHookText,
  creatorMeta,
  forwardMove,
  hookKind,
  hookView,
  ideaHeading,
  ideaSections,
  listHref,
  mergeUsed,
  moveField,
  parsePillar,
  parseSource,
  pillarOptions,
  quotedHook,
  researchTabs,
  safeReturn,
  sourceChips,
  stageChip,
  whenText,
  withNote,
  type HookLike,
  type IdeaLike,
} from "../cards.js";

const idea = (o: Partial<IdeaLike>): IdeaLike => ({
  id: "i1",
  title: "t",
  source: "manual",
  stage: "idea",
  pillar: "gym",
  hook: "",
  about: "",
  adapt: "",
  script: "",
  referenceUrl: null,
  creatorHandle: null,
  usedAt: null,
  ...o,
});
const hook = (o: Partial<HookLike>): HookLike => ({ id: "h1", text: "x", template: "", source: "own", pillar: null, referenceUrl: null, creatorHandle: null, usedAt: null, ...o });

const Q_ABOUT = "A reel by @gym_fan_22 that opens with a question hook: “Why does nobody warm up before bench?”. It got 4× their usual engagement.";
const S_ABOUT = "A reel by @gym_fan_22 that opens with a contrarian hook: “Stop chasing the pump.” It got 2.9× their usual engagement.";

describe("creator idea title", () => {
  it("pulls the quoted hook line out of about", () => {
    expect(quotedHook(Q_ABOUT)).toBe("Why does nobody warm up before bench?");
    expect(quotedHook(S_ABOUT)).toBe("Stop chasing the pump.");
    expect(quotedHook("no quote here")).toBeNull();
    expect(quotedHook("empty “ ” quote")).toBeNull();
  });
  it("drops the quote from the about text without leaving stray punctuation", () => {
    expect(aboutWithoutQuote(Q_ABOUT)).toBe("A reel by @gym_fan_22 that opens with a question hook. It got 4× their usual engagement.");
    expect(aboutWithoutQuote(S_ABOUT)).toBe("A reel by @gym_fan_22 that opens with a contrarian hook. It got 2.9× their usual engagement.");
  });
  it("names the hook kind from the stored title or the pattern", () => {
    expect(hookKind("Question hook from @gym_fan_22")).toBe("Question hook");
    expect(hookKind("Number/list hook from @x")).toBe("Number/list hook");
    expect(hookKind("Something else", "pov")).toBe("Pov hook");
    expect(hookKind("Something else")).toBeNull();
  });
  it("creator ideas show the reference line with a From label; others keep their title", () => {
    expect(ideaHeading(idea({ source: "creator", title: "Question hook from @gym_fan_22", about: Q_ABOUT, creatorHandle: "gym_fan_22" }))).toEqual({
      label: "From @gym_fan_22 · Question hook",
      title: "Why does nobody warm up before bench?",
      quoted: true,
    });
    expect(ideaHeading(idea({ source: "creator", title: "Question hook from @a", about: "plain" }))).toEqual({ label: "From a creator · Question hook", title: "Question hook from @a", quoted: false });
    expect(ideaHeading(idea({ source: "script", title: "Yap #4 · Resistance" }))).toEqual({ label: "Your script", title: "Yap #4 · Resistance", quoted: false });
    expect(ideaHeading(idea({ source: "niche", title: "Cook once" })).label).toBe("Your niche");
  });
});

describe("idea sections", () => {
  it("creator ideas: about (without the quote) and how to adapt", () => {
    expect(ideaSections(idea({ source: "creator", about: Q_ABOUT, adapt: " Use your own. " })).map((s) => s.label)).toEqual(["What it's about", "How to adapt it"]);
    expect(ideaSections(idea({ source: "creator", about: Q_ABOUT }))[0]!.text).not.toContain("“");
  });
  it("scripts never get How to adapt it", () => {
    expect(ideaSections(idea({ source: "script", about: "Source.", adapt: "x" })).map((s) => s.label)).toEqual(["What it's about"]);
  });
  it("manual ideas fall back to the opening line, or nothing", () => {
    expect(ideaSections(idea({ hook: "Hi there" }))).toEqual([{ label: "Opening line", text: "Hi there" }]);
    expect(ideaSections(idea({}))).toEqual([]);
  });
});

describe("stage", () => {
  it("shows a quiet chip only when it says something", () => {
    expect(stageChip({ stage: "idea", source: "creator" })).toBeNull();
    expect(stageChip({ stage: "scripted", source: "script" })).toBeNull();
    expect(stageChip({ stage: "scripted", source: "manual" })).toBe("Scripted");
    expect(stageChip({ stage: "filmed", source: "script" })).toBe("Filmed");
  });
  it("moves forward one step and asks for the right field", () => {
    expect(forwardMove("idea")).toBe("scripted");
    expect(forwardMove("filmed")).toBe("posted");
    expect(forwardMove("posted")).toBeNull();
    expect(forwardMove("dropped")).toBeNull();
    expect(forwardMove("weird")).toBeNull();
    expect(moveField("scripted")?.name).toBe("script");
    expect(moveField("posted")?.label).toBe("Post ids");
    expect(moveField("posted")?.label.toLowerCase()).not.toContain("batch");
  });
});

describe("hooks", () => {
  it("cleans stored creator lines", () => {
    expect(cleanHookText("“Stop chasing the pump.” (@gym_fan_22)")).toBe("Stop chasing the pump.");
    expect(cleanHookText("“Why not?”")).toBe("Why not?");
    expect(cleanHookText("Plain line")).toBe("Plain line");
  });
  it("template is the main line with the reference beneath; own lines stand alone", () => {
    expect(hookView(hook({ text: "“Why not?”", template: "Why does [x]?", creatorHandle: "gym_fan_22", source: "creator" }))).toEqual({ main: "Why does [x]?", quote: "Why not?", attribution: "@gym_fan_22" });
    expect(hookView(hook({ text: "Mine", source: "own" }))).toEqual({ main: "Mine", quote: null, attribution: "Your hook" });
    expect(hookView(hook({ text: "S", source: "script" })).attribution).toBe("From your scripts");
  });
});

describe("tabs, filters and return paths", () => {
  it("tabs", () => {
    const t = researchTabs("used", { ideas: 3, hooks: 2, creators: 1, used: 4 });
    expect(t.map((x) => x.label)).toEqual(["Ideas", "Hooks", "Creators", "Already used"]);
    expect(t.find((x) => x.active)?.href).toBe("/research/used");
    expect(t.map((x) => x.label).join(" ").toLowerCase()).not.toContain("batch");
  });
  it("parses filters strictly", () => {
    expect(parseSource("creator")).toBe("creator");
    expect(parseSource("x")).toBeNull();
    expect(parsePillar("gym")).toBe("gym");
    expect(parsePillar("GYM")).toBeNull();
  });
  it("builds list links and chips", () => {
    expect(listHref("/research", {})).toBe("/research");
    expect(listHref("/research", { source: "niche", pillar: "gym" }, { add: "1" })).toBe("/research?source=niche&pillar=gym&add=1");
    const chips = sourceChips("niche", "gym", { creator: 2, niche: 1, script: 0, manual: 0 });
    expect(chips.map((c) => c.label)).toEqual(["All", "From creators", "Your niche"]);
    expect(chips[0]).toMatchObject({ count: 3, href: "/research?pillar=gym", current: false });
    expect(chips.find((c) => c.current)?.label).toBe("Your niche");
    expect(pillarOptions("/research/hooks", null, null)[0]).toEqual({ label: "All topics", href: "/research/hooks", current: true });
  });
  it("only returns to research pages with known filters", () => {
    expect(safeReturn("/research/used")).toBe("/research/used");
    expect(safeReturn("/research?source=script&pillar=gym&evil=1")).toBe("/research?source=script&pillar=gym");
    expect(safeReturn("https://evil.example/research")).toBe("/research");
    expect(safeReturn("/research/../x")).toBe("/research");
    expect(safeReturn(undefined, "/research/hooks")).toBe("/research/hooks");
    expect(withNote("/research", "Idea added.")).toBe("/research?note=Idea%20added.");
    expect(withNote("/research?pillar=gym", "a")).toBe("/research?pillar=gym&note=a");
  });
});

describe("already used, times, creators", () => {
  it("merges ideas and hooks newest first", () => {
    const out = mergeUsed(
      [idea({ id: "a", usedAt: "2026-11-10T00:00:00Z" }), idea({ id: "b" })],
      [hook({ id: "h", usedAt: "2026-11-12T00:00:00Z" })],
    );
    expect(out.map((e) => (e.kind === "idea" ? e.idea.id : e.hook.id))).toEqual(["h", "a"]);
  });
  it("says when in words", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(whenText("2026-11-16T07:00:00Z", now)).toBe("5 h ago");
    expect(whenText("2026-11-15T06:00:00Z", now)).toBe("yesterday");
    expect(whenText("2026-11-13T12:00:00Z", now)).toBe("3 days ago");
    expect(whenText("2026-11-01T12:00:00Z", now)).toBe("Nov 1");
    expect(whenText("2026-11-16T15:00:00Z", now)).toBe("in 3 h");
    expect(whenText("2026-11-19T00:00:00Z", now)).toBe("in 3 days");
  });
  it("creator meta line", () => {
    expect(creatorMeta({ pillar: "gym", followers: 12400, notes: "" })).toBe("Gym · 12,400 followers");
    expect(creatorMeta({ pillar: null, followers: null, notes: "dry hooks" })).toBe("dry hooks");
  });
});
