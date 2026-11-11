import { describe, expect, it } from "vitest";
import { checkDraft, type BatchDraft } from "../lib/batch-draft.js";
import { buildReview, openQuestions, reviewPathFor, shortSource, type ClipInfo } from "../lib/batch-review.js";

const draft: BatchDraft = {
  weekStart: "2030-01-07",
  items: [
    {
      mediaId: "m1",
      pillar: "gym",
      label: "bench | top set",
      posts: {
        instagram: { caption: "225 and I are still negotiating…\n\n#gym #gymbro" },
        youtube: { title: "225 and I are still negotiating…", caption: "Bench day.\n\n#gym #gymbro #hypertrophy" },
        tiktok: { caption: "225 and I are still negotiating… #gym #gymbro #physique", tiktokDraft: true },
      },
    },
    {
      mediaId: "m2",
      pillar: "trading",
      posts: { instagram: { caption: "Monday P/L {{P/L}}, took the 1:1R. Not financial advice.\n\n#daytrading #nasdaq" } },
    },
  ],
};
const clips = new Map<string, ClipInfo>([
  ["m1", { sourcePath: String.raw`C:\Users\someone\Gym Content\Ready To Post\Workout Vlogs\Short Reels\set-bench-225-rep-max-1109.mp4`, durationS: 75, status: "ready" }],
]);
const check = checkDraft(draft, { now: new Date("2030-01-01T00:00:00Z") });

describe("shortSource", () => {
  it("keeps only the path below Ready To Post, never the home folder", () => {
    const s = shortSource(clips.get("m1")!.sourcePath);
    expect(s).toBe("Workout Vlogs/Short Reels/`set-bench-225-rep-max-1109.mp4`");
    expect(s).not.toMatch(/Users|someone/);
  });
  it("falls back to the last two segments, and says when the clip is unknown", () => {
    expect(shortSource("/home/x/clips/a.mp4")).toBe("clips/`a.mp4`");
    expect(shortSource(null)).toMatch(/not in library/);
  });
});

describe("openQuestions", () => {
  it("asks for placeholders, flags >60 s on YouTube, TikTok drafts and numbers taken from the file name", () => {
    const q1 = openQuestions(draft, check, 0, clips.get("m1"));
    expect(q1.some((q) => /75 s.*YouTube/.test(q))).toBe(true);
    expect(q1.some((q) => /inbox draft/.test(q))).toBe(true);
    expect(q1.some((q) => /"225" from the file name/.test(q))).toBe(true);
    expect(q1.some((q) => /"1109"/.test(q))).toBe(false); // in the file name but not in the text
    const q2 = openQuestions(draft, check, 1, undefined);
    expect(q2.some((q) => q.includes("{{P/L}}"))).toBe(true);
  });
  it("flags an archived clip", () => {
    expect(openQuestions(draft, check, 0, { ...clips.get("m1")!, status: "archived" }).some((q) => /archived/.test(q))).toBe(true);
  });
});

describe("buildReview", () => {
  const md = buildReview(draft, check, clips, new Date("2030-01-02T10:00:00Z"));
  it("one table row per clip with every platform's text; pipes and newlines can't break the table", () => {
    const rows = md.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain(String.raw`bench \| top set`);
    expect(rows[0]).toContain("225 and I are still negotiating… / #gym #gymbro");
    expect(rows[0]).toContain("(75 s)");
    expect(rows[1]).toContain("— |"); // no TikTok/YouTube for item 2
  });
  it("states the check result and that nothing was created", () => {
    expect(md).toMatch(/Check: \*\*(OK|FAIL)\*\*, 4 post\(s\)/);
    expect(md).toContain("Nothing was created.");
  });
  it("review path sits next to the draft", () => {
    expect(reviewPathFor("logs/batch-2026-11-16.json")).toBe("logs/batch-2026-11-16-review.md");
  });
});
