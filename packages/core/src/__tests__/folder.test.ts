import { describe, expect, it } from "vitest";
import { checkFolderLabel, weekFolderLabel } from "../folder.js";

describe("checkFolderLabel", () => {
  it("trims and collapses spaces", () => {
    expect(checkFolderLabel("  Upper   body ")).toEqual({ ok: true, folder: "Upper body" });
  });
  it("refuses empty, too long, slashes and control characters", () => {
    expect(checkFolderLabel("   ").ok).toBe(false);
    expect(checkFolderLabel("x".repeat(61)).ok).toBe(false);
    expect(checkFolderLabel("x".repeat(60)).ok).toBe(true);
    expect(checkFolderLabel("a/b").ok).toBe(false);
    expect(checkFolderLabel("C:\\clips").ok).toBe(false);
    expect(checkFolderLabel("a\u0001b").ok).toBe(false);
    expect(checkFolderLabel(5).ok).toBe(false);
  });
});

describe("weekFolderLabel", () => {
  it("is the Monday of the week", () => {
    expect(weekFolderLabel(new Date("2026-11-26T12:00:00Z"), "UTC")).toBe("Week of Nov 23");
    expect(weekFolderLabel(new Date("2026-11-23T00:30:00Z"), "UTC")).toBe("Week of Nov 23");
    expect(weekFolderLabel(new Date("2026-11-29T23:00:00Z"), "UTC")).toBe("Week of Nov 23");
  });
  it("uses the given zone for the day", () => {
    // Sun 29 Nov 23:00Z is already Mon 30 Nov in Auckland (UTC+13).
    expect(weekFolderLabel(new Date("2026-11-29T23:00:00Z"), "Pacific/Auckland")).toBe("Week of Nov 30");
  });
});
