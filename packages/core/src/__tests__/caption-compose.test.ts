import { describe, expect, it } from "vitest";
import { CAPTION_BANK, CAPTION_GROUPS, contextTopicFor } from "../caption-templates.js";
import { composeTemplateCaption, captionSimilarity, hashtagSetsOf } from "../caption-compose.js";
import { extractHashtags, pickHashtags, tagSetKey } from "../hashtags.js";
import type { Platform } from "../types.js";

const PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube"];

describe("caption bank", () => {
  it("sizes: >= 25 hooks, >= 20 bodies, >= 10 closers per group, all unique", () => {
    for (const g of CAPTION_GROUPS) {
      const b = CAPTION_BANK[g];
      expect(b.hooks.length, g).toBeGreaterThanOrEqual(25);
      expect(b.bodies.length, g).toBeGreaterThanOrEqual(20);
      expect(b.ctas.length, g).toBeGreaterThanOrEqual(10);
      for (const list of [b.hooks, b.bodies, b.ctas]) expect(new Set(list).size).toBe(list.length);
    }
  });
  it("every line is voice-safe: no digits, no exclamation marks, no hashtags, no hype or call to action, hooks fit the feed", () => {
    for (const g of CAPTION_GROUPS) {
      for (const t of [...CAPTION_BANK[g].hooks, ...CAPTION_BANK[g].bodies, ...CAPTION_BANK[g].ctas]) {
        expect(t, t).not.toMatch(/!|#|\d|\bhi\b|\bhey\b|follow for|link in bio|comment \w+ for|insane|goat|let'?s go/i);
        expect(t, t).not.toMatch(/\bat the\b|\bright now\b|\bheading to\b|\bnear\b/i);
        expect([...t].length, t).toBeLessThanOrEqual(125);
      }
    }
  });
  it("context topics need the clip name to say so", () => {
    expect(contextTopicFor("Upper body sets")?.id).toBe("upper-body");
    expect(contextTopicFor("physique check.mp4")?.id).toBe("physique");
    expect(contextTopicFor("IMG_4821")).toBeNull();
    expect(contextTopicFor(null)).toBeNull();
  });
});

describe("pickHashtags", () => {
  it("counts per platform and never the same set as the last 5", () => {
    for (const g of CAPTION_GROUPS) {
      const seen: string[][] = [];
      for (let i = 0; i < 60; i++) {
        const ig = pickHashtags(g, "instagram", `s${i}`, seen.slice(0, 5));
        expect(ig.length).toBeGreaterThanOrEqual(3);
        expect(ig.length).toBeLessThanOrEqual(5);
        expect(seen.slice(0, 5).some((s) => tagSetKey(s) === tagSetKey(ig))).toBe(false);
        seen.unshift(ig);
        const tt = pickHashtags(g, "tiktok", `s${i}`);
        expect(tt.length).toBeGreaterThanOrEqual(3);
        expect(tt.length).toBeLessThanOrEqual(5);
        const yt = pickHashtags(g, "youtube", `s${i}`);
        expect(yt.length).toBeGreaterThanOrEqual(2);
        expect(yt.length).toBeLessThanOrEqual(3);
        expect(yt).toContain("#shorts");
        expect(new Set(ig).size).toBe(ig.length);
        for (const t of [...ig, ...tt, ...yt]) expect(t).toMatch(/^#[a-z]+$/);
      }
    }
  });
  it("is deterministic", () => {
    expect(pickHashtags("gym", "instagram", "x")).toEqual(pickHashtags("gym", "instagram", "x"));
  });
});

describe("composeTemplateCaption", () => {
  it("many seeds: <= 5 tags on IG, no digits/exclamation in text, first line short, deterministic", () => {
    for (const g of CAPTION_GROUPS) {
      for (const p of PLATFORMS) {
        for (let i = 0; i < 80; i++) {
          const c = composeTemplateCaption({ group: g, platform: p, seed: `seed-${i}` })!;
          expect(c).toBeTruthy();
          expect(composeTemplateCaption({ group: g, platform: p, seed: `seed-${i}` })).toBe(c);
          const [text, tail] = c.split("\n\n");
          expect(text, c).not.toMatch(/!|\d/);
          expect(text!.split("\n")[0]!.length).toBeLessThanOrEqual(125);
          const tags = extractHashtags(tail ?? "");
          expect(tags.length).toBe(extractHashtags(c).length);
          expect(tags.length).toBeLessThanOrEqual(p === "youtube" ? 3 : 5);
          if (p === "tiktok") expect(text).not.toContain("\n");
        }
      }
    }
  });
  it("never within 0.6 similarity of the recent list; null when nothing fresh is left", () => {
    const recent: string[] = [];
    for (let i = 0; i < 40; i++) {
      const c = composeTemplateCaption({ group: "gym", platform: "instagram", seed: `d${i}`, recentCaptions: recent, recentHashtagSets: hashtagSetsOf(recent.slice(0, 5)) });
      if (!c) break;
      for (const r of recent) expect(captionSimilarity(c, r)).toBeLessThan(0.6);
      recent.unshift(c);
    }
    expect(recent.length).toBeGreaterThan(20);
    // every one of the 4 tiktok one-liners' hooks used up => null
    const all = CAPTION_BANK.gym.hooks.map((h) => h);
    expect(composeTemplateCaption({ group: "gym", platform: "tiktok", seed: "z", recentCaptions: all })).toBeNull();
  });
  it("uses the clip topic only when the name says so", () => {
    let hit = 0;
    for (let i = 0; i < 40; i++) if (/upper body/i.test(composeTemplateCaption({ group: "gym", platform: "instagram", clipContext: "Upper body sets", seed: `c${i}` })!)) hit++;
    expect(hit).toBeGreaterThan(5);
    for (let i = 0; i < 60; i++) expect(composeTemplateCaption({ group: "gym", platform: "instagram", clipContext: "IMG_1234", seed: `c${i}` })).not.toMatch(/upper body|leg day|pull day|push day/i);
  });
});
