import { describe, expect, it } from "vitest";
import { judgeChip } from "../judge-chip.js";

describe("judgeChip", () => {
  it("is null with nothing to say", () => {
    expect(judgeChip(null, [])).toBeNull();
    expect(judgeChip(undefined, [{ code: "x", severity: "info", message: "m" }])).toBeNull();
  });
  it("derives from warnings: block red, warn amber", () => {
    expect(judgeChip(null, [{ code: "a", severity: "warn", message: "w" }])).toEqual({ tone: "warn", label: "1 warning", detail: ["w"] });
    expect(judgeChip(null, [{ code: "a", severity: "warn", message: "w" }, { code: "b", severity: "block", message: "b" }])?.tone).toBe("danger");
  });
  it("uses the judge score when present", () => {
    expect(judgeChip({ score: 81.6, checks: [{ id: "a", level: "ok", message: "fine" }] })).toEqual({ tone: "neutral", label: "Score 82", detail: [] });
    expect(judgeChip({ score: 40, checks: [{ id: "a", level: "block", message: "dup" }] })).toEqual({ tone: "danger", label: "Score 40 · 1 block", detail: ["dup"] });
  });
});
