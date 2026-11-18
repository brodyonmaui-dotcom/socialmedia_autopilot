import { describe, expect, it } from "vitest";
import { parsePromoHandle } from "../promo.js";

describe("parsePromoHandle (Settings: add an account by handle)", () => {
  it("accepts a plain handle and lower-cases it", () => {
    expect(parsePromoHandle("instagram", "gym_fan_22")).toEqual({ platform: "instagram", handle: "gym_fan_22" });
    expect(parsePromoHandle("youtube", "  Promo.Page-1 ")).toEqual({ platform: "youtube", handle: "promo.page-1" });
    expect(parsePromoHandle("tiktok", "a")).toEqual({ platform: "tiktok", handle: "a" });
  });

  it("strips leading @s", () => {
    expect(parsePromoHandle("instagram", "@@Name")).toEqual({ platform: "instagram", handle: "name" });
    expect(parsePromoHandle("instagram", " @fit_features_hub")).toEqual({ platform: "instagram", handle: "fit_features_hub" });
  });

  it("refuses a pasted profile link", () => {
    for (const raw of ["https://www.instagram.com/fit_features_hub", "instagram.com/fit_features_hub", "www.tiktok.com", "@x/y"]) {
      expect(parsePromoHandle("instagram", raw)).toEqual({ error: "Type the handle, not a link." });
    }
  });

  it("refuses an empty handle", () => {
    for (const raw of ["", "   ", "@", "@@ "]) expect(parsePromoHandle("instagram", raw)).toEqual({ error: "Type a handle first." });
  });

  it("refuses a handle over 40 characters (40 is fine)", () => {
    expect(parsePromoHandle("instagram", "a".repeat(40))).toEqual({ platform: "instagram", handle: "a".repeat(40) });
    expect(parsePromoHandle("instagram", "a".repeat(41))).toEqual({ error: "That handle is too long." });
  });

  it("refuses other characters", () => {
    for (const raw of ["gym fan", "gym#fan", "émile", "gym@fan"]) expect(parsePromoHandle("instagram", raw)).toHaveProperty("error");
  });

  it("refuses a platform without comments here", () => {
    for (const p of ["snapchat", "", "Instagram", "facebook"]) expect(parsePromoHandle(p, "gym_fan_22")).toEqual({ error: "Pick Instagram, YouTube or TikTok." });
  });
});
