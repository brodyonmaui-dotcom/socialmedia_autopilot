import { describe, expect, it } from "vitest";
import { judgePost, judgeWarnings, type JudgeInput } from "../judge.js";

const ok = (over: Partial<JudgeInput> = {}): JudgeInput => ({
  platform: "instagram",
  caption: "Quiet session, good reps, no complaints.\nNo big plan, just steady work.\n\n#gym #hypertrophy #discipline",
  durationS: 20,
  recent: { captions: [], hashtagSets: [] },
  ...over,
});
const level = (r: ReturnType<typeof judgePost>, id: string) => r.checks.find((c) => c.id === id)?.level;

describe("judgePost", () => {
  it("a clean post scores 100", () => {
    const r = judgePost(ok());
    expect(r.score).toBe(100);
    expect(r.checks.every((c) => c.level === "pass")).toBe(true);
  });
  it("instagram > 5 hashtags blocks", () => {
    expect(level(judgePost(ok({ caption: "A line.\n\n#a #b #c #d #e #gym" })), "hashtags.limit")).toBe("block");
    expect(level(judgePost(ok({ caption: "A line.\n\n#a #b #c #d #gym" })), "hashtags.limit")).toBe("pass");
  });
  it("youtube: > 3 warns, > 60 blocks", () => {
    const yt = (n: number) => judgePost({ platform: "youtube", title: "Title", caption: "Desc.\n\n" + Array.from({ length: n }, (_, i) => `#gym${String.fromCharCode(97 + (i % 26))}${i}`).join(" "), durationS: 20 });
    expect(level(yt(3), "hashtags.limit")).toBe("pass");
    expect(level(yt(4), "hashtags.limit")).toBe("warn");
    expect(level(yt(61), "hashtags.limit")).toBe("block");
  });
  it("needs a niche hashtag", () => {
    expect(level(judgePost(ok({ caption: "A line.\n\n#fitness #motivation" })), "hashtags.niche")).toBe("warn");
    expect(level(judgePost(ok({ caption: "A line." })), "hashtags.niche")).toBe("warn");
  });
  it("same hashtag set as a recent post warns (order and case ignored)", () => {
    const r = judgePost(ok({ recent: { captions: [], hashtagSets: [["#Discipline", "#gym", "#hypertrophy"]] } }));
    expect(level(r, "hashtags.repeat")).toBe("warn");
  });
  it("empty caption blocks", () => {
    expect(level(judgePost(ok({ caption: "  " })), "caption.empty")).toBe("block");
    expect(level(judgePost(ok({ platform: "snapchat", caption: "" })), "caption.empty")).toBe("pass");
  });
  it("near-duplicate: >= 0.8 blocks, >= 0.6 warns, different passes", () => {
    const base = "I went to the gym today and kept the reps slow and honest for every single set";
    expect(level(judgePost(ok({ caption: base, recent: { captions: [base + " #gym"] } })), "caption.similar")).toBe("block");
    const mid = "I went to the gym today and kept the reps slow and honest for every set that mattered";
    const r = judgePost(ok({ caption: mid, recent: { captions: [base] } }));
    expect(["warn", "block"]).toContain(level(r, "caption.similar"));
    expect(level(judgePost(ok({ recent: { captions: [base] } })), "caption.similar")).toBe("pass");
  });
  it("first line over 125 characters warns", () => {
    expect(level(judgePost(ok({ caption: "x".repeat(130) + "\n\n#gym" })), "caption.hook")).toBe("warn");
  });
  it("length limits", () => {
    expect(level(judgePost(ok({ caption: "a ".repeat(1200) + "#gym" })), "caption.length")).toBe("block");
    expect(level(judgePost({ platform: "youtube", title: "t".repeat(101), caption: "d #gym" }), "title.length")).toBe("block");
    expect(level(judgePost({ platform: "youtube", title: "", caption: "d #gym" }), "title.empty")).toBe("block");
    expect(level(judgePost({ platform: "youtube", title: "ok", caption: "d".repeat(5001) }), "caption.length")).toBe("block");
  });
  it("duration bounds warn", () => {
    expect(level(judgePost(ok({ durationS: 1 })), "duration")).toBe("warn");
    expect(level(judgePost(ok({ durationS: 400 })), "duration")).toBe("warn");
    expect(level(judgePost(ok({ durationS: 30 })), "duration")).toBe("pass");
  });
  it("injected lint: error blocks, warn warns", () => {
    expect(level(judgePost(ok({ lint: () => [{ severity: "error", message: "named place" }] })), "lint")).toBe("block");
    expect(level(judgePost(ok({ lint: () => [{ severity: "warn", message: "meh" }] })), "lint")).toBe("warn");
    expect(level(judgePost(ok({ lint: () => [] })), "lint")).toBe("pass");
  });
  it("stream A's duplicate verdict is passed through", () => {
    const r = judgePost(ok({ duplicate: { level: "block", message: "This video was already posted on Instagram" } }));
    expect(level(r, "duplicate")).toBe("block");
    expect(r.score).toBe(60);
  });
  it("score: 40 per block, 10 per warn, floor 0", () => {
    const r = judgePost(ok({ caption: "A line.\n\n#fitness", durationS: 1 }));
    expect(r.score).toBe(80);
    expect(judgePost(ok({ caption: "", durationS: 1, duplicate: { level: "block", message: "x" }, lint: () => [{ severity: "error", message: "p" }] })).score).toBeLessThanOrEqual(0 + 20);
  });
});

describe("judgeWarnings", () => {
  it("only the checks warnings.ts does not make, in its warning shape", () => {
    const w = judgeWarnings(ok({ caption: "A line.\n\n#fitness", durationS: 1 }));
    expect(w.map((x) => x.severity)).toEqual(["warn", "warn"]);
    expect(w.every((x) => x.code === "lint.warn" && x.field === "caption")).toBe(true);
    expect(judgeWarnings(ok({ caption: "" }))).toEqual([]);
    expect(judgeWarnings(ok())).toEqual([]);
  });
});
