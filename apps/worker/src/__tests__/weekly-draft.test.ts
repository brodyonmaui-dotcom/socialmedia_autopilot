import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WEEKLY_DRAFT_CRON,
  WEEKLY_NO_TZ_LINE,
  batchReadyMessage,
  isEligibleClip,
  nextWeekStart,
  pickClips,
  registerWeeklyDraftJob,
  runWeeklyDraftOnce,
  weeklyIngestKey,
  type CronBoss,
  type LibraryClipRow,
} from "../jobs/weekly-draft.js";
import { WEEKLY_REPORT_CRON, WEEKLY_REPORT_NO_TZ_LINE, lastWeekStart, registerWeeklyReportJob, reportReadyMessage } from "../jobs/weekly-report.js";
import { QUEUES } from "../queue.js";

// America/New_York is an arbitrary fixture zone (never the creator's; that lives in .env only).
const TZ = "America/New_York";

const clip = (id: string, over: Partial<LibraryClipRow> = {}): LibraryClipRow => ({
  id,
  pillar: "gym",
  status: "ready",
  r2Key: `library/${id}.mp4`,
  capturedAt: "2026-10-01T12:00:00.000Z",
  createdAt: "2026-10-02T12:00:00.000Z",
  supersededByKeptFix: false,
  undecidedFixCopy: false,
  ...over,
});

describe("pickClips", () => {
  it("skips archived, no clean file, superseded originals, undecided fix copies and recently used clips", () => {
    const rows = [
      clip("archived", { status: "archived", capturedAt: "2026-11-10T00:00:00Z" }),
      clip("no-r2", { r2Key: null, capturedAt: "2026-11-09T00:00:00Z" }),
      clip("empty-r2", { r2Key: "", capturedAt: "2026-11-09T00:00:00Z" }),
      clip("superseded", { supersededByKeptFix: true, capturedAt: "2026-11-08T00:00:00Z" }),
      clip("fix-pending", { undecidedFixCopy: true, capturedAt: "2026-11-08T00:00:00Z" }),
      clip("recent", { capturedAt: "2026-11-07T00:00:00Z" }),
      clip("ok-1", { capturedAt: "2026-11-01T00:00:00Z" }),
      clip("ok-2", { capturedAt: "2026-10-01T00:00:00Z" }),
    ];
    expect(pickClips(rows, { count: 10, recentlyUsed: ["recent"] }).map((r) => r.id)).toEqual(["ok-1", "ok-2"]);
    expect(isEligibleClip(rows[0]!)).toBe(false);
    expect(isEligibleClip(rows[6]!)).toBe(true);
  });

  it("newest first (captured_at, then created_at, then id), round-robin across pillars in first-appearance order", () => {
    const rows = [
      clip("g1", { pillar: "gym", capturedAt: "2026-11-10T00:00:00Z" }),
      clip("g2", { pillar: "gym", capturedAt: "2026-11-09T00:00:00Z" }),
      clip("g3", { pillar: "gym", capturedAt: "2026-11-08T00:00:00Z" }),
      clip("m1", { pillar: "meal", capturedAt: "2026-11-07T00:00:00Z" }),
      clip("t1", { pillar: "trading", capturedAt: "2026-11-06T00:00:00Z" }),
      clip("t2", { pillar: "trading", capturedAt: null, createdAt: "2026-11-11T00:00:00Z" }),
      clip("m2b", { pillar: "meal", capturedAt: "2026-11-05T00:00:00Z", createdAt: "2026-11-05T00:00:00Z" }),
      clip("m2a", { pillar: "meal", capturedAt: "2026-11-05T00:00:00Z", createdAt: "2026-11-05T00:00:00Z" }),
    ];
    // sorted: g1 g2 g3 m1 t1 m2a m2b t2(null capture last) → pillars gym, meal, trading
    expect(pickClips(rows, { count: 8, recentlyUsed: [] }).map((r) => r.id)).toEqual(["g1", "m1", "t1", "g2", "m2a", "t2", "g3", "m2b"]);
    expect(pickClips(rows, { count: 4, recentlyUsed: [] }).map((r) => r.id)).toEqual(["g1", "m1", "t1", "g2"]);
  });

  it("is deterministic: input order doesn't matter, and the input isn't mutated", () => {
    const rows = Array.from({ length: 12 }, (_, i) => clip(`c${String(i).padStart(2, "0")}`, { pillar: ["a", "b", "c"][i % 3]!, capturedAt: `2026-11-${String(1 + (i % 5)).padStart(2, "0")}T00:00:00Z` }));
    const before = rows.map((r) => r.id);
    const a = pickClips(rows, { count: 7, recentlyUsed: new Set(["c03"]) }).map((r) => r.id);
    const b = pickClips([...rows].reverse(), { count: 7, recentlyUsed: new Set(["c03"]) }).map((r) => r.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(7);
    expect(a).not.toContain("c03");
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("empty library → nothing; count 0 → nothing", () => {
    expect(pickClips([], { count: 7, recentlyUsed: [] })).toEqual([]);
    expect(pickClips([clip("x")], { count: 0, recentlyUsed: [] })).toEqual([]);
  });
});

describe("week + text helpers", () => {
  it("nextWeekStart is the creator-local Monday after now (a Monday maps to next week)", () => {
    expect(nextWeekStart(new Date("2026-11-22T23:00:00Z"), TZ)).toBe("2026-11-23"); // Sun 18:00 local
    expect(nextWeekStart(new Date("2026-11-23T03:00:00Z"), TZ)).toBe("2026-11-23"); // Sun 22:00 local, Mon in UTC
    expect(nextWeekStart(new Date("2026-11-23T13:00:00Z"), TZ)).toBe("2026-11-30"); // Mon 08:00 local
  });
  it("lastWeekStart is the Monday of the finished week", () => {
    expect(lastWeekStart(new Date("2026-11-23T13:00:00Z"), TZ)).toBe("2026-11-16"); // Mon 08:00 local
    expect(lastWeekStart(new Date("2026-11-23T03:00:00Z"), TZ)).toBe("2026-11-09"); // still Sunday locally
  });
  it("messages hold counts and the week date only", () => {
    expect(batchReadyMessage("2026-11-23", 5, 15)).toBe("Next week (from 2026-11-23): 5 clips added, 15 posts need captions");
    expect(batchReadyMessage("2026-11-23", 1, 1)).toBe("Next week (from 2026-11-23): 1 clip added, 1 post needs captions");
    expect(reportReadyMessage("2026-11-16", 18)).toBe("Last week's report is ready (from 2026-11-16): 18 posts published");
    expect(reportReadyMessage("2026-11-16", 1)).toBe("Last week's report is ready (from 2026-11-16): 1 post published");
  });
  it("ingest key shape", () => {
    expect(weeklyIngestKey("2026-11-23", "m-1", "youtube")).toBe("weekly:2026-11-23:m-1:youtube");
  });
});

describe("registration", () => {
  const boss = (calls: unknown[][]): CronBoss => ({
    createQueue: async (n) => calls.push(["create", n]),
    work: async (n) => calls.push(["work", n]),
    schedule: async (n, cron, data, opts) => calls.push(["schedule", n, cron, data, opts]),
  });
  const pool = { query: async () => ({ rows: [] }), connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) };

  it("schedules both jobs with pg-boss tz = TZ_CREATOR", async () => {
    const calls: unknown[][] = [];
    expect(await registerWeeklyDraftJob(boss(calls), pool, TZ, () => {})).toBe(true);
    expect(await registerWeeklyReportJob(boss(calls), pool, TZ, () => {})).toBe(true);
    expect(calls).toEqual([
      ["create", QUEUES.weeklyDraft],
      ["work", QUEUES.weeklyDraft],
      ["schedule", QUEUES.weeklyDraft, "0 18 * * 0", {}, { tz: TZ }],
      ["create", QUEUES.weeklyReport],
      ["work", QUEUES.weeklyReport],
      ["schedule", QUEUES.weeklyReport, "0 8 * * 1", {}, { tz: TZ }],
    ]);
    expect(WEEKLY_DRAFT_CRON).toBe("0 18 * * 0");
    expect(WEEKLY_REPORT_CRON).toBe("0 8 * * 1");
  });

  it("no TZ_CREATOR: one log line each, nothing registered", async () => {
    const calls: unknown[][] = [];
    const lines: string[] = [];
    expect(await registerWeeklyDraftJob(boss(calls), pool, undefined, (l) => lines.push(l))).toBe(false);
    expect(await registerWeeklyReportJob(boss(calls), pool, "", (l) => lines.push(l))).toBe(false);
    expect(calls).toEqual([]);
    expect(lines).toEqual([WEEKLY_NO_TZ_LINE, WEEKLY_REPORT_NO_TZ_LINE]);
  });

  it("a run without TZ_CREATOR touches no table", async () => {
    let touched = 0;
    const spy = { query: async () => (touched++, { rows: [] }), connect: async () => (touched++, { query: async () => ({ rows: [] }), release() {} }) };
    const r = await runWeeklyDraftOnce(spy, { timeZone: undefined, log: () => {} });
    expect(r).toMatchObject({ skipped: "no-tz", postsInserted: 0, alertRaised: false });
    expect(touched).toBe(0);
  });
});

describe("static: no platform, network or LLM call in either job", () => {
  for (const f of ["weekly-draft.ts", "weekly-report.ts"]) {
    it(f, () => {
      const src = readFileSync(new URL(`../jobs/${f}`, import.meta.url), "utf8");
      const imports = [...src.matchAll(/^import[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]);
      expect(imports.length).toBeGreaterThan(0);
      // Only time/scheduling helpers, the cadence loader and the queue names: no adapter, SDK or model client.
      for (const i of imports) expect(["@autopilot/core", "@autopilot/db", "../queue.js", "./weekly-draft.js"], i).toContain(i);
      expect(src).not.toMatch(/\bimport\s*\(/);
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/anthropic|openai|createTriage|\.messages\.create/i);
      expect(src).not.toMatch(/\bdelete\s+from\b/i);
      expect(src).not.toMatch(/approved_at\s*=/);
    });
  }
});
