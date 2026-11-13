import { describe, expect, it } from "vitest";
import type { Platform } from "@autopilot/core";
import { RESET_CHECKLIST, validatePostUrl } from "../reset.js";
import { planTransition, type BatchAction } from "../transitions.js";
import type { ItemStatus } from "../types.js";
import { makeBatch, makeItem, NOW } from "./fixtures.js";

const all = (p: keyof typeof RESET_CHECKLIST) => [...RESET_CHECKLIST[p]];

/** Every key anywhere in `v`, recursively (objects and arrays). */
function keysDeep(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(keysDeep);
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]);
  return [];
}

describe("RESET_CHECKLIST", () => {
  it("has non-empty, unique entries for the three outbox platforms", () => {
    for (const p of ["instagram", "youtube", "tiktok"] as const) {
      expect(RESET_CHECKLIST[p].length).toBeGreaterThan(0);
      expect(new Set(RESET_CHECKLIST[p]).size).toBe(RESET_CHECKLIST[p].length);
    }
    expect(RESET_CHECKLIST.youtube.join(" ")).toContain("including Private and Scheduled");
    expect(Object.keys(RESET_CHECKLIST)).not.toContain("snapchat");
  });
});

describe("planTransition: reset-checked", () => {
  it("failed IG item with every box and a not-found check → draft, attempts 1, errors cleared, detail kept", () => {
    const a = makeItem({ status: "failed", attempts: 4, lastError: "instagram: 400 media expired", approvedAt: NOW.toISOString() });
    const checked = all("instagram").reverse(); // order-insensitive
    const r = planTransition(makeBatch([a]), { kind: "reset-checked", itemId: a.id, checked, autoCheck: "not-found" }, NOW);
    expect(r).toEqual({
      ok: true,
      batchStatus: "draft",
      skipped: [],
      changes: [{
        itemId: a.id,
        from: "failed",
        to: "draft",
        eventKind: "reset-checked",
        patch: { attempts: 1, last_error: null, next_attempt_at: null },
        detail: { attemptsBefore: 4, lastError: "instagram: 400 media expired", checked: all("instagram"), autoCheck: "not-found" },
      }],
    });
  });

  it("unknown items reset too; IG accepts an 'error' auto check; YT/TikTok take 'n/a'", () => {
    const ig = makeItem({ status: "unknown", attempts: 2 });
    const yt = makeItem({ status: "unknown", platform: "youtube" });
    const tt = makeItem({ status: "failed", platform: "tiktok" });
    const b = makeBatch([ig, yt, tt]);
    expect(planTransition(b, { kind: "reset-checked", itemId: ig.id, checked: all("instagram"), autoCheck: "error" }, NOW)).toMatchObject({
      ok: true, changes: [{ from: "unknown", to: "draft", detail: { autoCheck: "error", attemptsBefore: 2 } }],
    });
    const ry = planTransition(b, { kind: "reset-checked", itemId: yt.id, checked: all("youtube"), autoCheck: "n/a" }, NOW);
    expect(ry).toMatchObject({ ok: true, changes: [{ to: "draft", detail: { checked: all("youtube"), attemptsBefore: null, lastError: null } }] });
    expect(planTransition(b, { kind: "reset-checked", itemId: tt.id, checked: all("tiktok"), autoCheck: "n/a" }, NOW)).toMatchObject({ ok: true });
  });

  it("refused for every other status, with the status in the reason", () => {
    for (const status of ["draft", "approved", "queued", "publishing", "published", "rejected"] as ItemStatus[]) {
      const i = makeItem({ status });
      const r = planTransition(makeBatch([i]), { kind: "reset-checked", itemId: i.id, checked: all("instagram"), autoCheck: "not-found" }, NOW);
      expect(r, status).toMatchObject({ ok: false, itemId: i.id });
      if (!r.ok) expect(r.reason).toContain(status);
    }
  });

  it("refused when the platform already has a post id", () => {
    const i = makeItem({ status: "unknown", platformPostId: "ig-1" });
    const r = planTransition(makeBatch([i]), { kind: "reset-checked", itemId: i.id, checked: all("instagram"), autoCheck: "not-found" }, NOW);
    expect(r).toMatchObject({ ok: false, itemId: i.id, reason: expect.stringContaining("record it as published") });
  });

  it("refused unless every box for that platform is ticked; extra or other-platform entries refused", () => {
    const yt = makeItem({ status: "failed", platform: "youtube" });
    const b = makeBatch([yt]);
    const go = (checked: string[]) => planTransition(b, { kind: "reset-checked", itemId: yt.id, checked, autoCheck: "n/a" }, NOW);
    expect(go([])).toMatchObject({ ok: false });
    expect(go(all("youtube").slice(1))).toMatchObject({ ok: false, reason: expect.stringContaining("tick every") });
    expect(go([...all("youtube"), "something else"])).toMatchObject({ ok: false });
    expect(go([...all("youtube"), all("tiktok")[0]!])).toMatchObject({ ok: false });
    expect(go(all("instagram"))).toMatchObject({ ok: false });
    expect(go([...all("youtube"), ...all("youtube")])).toMatchObject({ ok: true }); // duplicates are harmless
  });

  it("IG needs the automatic check to have run; YT/TikTok refuse an IG-style result; junk refused", () => {
    const ig = makeItem({ status: "failed" });
    const tt = makeItem({ status: "failed", platform: "tiktok" });
    const b = makeBatch([ig, tt]);
    expect(planTransition(b, { kind: "reset-checked", itemId: ig.id, checked: all("instagram"), autoCheck: "n/a" }, NOW)).toMatchObject({ ok: false });
    const bogus = { kind: "reset-checked", itemId: ig.id, checked: all("instagram") } as unknown as BatchAction;
    expect(planTransition(b, bogus, NOW)).toMatchObject({ ok: false });
    const found = { kind: "reset-checked", itemId: ig.id, checked: all("instagram"), autoCheck: "found" } as unknown as BatchAction;
    expect(planTransition(b, found, NOW)).toMatchObject({ ok: false });
    expect(planTransition(b, { kind: "reset-checked", itemId: tt.id, checked: all("tiktok"), autoCheck: "not-found" }, NOW)).toMatchObject({ ok: false });
  });

  it("snapchat is refused (never in the outbox)", () => {
    const s = makeItem({ status: "failed", platform: "snapchat" });
    expect(planTransition(makeBatch([s]), { kind: "reset-checked", itemId: s.id, checked: [], autoCheck: "n/a" }, NOW)).toMatchObject({ ok: false, itemId: s.id });
  });

  it("unknown item id fails", () => {
    expect(planTransition(makeBatch([makeItem()]), { kind: "reset-checked", itemId: "nope", checked: [], autoCheck: "n/a" }, NOW)).toMatchObject({ ok: false, itemId: "nope" });
  });

  it("never mentions the idempotency key anywhere in the result (reset and record)", () => {
    const a = makeItem({ status: "failed", attempts: 4, lastError: "x" });
    const p = makeItem({ status: "unknown" });
    const b = makeBatch([a, p]);
    const r1 = planTransition(b, { kind: "reset-checked", itemId: a.id, checked: all("instagram"), autoCheck: "not-found" }, NOW);
    const r2 = planTransition(b, { kind: "record-published", itemId: p.id, url: "https://www.instagram.com/reel/abc/", platformPostId: "1789" }, NOW);
    for (const r of [r1, r2]) {
      expect(r.ok).toBe(true);
      const keys = keysDeep(r);
      expect(keys.length).toBeGreaterThan(5);
      expect(keys.filter((k) => /idempot/i.test(k))).toEqual([]);
      expect(JSON.stringify(r)).not.toMatch(/idempot/i);
    }
  });

  it("batch stays approved if another item is still scheduled", () => {
    const f = makeItem({ status: "failed", platform: "youtube" });
    const q = makeItem({ status: "queued" });
    expect(planTransition(makeBatch([f, q]), { kind: "reset-checked", itemId: f.id, checked: all("youtube"), autoCheck: "n/a" }, NOW)).toMatchObject({ ok: true, batchStatus: "approved" });
  });
});

describe("planTransition: record-published", () => {
  it("failed/unknown → published with the normalised URL and trimmed id", () => {
    const a = makeItem({ status: "failed", platform: "youtube", attempts: 4, lastError: "timeout" });
    const r = planTransition(makeBatch([a]), { kind: "record-published", itemId: a.id, url: "  https://YouTu.be/abc123#t=3 ", platformPostId: " abc123 " }, NOW);
    expect(r).toEqual({
      ok: true,
      batchStatus: "approved",
      skipped: [],
      changes: [{
        itemId: a.id,
        from: "failed",
        to: "published",
        eventKind: "record-published",
        patch: { platform_post_url: "https://youtu.be/abc123", next_attempt_at: null, platform_post_id: "abc123" },
        detail: { url: "https://youtu.be/abc123", platformPostId: "abc123", attemptsBefore: 4, lastError: "timeout" },
      }],
    });
  });

  it("omits platform_post_id when none (or blank) is given", () => {
    const a = makeItem({ status: "unknown", platform: "tiktok" });
    const r = planTransition(makeBatch([a]), { kind: "record-published", itemId: a.id, url: "https://www.tiktok.com/@someone/video/123", platformPostId: "   " }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.changes[0]!.patch).toEqual({ platform_post_url: "https://www.tiktok.com/@someone/video/123", next_attempt_at: null });
  });

  it("existing post id: same or none supplied is fine, a different one is refused", () => {
    const a = makeItem({ status: "unknown", platformPostId: "ig-1" });
    const b = makeBatch([a]);
    const url = "https://instagram.com/p/xyz/";
    expect(planTransition(b, { kind: "record-published", itemId: a.id, url }, NOW)).toMatchObject({ ok: true, changes: [{ detail: { platformPostId: "ig-1" } }] });
    expect(planTransition(b, { kind: "record-published", itemId: a.id, url, platformPostId: "ig-1" }, NOW)).toMatchObject({ ok: true });
    expect(planTransition(b, { kind: "record-published", itemId: a.id, url, platformPostId: "ig-2" }, NOW)).toMatchObject({ ok: false, itemId: a.id });
  });

  it("refuses odd post ids", () => {
    const a = makeItem({ status: "failed" });
    const r = planTransition(makeBatch([a]), { kind: "record-published", itemId: a.id, url: "https://instagram.com/p/x/", platformPostId: "a b<script>" }, NOW);
    expect(r).toMatchObject({ ok: false });
  });

  it("refused for every other status", () => {
    for (const status of ["draft", "approved", "queued", "publishing", "published", "rejected"] as ItemStatus[]) {
      const i = makeItem({ status });
      expect(planTransition(makeBatch([i]), { kind: "record-published", itemId: i.id, url: "https://instagram.com/p/x/" }, NOW), status).toMatchObject({ ok: false, itemId: i.id });
    }
  });

  it("refuses another platform's host, http:, and lookalikes", () => {
    const a = makeItem({ status: "failed" });
    const b = makeBatch([a]);
    for (const url of ["https://www.youtube.com/shorts/abc", "http://www.instagram.com/p/x/", "https://instagram.com.evil.example/p/x/", "https://evilinstagram.com/p/x/"]) {
      expect(planTransition(b, { kind: "record-published", itemId: a.id, url }, NOW), url).toMatchObject({ ok: false, itemId: a.id });
    }
  });
});

describe("validatePostUrl", () => {
  const ok: Array<[Platform, string]> = [
    ["instagram", "https://www.instagram.com/reel/C0abc/"],
    ["instagram", "https://instagram.com/p/C0abc/?igsh=1"],
    ["youtube", "https://www.youtube.com/shorts/abc"],
    ["youtube", "https://m.youtube.com/watch?v=abc"],
    ["youtube", "https://youtu.be/abc"],
    ["youtube", "https://studio.youtube.com/video/abc/edit"],
    ["youtube", "https://youtube.com/watch?v=abc"],
    ["tiktok", "https://www.tiktok.com/@x/video/1"],
    ["tiktok", "https://tiktok.com/@x/video/1"],
    ["tiktok", "https://m.tiktok.com/v/1.html"],
    ["tiktok", "https://vm.tiktok.com/ZMabc/"],
  ];
  it.each(ok)("accepts %s %s", (p, url) => {
    expect(validatePostUrl(p, url)).toBe(new URL(url).href);
  });

  it("normalises: trims, lowercases the host, drops the fragment, default port", () => {
    expect(validatePostUrl("instagram", " https://WWW.Instagram.COM/p/x/#c ")).toBe("https://www.instagram.com/p/x/");
    expect(validatePostUrl("instagram", "https://instagram.com:443/p/x/")).toBe("https://instagram.com/p/x/");
  });

  const bad: Array<[Platform, string]> = [
    ["instagram", "http://www.instagram.com/p/x/"],
    ["instagram", "https://instagram.com.evil.example/p/x/"],
    ["instagram", "https://evilinstagram.com/p/x/"],
    ["instagram", "https://evil.example/instagram.com/p/x/"],
    ["instagram", "https://user:pw@instagram.com/p/x/"],
    ["instagram", "https://instagram.com@evil.example/p/x/"],
    ["instagram", "https://instagram.com:8443/p/x/"],
    ["instagram", "https://instagram.com./p/x/"],
    ["instagram", "https://instagram.com/"],
    ["instagram", "https://instagram.com"],
    ["instagram", "https://www.youtube.com/shorts/abc"],
    ["instagram", "javascript:alert(1)"],
    ["instagram", "//instagram.com/p/x/"],
    ["instagram", "instagram.com/p/x/"],
    ["instagram", ""],
    ["instagram", `https://instagram.com/p/${"a".repeat(2100)}`],
    ["youtube", "https://www.instagram.com/p/x/"],
    ["youtube", "https://music.youtube.com/watch?v=abc"],
    ["youtube", "https://youtube.com.evil.example/watch?v=abc"],
    ["tiktok", "https://www.youtube.com/shorts/abc"],
    ["tiktok", "https://tiktok.com.evil.example/@x/video/1"],
    ["tiktok", "ftp://tiktok.com/@x/video/1"],
    ["snapchat", "https://www.snapchat.com/spotlight/abc"],
  ];
  it.each(bad)("refuses %s %s", (p, url) => {
    expect(validatePostUrl(p, url)).toBeNull();
  });
});
