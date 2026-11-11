import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "../capabilities.js";

describe("CAPABILITIES", () => {
  it("matches the routes decided in CLAUDE.md", () => {
    expect(CAPABILITIES.instagram.route).toBe("direct");
    expect(CAPABILITIES.youtube.route).toBe("direct");
    expect(CAPABILITIES.tiktok.route).toBe("middleman");
    expect(CAPABILITIES.snapchat.route).toBe("assisted");
  });

  it("has exactly the four shipped platforms", () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual(["instagram", "snapchat", "tiktok", "youtube"]);
  });
});
