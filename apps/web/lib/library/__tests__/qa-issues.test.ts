import { describe, expect, it } from "vitest";
import { availableOps, defaultOps, flaggedIssues, focusHref, infoTags, issuesOf, resolveOps, type QaIssue } from "../qa-issues.js";

const fix = (code: string, fixable = true): QaIssue => ({ code, severity: "fix", fixable, detail: `${code} sentence.` });
const info = (code: string, fixable = false): QaIssue => ({ code, severity: "info", fixable, detail: `${code}.` });

describe("issuesOf: legacy warning strings are never flagged", () => {
  it("effectively silent → info no-sound; frozen/black counts → info recheck (deduped)", () => {
    const issues = issuesOf({ warnings: ["3 frozen-frame segment(s)", "2 black-frame segment(s)", "effectively silent (-62.0 LUFS)"] });
    expect(issues.map((i) => `${i.severity}:${i.code}`)).toEqual(["info:recheck", "info:no-sound"]);
    expect(flaggedIssues(issues)).toEqual([]);
  });

  it("landscape and too-long map to info tags; null/garbage → nothing", () => {
    expect(issuesOf({ warnings: ["landscape (1920x1080), expected vertical", "1000s exceeds reels limit (900s)"] }).map((i) => i.code)).toEqual(["landscape", "too-long"]);
    expect(issuesOf(null)).toEqual([]);
    expect(issuesOf({ warnings: [42, ""] })).toEqual([]);
  });

  it("v2 results are read as stored (bad entries dropped)", () => {
    const qa = { version: 2, issues: [fix("frozen-tail"), info("no-sound"), { code: 1 }, { code: "x", severity: "maybe" }], warnings: ["ignored"] };
    expect(issuesOf(qa).map((i) => i.code)).toEqual(["frozen-tail", "no-sound"]);
  });
});

describe("flagged / tags / ops", () => {
  const issues = [fix("frozen-tail"), fix("loudness"), fix("frozen-middle", false), info("no-sound"), info("silence-gaps", true), info("no-sound")];

  it("only fix issues count as flagged; dismissed codes drop out", () => {
    expect(flaggedIssues(issues).map((i) => i.code)).toEqual(["frozen-tail", "loudness", "frozen-middle"]);
    expect(flaggedIssues(issues, ["loudness"]).map((i) => i.code)).toEqual(["frozen-tail", "frozen-middle"]);
  });

  it("info issues become tags, one per code", () => {
    expect(infoTags(issues)).toEqual([
      { code: "no-sound", label: "No sound yet" },
      { code: "silence-gaps", label: "Silent pauses" },
    ]);
  });

  it("default ops = fixable fix issues; remove-gaps is opt-in; unknown/unallowed ops are dropped", () => {
    expect(defaultOps(issues)).toEqual(["trim", "loudness"]);
    expect(availableOps(issues)).toEqual(["trim", "remove-gaps", "loudness"]);
    expect(resolveOps(issues, ["remove-gaps", "pad", "rm -rf", "trim"])).toEqual(["trim", "remove-gaps"]);
    expect(defaultOps(issues, ["frozen-tail"])).toEqual(["loudness"]);
  });

  it("focusHref searches by label and focuses the clip", () => {
    expect(focusHref("leg day", "0b2b8a43-8f4c-4a8e-9c38-1e6c3f6f2a10")).toBe("/library?q=leg%20day&focus=0b2b8a43-8f4c-4a8e-9c38-1e6c3f6f2a10");
  });
});
