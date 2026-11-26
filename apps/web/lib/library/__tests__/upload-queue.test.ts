import { describe, expect, it } from "vitest";
import { scheduleNote } from "../approve-and-schedule.js";
import {
  backoffMs,
  classifyFiles,
  folderLabel,
  formatBytes,
  isHidden,
  MAX_FILE_BYTES,
  needsPolling,
  progressOf,
  rowStatusFromServer,
  runPool,
  splitParts,
  statusLabel,
  withRetry,
} from "../upload-queue.js";

const MiB = 1024 * 1024;

describe("splitParts", () => {
  it("splits into 8 MiB parts, last holds the rest, 1-based, contiguous", () => {
    const parts = splitParts(20 * MiB, 8 * MiB);
    expect(parts).toEqual([
      { n: 1, start: 0, end: 8 * MiB },
      { n: 2, start: 8 * MiB, end: 16 * MiB },
      { n: 3, start: 16 * MiB, end: 20 * MiB },
    ]);
  });
  it("exact multiple, tiny file, empty file", () => {
    expect(splitParts(16 * MiB, 8 * MiB)).toHaveLength(2);
    expect(splitParts(5, 8 * MiB)).toEqual([{ n: 1, start: 0, end: 5 }]);
    expect(splitParts(0, 8 * MiB)).toEqual([]);
    expect(() => splitParts(10, 0)).toThrow();
  });
  it("progress is the share of bytes sent, clamped", () => {
    expect(progressOf(100, 25, 25)).toBe(0.5);
    expect(progressOf(100, 90, 50)).toBe(1);
    expect(progressOf(0, 0)).toBe(0);
  });
});

describe("withRetry", () => {
  it("retries a part up to 3 times with growing backoff, then succeeds", async () => {
    const waits: number[] = [];
    let calls = 0;
    const out = await withRetry(
      async () => {
        if (++calls < 4) throw new Error("net");
        return "ok";
      },
      { sleep: async (ms) => void waits.push(ms) },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(4);
    expect(waits).toEqual([1000, 2000, 4000]);
  });
  it("gives up after 3 retries", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new Error("net"); }, { sleep: async () => {} })).rejects.toThrow("net");
    expect(calls).toBe(4);
  });
  it("stops at once when asked (cancel)", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new Error("x"); }, { sleep: async () => {}, shouldStop: () => true })).rejects.toThrow("x");
    expect(calls).toBe(1);
  });
  it("backoff is capped", () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });
});

describe("runPool", () => {
  it("never runs more than the limit at once and runs everything, in order of start", async () => {
    let live = 0;
    let peak = 0;
    const started: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n);
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
    });
    expect(peak).toBe(2);
    expect(started).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("stops starting new work once stopped", async () => {
    const ran: number[] = [];
    let stop = false;
    await runPool([1, 2, 3, 4], 1, async (n) => {
      ran.push(n);
      if (n === 2) stop = true;
    }, () => stop);
    expect(ran).toEqual([1, 2]);
  });
});

describe("folders and ignore rules", () => {
  it("folder label is the parent directory name", () => {
    expect(folderLabel("Upper body/day 1/clip.mp4")).toBe("day 1");
    expect(folderLabel("Physique/clip.mp4")).toBe("Physique");
    expect(folderLabel("clip.mp4")).toBeNull();
    expect(folderLabel("")).toBeNull();
    expect(folderLabel(undefined)).toBeNull();
  });
  it("dotfiles anywhere in the path are hidden", () => {
    expect(isHidden({ name: ".DS_Store" })).toBe(true);
    expect(isHidden({ name: "._clip.mp4", relPath: "A/._clip.mp4" })).toBe(true);
    expect(isHidden({ name: "clip.mp4", relPath: "A/.hidden/clip.mp4" })).toBe(true);
    expect(isHidden({ name: "clip.mp4", relPath: "A/clip.mp4" })).toBe(false);
  });
  it("keeps mp4/mov/m4v (or video/*), ignores the rest and counts them", () => {
    const out = classifyFiles([
      { name: "a.mp4", size: 10, type: "video/mp4", relPath: "F/a.mp4" },
      { name: "b.MOV", size: 10, type: "" },
      { name: "c.m4v", size: 10, type: "video/x-m4v" },
      { name: "notes.txt", size: 10, type: "text/plain" },
      { name: ".DS_Store", size: 10, type: "" },
      { name: "._a.mp4", size: 10, type: "video/mp4" },
      { name: "empty.mp4", size: 0, type: "video/mp4" },
      { name: "huge.mp4", size: MAX_FILE_BYTES + 1, type: "video/mp4" },
      { name: "thumb.jpg", size: 10, type: "image/jpeg" },
    ]);
    expect(out.accepted.map((f) => f.name)).toEqual(["a.mp4", "b.MOV", "c.m4v"]);
    expect(out.ignored).toBe(6);
    expect(out.overLimit).toBe(0);
  });
  it("respects the 200-file room", () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ name: `v${i}.mp4`, size: 1, type: "video/mp4" }));
    const out = classifyFiles(files, 3);
    expect(out.accepted).toHaveLength(3);
    expect(out.overLimit).toBe(2);
  });
});

describe("labels", () => {
  it("status labels", () => {
    expect(statusLabel({ status: "waiting", progress: 0 })).toBe("Waiting");
    expect(statusLabel({ status: "uploading", progress: 0.449 })).toBe("Uploading 45%");
    expect(statusLabel({ status: "processing", progress: 1 })).toBe("Processing");
    expect(statusLabel({ status: "already", progress: 0 })).toBe("Already in your library");
    expect(statusLabel({ status: "duplicate", progress: 1 })).toBe("Duplicate");
    expect(statusLabel({ status: "failed", progress: 0.2 })).toBe("Failed");
  });
  it("server statuses map to rows; only processing rows are polled", () => {
    expect(["done", "duplicate", "failed", "aborted", "uploaded", "processing"].map(rowStatusFromServer)).toEqual(["done", "duplicate", "failed", "cancelled", "processing", "processing"]);
    expect(needsPolling([{ status: "processing", uploadId: "a" }, { status: "done", uploadId: "b" }, { status: "processing" }])).toEqual(["a"]);
  });
  it("sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(5 * MiB)).toBe("5.0 MB");
    expect(formatBytes(200 * MiB)).toBe("200 MB");
    expect(formatBytes(3 * 1024 * MiB)).toBe("3.0 GB");
  });
});

describe("scheduleNote", () => {
  it("reports scheduled and left-as-draft posts", () => {
    const stayed = [{ itemId: "x", platform: "tiktok" as const, reason: "needs a caption" }];
    expect(scheduleNote({ scheduled: 5, stayed, skipped: 0 })).toBe("Scheduled 5 posts · 1 left as a draft (needs a caption)");
    expect(scheduleNote({ scheduled: 1, stayed: [], skipped: 2 })).toBe("Scheduled 1 post · 2 skipped (already scheduled)");
    expect(scheduleNote({ scheduled: 0, stayed, skipped: 0 })).toContain("Nothing scheduled");
    expect(scheduleNote({ scheduled: 0, stayed: [], skipped: 0 }, false)).toMatch(/^Saved as drafts/);
  });
});
