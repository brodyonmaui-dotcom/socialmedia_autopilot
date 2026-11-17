import { describe, expect, it } from "vitest";
import { creatorPlatform } from "../view.js";

describe("research view", () => {
  it("maps creator platforms and falls back to Instagram", () => {
    expect(creatorPlatform("tiktok")).toBe("tiktok");
    expect(creatorPlatform("weird")).toBe("instagram");
  });
});
