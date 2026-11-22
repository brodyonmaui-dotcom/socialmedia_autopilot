import { describe, expect, it } from "vitest";
import { CAPTION_GROUPS, CAPTION_TEMPLATES, captionGroupFor, pickCaptionTemplate } from "../caption-templates.js";

describe("caption templates", () => {
  it("8-12 per pool, unique, 2-4 hashtags, no place/time words", () => {
    const all = new Set<string>();
    for (const g of CAPTION_GROUPS) {
      const pool = CAPTION_TEMPLATES[g];
      expect(pool.length, g).toBeGreaterThanOrEqual(8);
      expect(pool.length, g).toBeLessThanOrEqual(12);
      for (const t of pool) {
        expect(all.has(t), t).toBe(false);
        all.add(t);
        const tags = t.match(/#\w+/g) ?? [];
        expect(tags.length, t).toBeGreaterThanOrEqual(2);
        expect(tags.length, t).toBeLessThanOrEqual(4);
        expect(t, t).not.toMatch(/!|\bhi\b|\bhey\b|\d/i);
      }
    }
  });
  it("pillar mapping", () => {
    expect(captionGroupFor("workout-log")).toBe("gym");
    expect(captionGroupFor("physique")).toBe("gym");
    expect(captionGroupFor("single-set")).toBe("gym");
    expect(captionGroupFor(null)).toBe("lifestyle");
    expect(captionGroupFor("yap")).toBe("lifestyle");
  });
  it("deterministic, avoids used, falls back to the pool", () => {
    const a = pickCaptionTemplate("gym", "seed-1");
    expect(pickCaptionTemplate("gym", "seed-1")).toBe(a);
    const b = pickCaptionTemplate("gym", "seed-1", [a]);
    expect(b).not.toBe(a);
    expect(CAPTION_TEMPLATES.gym).toContain(pickCaptionTemplate("gym", "x", CAPTION_TEMPLATES.gym));
  });
});
