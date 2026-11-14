import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE } from "@autopilot/core";
import { computeWarnings, hasBlock, type WarningContext } from "../warnings.js";
import type { BatchItemView, Warning } from "../types.js";
import { makeItem, NOW } from "./fixtures.js";

const ctx = (over: Partial<WarningContext> = {}): WarningContext => ({
  now: NOW,
  cadence: { ...DEFAULT_CADENCE, dailyCaps: { ...DEFAULT_CADENCE.dailyCaps, instagram: 4, youtube: 4, tiktok: 4 } },
  timeZone: "UTC",
  existing: [],
  blocklist: [],
  ...over,
});

const warningsFor = (items: BatchItemView[], c: WarningContext = ctx()) => computeWarnings(items, c);
const one = (item: BatchItemView, c?: WarningContext): Warning[] => warningsFor([item], c).get(item.id) ?? [];
const find = (ws: Warning[], code: Warning["code"]) => ws.filter((w) => w.code === code);

describe("computeWarnings", () => {
  it("a clean draft has no warnings", () => {
    expect(one(makeItem())).toEqual([]);
  });

  it("lint.error: a caption naming a place blocks", () => {
    const ws = one(makeItem({ caption: "Leg day at Riverside Fitness" }));
    const hits = find(ws, "lint.error");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "block", field: "caption", message: "names an identifiable place" });
    expect(hasBlock(ws)).toBe(true);
  });

  it("lint.error: a blocklisted term blocks", () => {
    const ws = one(makeItem({ caption: "back at secretspot again" }), ctx({ blocklist: ["SecretSpot"] }));
    expect(find(ws, "lint.error")[0]).toMatchObject({ severity: "block", message: "contains a blocklisted private term" });
  });

  it("lint.error/lint.warn on a youtube title use field title", () => {
    const ws = one(makeItem({ platform: "youtube", title: "x".repeat(61) + "!" }));
    expect(find(ws, "lint.error")[0]).toMatchObject({ severity: "block", field: "title" });
    expect(find(ws, "lint.warn")[0]).toMatchObject({ severity: "warn", field: "title" });
  });

  it("lint.warn: an exclamation mark warns, does not block", () => {
    const ws = one(makeItem({ caption: "Good session today!" }));
    expect(find(ws, "lint.warn")).toEqual([expect.objectContaining({ severity: "warn", field: "caption" })]);
    expect(hasBlock(ws)).toBe(false);
  });

  it("placeholder: {{P/L}} blocks (once, not doubled by lint)", () => {
    const ws = one(makeItem({ caption: "Closed the week at {{P/L}}." }));
    expect(find(ws, "placeholder")).toEqual([{ code: "placeholder", severity: "block", message: "fill in the {{…}} placeholder", field: "caption" }]);
    expect(ws.filter((w) => w.message.includes("placeholder"))).toHaveLength(1);
  });

  it("placeholder in a youtube title uses field title", () => {
    const ws = one(makeItem({ platform: "youtube", title: "Week {{N}} recap" }));
    expect(find(ws, "placeholder")[0]).toMatchObject({ severity: "block", field: "title" });
  });

  it("time.missing blocks", () => {
    expect(find(one(makeItem({ scheduledFor: null })), "time.missing")[0]).toMatchObject({ severity: "block", field: "time" });
  });

  it("time.past: a past time blocks (and exactly now counts as past)", () => {
    expect(find(one(makeItem({ scheduledFor: "2026-11-12T10:00:00.000Z" })), "time.past")[0]).toMatchObject({ severity: "block", field: "time" });
    expect(find(one(makeItem({ scheduledFor: NOW.toISOString() })), "time.past")).toHaveLength(1);
  });

  it("cap.breach: 5 instagram posts on one local day (cap 4) are all flagged", () => {
    const items = [9, 11, 13, 15, 17].map((h) => makeItem({ scheduledFor: `2026-11-18T${String(h).padStart(2, "0")}:00:00.000Z` }));
    const other = makeItem({ scheduledFor: "2026-11-19T10:00:00.000Z" });
    const map = warningsFor([...items, other]);
    for (const i of items) {
      expect(find(map.get(i.id)!, "cap.breach")).toEqual([
        { code: "cap.breach", severity: "block", message: "instagram: 5 posts on 2026-11-18, cap 4", field: "time" },
      ]);
    }
    expect(map.get(other.id)).toEqual([]);
  });

  it("cap.breach counts existing posts but not rejected items", () => {
    const existing = [10, 11, 13].map((h) => ({ platform: "instagram" as const, scheduledFor: `2026-11-18T${h}:00:00.000Z` }));
    const a = makeItem({ scheduledFor: "2026-11-18T15:00:00.000Z" });
    const b = makeItem({ scheduledFor: "2026-11-18T17:00:00.000Z", status: "rejected" });
    expect(find(warningsFor([a, b], ctx({ existing: existing.slice(0, 3) })).get(a.id)!, "cap.breach")).toHaveLength(0);
    const c = makeItem({ scheduledFor: "2026-11-18T18:00:00.000Z" });
    expect(find(warningsFor([a, b, c], ctx({ existing })).get(a.id)!, "cap.breach")).toHaveLength(1);
  });

  it("duplicate.caption warns for same trimmed, case-insensitive caption on the same platform", () => {
    const a = makeItem({ caption: "Same words here." });
    const b = makeItem({ caption: "  same WORDS here.  " });
    const c = makeItem({ caption: "Same words here.", platform: "tiktok", tiktokDraft: false });
    const d = makeItem({ caption: "Same words here.", status: "rejected" });
    const map = warningsFor([a, b, c, d]);
    expect(find(map.get(a.id)!, "duplicate.caption")[0]).toMatchObject({ severity: "warn" });
    expect(find(map.get(b.id)!, "duplicate.caption")).toHaveLength(1);
    expect(find(map.get(c.id)!, "duplicate.caption")).toHaveLength(0);
  });

  it("duplicate.media warns for the same video twice on one platform", () => {
    const a = makeItem({ mediaId: "m1" });
    const b = makeItem({ mediaId: "m1" });
    const c = makeItem({ mediaId: "m1", platform: "youtube", title: "A calm title" });
    const map = warningsFor([a, b, c]);
    expect(find(map.get(a.id)!, "duplicate.media")[0]).toMatchObject({ severity: "warn" });
    expect(find(map.get(c.id)!, "duplicate.media")).toHaveLength(0);
  });

  it("media.qa warns and lists the QA notes", () => {
    const w = find(one(makeItem({ media: { qaWarnings: ["dark frames", "clipped audio"] } })), "media.qa")[0];
    expect(w).toMatchObject({ severity: "warn" });
    expect(w!.message).toContain("dark frames");
    expect(w!.message).toContain("clipped audio");
  });

  it("media.no-clean-file blocks", () => {
    expect(find(one(makeItem({ media: { hasCleanFile: false } })), "media.no-clean-file")).toEqual([
      { code: "media.no-clean-file", severity: "block", message: "no clean file in storage; run touch-up/ingest first" },
    ]);
  });

  it("tiktok.needs-sound warns for a tiktok draft-mode post", () => {
    const caption = "Morning notes #trading #notes #routine";
    expect(find(one(makeItem({ platform: "tiktok", tiktokDraft: true, caption })), "tiktok.needs-sound")[0]).toMatchObject({ severity: "warn" });
    expect(find(one(makeItem({ platform: "tiktok", tiktokDraft: false, caption })), "tiktok.needs-sound")).toHaveLength(0);
  });

  it("yt.over-60s warns for youtube over 60 s only", () => {
    expect(find(one(makeItem({ platform: "youtube", title: "Calm title", media: { durationS: 75 } })), "yt.over-60s")[0]).toMatchObject({ severity: "warn" });
    expect(find(one(makeItem({ platform: "youtube", title: "Calm title", media: { durationS: 60 } })), "yt.over-60s")).toHaveLength(0);
    expect(find(one(makeItem({ platform: "instagram", media: { durationS: 75 } })), "yt.over-60s")).toHaveLength(0);
  });

  it("items not in draft/approved get no warnings", () => {
    for (const status of ["published", "publishing", "queued", "failed", "unknown", "rejected"] as const) {
      expect(one(makeItem({ status, scheduledFor: null, caption: "{{x}} at Riverside Fitness" }))).toEqual([]);
    }
    expect(one(makeItem({ status: "approved", scheduledFor: null })).map((w) => w.code)).toEqual(["time.missing"]);
  });

  it("blocks sort before warns", () => {
    const ws = one(makeItem({ caption: "Good one! {{P/L}}", scheduledFor: null, media: { qaWarnings: ["dark"], hasCleanFile: false } }));
    const sev = ws.map((w) => w.severity);
    expect(sev.indexOf("warn")).toBeGreaterThan(sev.lastIndexOf("block"));
    expect(ws.map((w) => w.code)).toEqual(["placeholder", "time.missing", "media.no-clean-file", "lint.warn", "media.qa"]);
  });
});
