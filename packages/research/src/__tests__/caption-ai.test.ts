import { describe, expect, it } from "vitest";
import { CAPTION_BANK, CAPTION_GROUPS, composeTemplateCaption, extractHashtags, type Platform } from "@autopilot/core";
import { addSpendCents, composeCaption, finishAiCaption, readSpendCents, spendKey, usageCents, type CaptionDb } from "../auto/caption-ai.js";
import { lintText } from "../voice-lint.js";

/** In-memory settings table. */
function fakeDb(initial: Record<string, number> = {}): CaptionDb & { data: Record<string, number> } {
  const data = { ...initial };
  return {
    data,
    async query(sql: string, params: unknown[] = []) {
      if (/^select value from settings/i.test(sql)) return { rows: (params[0] as string) in data ? [{ value: data[params[0] as string] }] : [] };
      if (/insert into settings/i.test(sql)) {
        const k = params[0] as string;
        data[k] = (data[k] ?? 0) + Number(params[1]);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}
const NOW = new Date("2026-11-28T12:00:00Z");
const fakeClient = (caption: string, usage = { input_tokens: 400, output_tokens: 40 }, stop = "end_turn") =>
  ({ messages: { parse: async () => ({ stop_reason: stop, parsed_output: { caption }, usage }) } }) as never;

describe("composed template captions pass the caption lint", () => {
  it("every group x platform x 60 seeds: no lint errors, <= 1 emoji, tag limits", () => {
    for (const g of CAPTION_GROUPS) {
      for (const p of ["instagram", "tiktok", "youtube"] as Platform[]) {
        for (let i = 0; i < 60; i++) {
          const text = composeTemplateCaption({ group: g, platform: p, seed: `lint-${i}` })!;
          const r = lintText({ text, kind: "caption", platform: p, pillar: g === "gym" || g === "running" || g === "meal" || g === "lifestyle" ? g : null });
          expect(r.issues.filter((x) => x.severity === "error"), text).toEqual([]);
          expect(extractHashtags(text).length).toBeLessThanOrEqual(p === "youtube" ? 3 : 5);
        }
      }
    }
  });
  it("every bank line alone passes the caption lint", () => {
    for (const g of CAPTION_GROUPS) {
      for (const t of [...CAPTION_BANK[g].hooks, ...CAPTION_BANK[g].bodies, ...CAPTION_BANK[g].ctas]) {
        expect(lintText({ text: `${t}\n\n#gym #discipline #collegefitness`, kind: "caption", platform: "instagram" }).issues.filter((x) => x.severity === "error"), t).toEqual([]);
      }
    }
  });
});

describe("composeCaption (AI)", () => {
  const base = { group: "gym" as const, platform: "instagram" as const, seed: "s1", recentCaptions: [] as string[] };
  it("no key: template, no spend", async () => {
    const db = fakeDb();
    const r = await composeCaption(base, { db, now: NOW });
    expect(r.source).toBe("template");
    expect(db.data).toEqual({});
  });
  it("key: uses the model text, appends bank hashtags, records spend", async () => {
    const db = fakeDb();
    const lines: string[] = [];
    const r = await composeCaption(base, { apiKey: "k", db, now: NOW, log: (l) => lines.push(l), client: fakeClient("Slow reps and no ego today…\nKept it simple.") });
    expect(r.source).toBe("ai");
    expect(r.caption).toMatch(/^Slow reps and no ego today…\nKept it simple\.\n\n(#\w+ ?){3,5}$/);
    expect(db.data[spendKey(NOW)]).toBeCloseTo(usageCents({ inputTokens: 400, outputTokens: 40 }), 3);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("k\n");
  });
  it("falls back to the template on: refusal, bad output (digits, similar, place), error, over budget", async () => {
    const db = fakeDb();
    for (const client of [
      fakeClient("x", undefined, "refusal"),
      fakeClient("Hit 225 for reps today"),
      fakeClient("Wow, great day!"),
      fakeClient("Training at Gold Gym Downtown"),
      { messages: { parse: async () => { throw new Error("boom"); } } } as never,
    ]) {
      const r = await composeCaption(base, { apiKey: "k", db, now: NOW, client });
      expect(r.source).toBe("template");
    }
    const full = fakeDb({ [spendKey(NOW)]: 500 });
    let called = false;
    const r = await composeCaption(base, { apiKey: "k", db: full, now: NOW, client: { messages: { parse: async () => { called = true; return {}; } } } as never });
    expect(called).toBe(false);
    expect(r.source).toBe("template");
  });
  it("rejects AI text that resembles a recent caption", () => {
    const recent = ["Slow reps and no ego today…\nKept it simple.\n\n#gym #gymbro #discipline"];
    expect(finishAiCaption("Slow reps and no ego today…\nKept it simple.", { ...base, recentCaptions: recent })).toBeNull();
  });
  it("spend helpers", async () => {
    const db = fakeDb();
    expect(await readSpendCents(db, NOW)).toBe(0);
    await addSpendCents(db, NOW, 1.5);
    await addSpendCents(db, NOW, 2);
    expect(await readSpendCents(db, NOW)).toBe(3.5);
    expect(spendKey(NOW)).toBe("ai_caption_spend_2026-11");
  });
});
