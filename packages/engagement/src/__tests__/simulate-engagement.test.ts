import { describe, expect, it } from "vitest";
import { simulateEngagement } from "../sim/simulate-engagement.js";
import { createFakeTriageClient, DEFAULT_FAKE_RULES } from "../triage-fake.js";

describe("simulateEngagement", () => {
  it("shadow: OK, every invariant 0, nothing sent", async () => {
    const r = await simulateEngagement({ mode: "shadow" });
    expect(r.ok, r.summary).toBe(true);
    expect(r.sent).toBe(0);
    expect(r.replies).toBeGreaterThan(0);
    expect(r.duplicatesIgnored).toBeGreaterThan(0);
    expect(Object.values(r.invariants).every((v) => v === 0)).toBe(true);
    expect(r.summary).toMatch(/^simulate-engagement \(shadow\): OK 200 comments · replies \d+ · hides 0 · flags \d+ · sent 0 · 0 double-replies · 0 limit breaches · 0 location leaks · kill: not tripped$/);
  });

  it("live-fake: OK, sends, retries, one unknown at most once, and the late Action Blocked trips the kill", async () => {
    const r = await simulateEngagement({ mode: "live-fake" });
    expect(r.ok, r.summary).toBe(true);
    expect(r.sent).toBeGreaterThan(0);
    expect(r.killedNow).toMatch(/platform block\/limit signal/);
    expect(r.alerts["engagement-kill"]).toBe(1);
    expect(r.summary).toContain("kill: tripped");
  });

  it("is deterministic per seed", async () => {
    const a = await simulateEngagement({ mode: "live-fake", seed: "s1" });
    const b = await simulateEngagement({ mode: "live-fake", seed: "s1" });
    expect(a.summary).toBe(b.summary);
    expect(a.ok, a.summary).toBe(true);
  });

  const bad = createFakeTriageClient([[/where is this/i, "simple_positive", "Love that trail near the lake"], ...DEFAULT_FAKE_RULES]);

  it("a bad triage that replies to 'where is this?' fails the location/unsafe invariants when the rules are bypassed", async () => {
    const r = await simulateEngagement({ mode: "live-fake", triage: bad, unsafeSkipRules: true });
    expect(r.ok).toBe(false);
    // The rotation may pick a pool line over the leaky draft, but a reply to a location question is always caught.
    expect(r.invariants.unsafeReplies).toBeGreaterThan(0);
    expect(r.summary).toMatch(/FAIL .*FAILED: .*unsafeReplies/);
  });

  it("the same bad triage is caught by preRules/postRules in the normal pipeline", async () => {
    const r = await simulateEngagement({ mode: "live-fake", triage: bad });
    expect(r.ok, r.summary).toBe(true);
  });
});
