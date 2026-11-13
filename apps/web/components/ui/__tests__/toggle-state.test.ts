import { describe, expect, it } from "vitest";
import { nextToggleState } from "../toggle-state.js";

describe("nextToggleState", () => {
  it("flips when enabled", () => {
    expect(nextToggleState(false, false)).toBe(true);
    expect(nextToggleState(true, false)).toBe(false);
  });
  it("never changes when disabled", () => {
    expect(nextToggleState(false, true)).toBe(false);
    expect(nextToggleState(true, true)).toBe(true);
  });
});
