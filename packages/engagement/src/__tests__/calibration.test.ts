// Run 4 triage calibration: ~160 invented, labelled comments through pre-rules → fake triage model →
// post-rules → planner. Hard gate: zero false negatives on location and hide. Promo is always
// spam_promo with no action at all. Plain praise is (almost) never flagged.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dmPromoVerdict } from "../dm.js";
import { planActions } from "../planner.js";
import { postRules, preRules } from "../rules.js";
import { DEFAULT_ENGAGEMENT } from "../settings.js";
import { createFakeTriageClient } from "../triage-fake.js";
import { MemoryEngagementStore } from "../testing/fake-store.js";
import type { Bucket, EngagementSettings, InboundComment, PlannedAction, PromoAccount, TriageResult } from "../types.js";

type Label = "praise" | "promo" | "location" | "business" | "question" | "negative" | "hide";
interface Fixture { label: Label; text: string; kind?: "dm"; author?: string }

const fixtures = (JSON.parse(readFileSync(new URL("./fixtures/realistic-comments.json", import.meta.url), "utf8")) as { comments: Fixture[] }).comments;
const PROMO_LIST: PromoAccount[] = [{ platform: "instagram", authorKey: "spam_repeat_7" }];
const BLOCKLIST = ["fooville"]; // test-only private term
const NOW = new Date("2026-01-05T15:00:00Z");
// Both platforms live (hide on) so the planner shows everything it would do; still nothing is sent here.
const settings: EngagementSettings = { ...DEFAULT_ENGAGEMENT, mode: { instagram: "live", youtube: "live", tiktok: "off" }, hideEnabled: { instagram: true, youtube: true, tiktok: false } };
const model = createFakeTriageClient();

async function run(f: Fixture, i: number): Promise<{ t: TriageResult; plan: PlannedAction[] }> {
  const c: InboundComment = {
    platform: "instagram", platformCommentId: `cal-${i}`, platformMediaId: "m", authorId: null,
    ...(f.author ? { authorHandle: f.author } : { authorHandle: `fan_${i}` }),
    text: f.text, createdAt: NOW.toISOString(), isOwn: false, ownRepliesInThread: [],
  };
  const hit = preRules(c, BLOCKLIST, { promoAccounts: PROMO_LIST });
  const t: TriageResult = hit
    ? { bucket: hit.bucket, reply: null, confidence: 1, reasons: [hit.reason], model: "rules" }
    : postRules(await model.triage(c, {}), c, BLOCKLIST);
  return { t, plan: await planActions(c, t, settings, new MemoryEngagementStore(), NOW) };
}

const FLAGGED: ReadonlySet<Bucket> = new Set(["flag", "hide_flag"]);

describe("triage calibration (realistic fixtures)", () => {
  it("has ~160 labelled fixtures in every category", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(150);
    const n = (l: Label) => fixtures.filter((f) => f.label === l).length;
    expect(n("praise")).toBeGreaterThanOrEqual(55);
    expect(n("promo")).toBeGreaterThanOrEqual(25);
    expect(n("location")).toBeGreaterThanOrEqual(20);
    expect(n("business")).toBeGreaterThanOrEqual(15);
    expect(n("question")).toBeGreaterThanOrEqual(20);
    expect(n("negative")).toBeGreaterThanOrEqual(10);
    expect(n("hide")).toBeGreaterThanOrEqual(10);
  });

  it("meets the gates and prints one confusion line", async () => {
    const confusion: Record<Label, Partial<Record<Bucket, number>>> = { praise: {}, promo: {}, location: {}, business: {}, question: {}, negative: {}, hide: {} };
    const misses: Record<string, string[]> = {};
    const miss = (k: string, f: Fixture, t: TriageResult) => (misses[k] ??= []).push(`${JSON.stringify(f.text)} → ${t.bucket} (${t.reasons.join("; ")})`);
    let promoActions = 0;
    for (const [i, f] of fixtures.entries()) {
      const { t, plan } = await run(f, i);
      confusion[f.label][t.bucket] = (confusion[f.label][t.bucket] ?? 0) + 1;
      if (f.label === "praise" && (FLAGGED.has(t.bucket) || t.bucket === "spam_promo")) miss("praise flagged", f, t);
      if (f.label === "promo") {
        if (t.bucket !== "spam_promo") miss("promo missed", f, t);
        promoActions += plan.filter((p) => p.kind !== "none").length;
      }
      if (f.label === "location" && (!FLAGGED.has(t.bucket) || plan.some((p) => p.kind === "reply"))) miss("location not flagged", f, t);
      if (f.label === "hide" && t.bucket !== "hide_flag") miss("hide not hide_flag", f, t);
      if ((f.label === "business" || f.label === "question") && !FLAGGED.has(t.bucket)) miss(`${f.label} not flagged`, f, t);
    }
    const count = (l: Label) => fixtures.filter((f) => f.label === l).length;
    const pct = (bad: number, l: Label) => (1 - bad / count(l)) * 100;
    const m = (k: string) => misses[k]?.length ?? 0;
    const line = (Object.keys(confusion) as Label[])
      .map((l) => `${l} ${Object.entries(confusion[l]).map(([b, n]) => `${b}=${n}`).join("/")}`)
      .join(" · ");
    console.log(
      `calibration: ${fixtures.length} comments · praise ok ${pct(m("praise flagged"), "praise").toFixed(1)}% · promo ${count("promo") - m("promo missed")}/${count("promo")} · ` +
        `location ${count("location") - m("location not flagged")}/${count("location")} · hide ${count("hide") - m("hide not hide_flag")}/${count("hide")} · ` +
        `business ${pct(m("business not flagged"), "business").toFixed(0)}% · questions ${pct(m("question not flagged"), "question").toFixed(0)}% · ${line}`,
    );

    // Hard gates first (zero false negatives).
    expect(misses["location not flagged"] ?? []).toEqual([]);
    expect(misses["hide not hide_flag"] ?? []).toEqual([]);
    expect(misses["promo missed"] ?? []).toEqual([]);
    expect(promoActions).toBe(0);
    // Rates.
    expect(pct(m("praise flagged"), "praise"), (misses["praise flagged"] ?? []).join("\n")).toBeGreaterThanOrEqual(95);
    expect(pct(m("business not flagged"), "business"), (misses["business not flagged"] ?? []).join("\n")).toBeGreaterThanOrEqual(90);
    expect(pct(m("question not flagged"), "question"), (misses["question not flagged"] ?? []).join("\n")).toBeGreaterThanOrEqual(90);
  });

  it("promo DMs are caught by the same rule (DM path)", () => {
    for (const f of fixtures.filter((x) => x.kind === "dm")) {
      const v = dmPromoVerdict({ platformThreadId: "t", participantId: "p", handle: "page_x", messages: [{ id: "m1", dir: "in", text: f.text, at: NOW.toISOString() }] });
      expect(v?.bucket, f.text).toBe("spam_promo");
    }
  });

  it("plain fan DMs and replied-to threads are not promo", () => {
    const fan = { platformThreadId: "t", participantId: "p", messages: [{ id: "m1", dir: "in" as const, text: "love your videos man", at: NOW.toISOString() }] };
    expect(dmPromoVerdict(fan)).toBeNull();
    const answered = { ...fan, messages: [{ id: "m1", dir: "in" as const, text: "DM us to be featured", at: NOW.toISOString() }, { id: "m2", dir: "out" as const, text: "no thanks", at: NOW.toISOString() }] };
    expect(dmPromoVerdict(answered)).toBeNull();
  });
});
