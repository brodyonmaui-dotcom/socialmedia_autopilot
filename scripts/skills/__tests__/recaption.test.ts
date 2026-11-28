import { describe, expect, it } from "vitest";
import { composeTemplateCaption } from "../../../packages/core/src/index.js";
import { failsJudge, formatRecaptionTable, planRecaption, type Composer, type RecaptionItem } from "../lib/recaption.js";

const item = (id: string, o: Partial<RecaptionItem> = {}): RecaptionItem => ({ id, platform: "instagram", caption: "", title: null, scheduledFor: "Mon 2026-11-30 18:00", durationS: 20, pillar: "gym", clipContext: "Upper body sets", ...o });
const compose: Composer = async (i) => {
  const c = composeTemplateCaption({ group: i.group, platform: i.platform, clipContext: i.clipContext, recentCaptions: i.recentCaptions, recentHashtagSets: i.recentHashtagSets, seed: i.seed });
  return { caption: c, source: c ? "template" : "none" };
};
const good = "Quiet session, good reps, no complaints.\nNo big plan, just steady work.\n\n#gym #hypertrophy #discipline";

describe("planRecaption", () => {
  it("keeps passing items, recomposes empty / too-many-hashtag / repeated ones", async () => {
    const rows = await planRecaption(
      [item("a", { caption: good }), item("b", { caption: "" }), item("c", { caption: "x\n\n#a #b #c #d #e #gym" }), item("d", { caption: good.replace("Quiet", "Quiet") })],
      { instagram: [] },
      compose,
    );
    expect(rows.map((r) => r.source)).toEqual(["ok", "template", "template", "template"]);
    expect(rows[0]!.caption).toBeNull();
    for (const r of rows.slice(1)) {
      expect(r.caption).toBeTruthy();
      expect(failsJudge(r.after!)).toBe(false);
    }
    // item d now repeats a, whose text stays; the new caption differs from every other in the plan
    const all = rows.map((r) => r.caption).filter(Boolean);
    expect(new Set(all).size).toBe(all.length);
  });
  it("an item that cannot be fixed is reported as needs hand, not rewritten", async () => {
    const rows = await planRecaption([item("a", { caption: "" })], {}, async () => ({ caption: null, source: "none" }));
    expect(rows[0]).toMatchObject({ source: "none", caption: null });
    expect(formatRecaptionTable(rows)).toContain("needs hand");
  });
  it("duration alone is not a caption problem", async () => {
    const rows = await planRecaption([item("a", { caption: good, durationS: 600 })], {}, compose);
    expect(rows[0]!.source).toBe("ok");
  });
});
