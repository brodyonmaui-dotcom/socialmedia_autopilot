import { describe, expect, it } from "vitest";
import { CAPTION_TEMPLATES, CAPTION_GROUPS } from "@autopilot/core";
import { lintText } from "@autopilot/research";
import { QUEUES } from "../queue.js";
import { DAILY_INSTAGRAM_CRON, dailyReadyMessage, pickDailyClips, registerDailyInstagramJob } from "../jobs/daily-instagram.js";
import type { CronBoss, LibraryClipRow } from "../jobs/weekly-draft.js";

const clip = (id: string, pillar: string | null, day: number): LibraryClipRow => ({
  id,
  pillar,
  status: "ready",
  r2Key: `k/${id}`,
  capturedAt: `2109-01-${String(day).padStart(2, "0")}T12:00:00Z`,
  createdAt: "2109-02-01T00:00:00Z",
  supersededByKeptFix: false,
  undecidedFixCopy: false,
});

describe("caption templates pass the caption lint", () => {
  for (const g of CAPTION_GROUPS) {
    it(g, () => {
      for (const text of CAPTION_TEMPLATES[g]) {
        const r = lintText({ text, kind: "caption", platform: "instagram", pillar: g === "gym" || g === "running" || g === "meal" || g === "lifestyle" ? g : null });
        expect(r.issues, text).toEqual([]);
        expect(r.ok, text).toBe(true);
      }
    });
  }
});

describe("pickDailyClips", () => {
  it("gym pillars first, trading skipped, used clips skipped", () => {
    const rows = [clip("a", "yap", 20), clip("b", "workout-log", 1), clip("c", "trade-recap", 25), clip("d", "physique", 2), clip("e", "single-set", 3)];
    expect(pickDailyClips(rows, { count: 2, recentlyUsed: [] }).every((r) => ["b", "d", "e"].includes(r.id))).toBe(true);
    expect(pickDailyClips(rows, { count: 4, recentlyUsed: ["b"] }).map((r) => r.id)).not.toContain("c");
    expect(pickDailyClips(rows, { count: 4, recentlyUsed: ["b"] }).map((r) => r.id)).not.toContain("b");
    const gymFirst = pickDailyClips(rows, { count: 4, recentlyUsed: [] }).map((r) => r.id);
    expect(gymFirst.slice(0, 3).sort()).toEqual(["b", "d", "e"]);
    expect(gymFirst[3]).toBe("a");
  });
  it("message is counts + date only", () => {
    expect(dailyReadyMessage("2110-01-02", 2)).toBe("Tomorrow (2110-01-02): 2 Instagram posts drafted with captions. Approve them in the calendar.");
  });
});

describe("registration", () => {
  const boss = (calls: unknown[][]): CronBoss => ({
    createQueue: async (n) => calls.push(["create", n]),
    work: async (n) => calls.push(["work", n]),
    schedule: async (n, cron, data, opts) => calls.push(["schedule", n, cron, data, opts]),
  });
  const pool = { query: async () => ({ rows: [] }), connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) };
  it("schedules daily 17:00 with tz", async () => {
    const calls: unknown[][] = [];
    expect(await registerDailyInstagramJob(boss(calls), pool, "America/New_York", () => {})).toBe(true);
    expect(calls).toEqual([["create", QUEUES.dailyInstagram], ["work", QUEUES.dailyInstagram], ["schedule", QUEUES.dailyInstagram, "0 17 * * *", {}, { tz: "America/New_York" }]]);
    expect(DAILY_INSTAGRAM_CRON).toBe("0 17 * * *");
  });
  it("no TZ_CREATOR: not scheduled", async () => {
    const calls: unknown[][] = [];
    const lines: string[] = [];
    expect(await registerDailyInstagramJob(boss(calls), pool, undefined, (l) => lines.push(l))).toBe(false);
    expect(calls).toEqual([]);
    expect(lines).toHaveLength(1);
  });
});
