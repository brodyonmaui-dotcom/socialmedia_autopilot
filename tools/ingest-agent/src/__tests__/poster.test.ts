import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backfillSummaryLine, originalCandidates, posterKeyFor, runPosterBackfill, tryPoster, type BackfillDeps, type PosterRow } from "../poster.js";

describe("posterKeyFor", () => {
  it("derives posters/<stem>.jpg from the clean file's key", () => {
    expect(posterKeyFor("library/abc123.mp4")).toBe("posters/abc123.jpg");
    expect(posterKeyFor("demo/demo-0001-gym.mp4")).toBe("posters/demo-0001-gym.jpg");
  });

  it("refuses odd keys (empty, dots, traversal, spaces)", () => {
    expect(posterKeyFor("")).toBeNull();
    expect(posterKeyFor("library/.mp4")).toBeNull();
    expect(posterKeyFor("library/../x y.mp4")).toBeNull();
    expect(posterKeyFor("library/.hidden.mp4")).toBeNull();
    expect(posterKeyFor("library/a..b.mp4")).toBeNull();
  });
});

describe("tryPoster", () => {
  it("never throws: a failure is one POSTER line and null", async () => {
    const lines: string[] = [];
    const key = await tryPoster(
      {
        makePoster: async () => {
          throw new Error("boom\nsecond line with detail");
        },
        uploadPoster: async () => {},
        log: (l) => lines.push(l),
      },
      { videoPath: "/t/clean.mp4", tmpDir: "/t", cleanKey: "library/h.mp4", durationS: 5, name: "a.mp4" },
    );
    expect(key).toBeNull();
    expect(lines).toEqual(["POSTER skipped a.mp4 — boom"]);
  });
});

describe("runPosterBackfill", () => {
  const SRC = join("lib", "gym", "a.mp4");
  const row = (over: Partial<PosterRow> = {}): PosterRow => ({ id: "m1", contentHash: "hash-a-0000", sourcePath: SRC, r2Key: "library/hash-a-0000.mp4", durationS: 10, ...over });

  function deps(files: Record<string, string>, over: Partial<BackfillDeps> = {}) {
    const calls: string[] = [];
    const updates: Array<[string, string]> = [];
    const d: BackfillDeps = {
      write: true,
      rows: [row()],
      exists: (p) => p in files,
      hash: async (p) => files[p]!,
      makePoster: async (from) => void calls.push(`poster ${from}`),
      uploadPoster: async (key) => void calls.push(`upload ${key}`),
      update: async (id, key) => void updates.push([id, key]),
      tmpDir: () => "tmp",
      cleanup: () => void calls.push("cleanup"),
      log: (l) => calls.push(l),
      ...over,
    };
    return { d, calls, updates };
  }

  it("--write: makes from the original, uploads under the derived key, updates the row", async () => {
    const { d, calls, updates } = deps({ [SRC]: "hash-a-0000" });
    const s = await runPosterBackfill(d);
    expect(s).toEqual({ made: 1, missing: 0, failed: 0 });
    expect(calls).toEqual([`poster ${SRC}`, "upload posters/hash-a-0000.jpg", "cleanup"]);
    expect(updates).toEqual([["m1", "posters/hash-a-0000.jpg"]]);
    expect(backfillSummaryLine(s, true)).toBe("posters: made 1, missing-file 0, failed 0");
  });

  it("dry run (default): counts only, makes and writes nothing", async () => {
    const { d, calls, updates } = deps({ [SRC]: "hash-a-0000" }, { write: false, rows: [row(), row({ id: "m2", sourcePath: "gone.mp4" })] });
    const s = await runPosterBackfill(d);
    expect(s).toEqual({ made: 1, missing: 1, failed: 0 });
    expect(calls).toEqual([]);
    expect(updates).toEqual([]);
    expect(backfillSummaryLine(s, false)).toMatch(/^posters \(dry run\): would make 1, missing-file 1, failed 0/);
  });

  it("finds a render moved to _ingested/ (also with the -<hash8> suffix); a file whose hash differs counts as missing", async () => {
    const moved = join("lib", "gym", "_ingested", "a-hash-a-0.mp4");
    expect(originalCandidates(SRC, "hash-a-0000")).toContain(moved);
    const ok = deps({ [moved]: "hash-a-0000" });
    expect(await runPosterBackfill(ok.d)).toEqual({ made: 1, missing: 0, failed: 0 });
    const swapped = deps({ [SRC]: "some-other-hash" });
    expect(await runPosterBackfill(swapped.d)).toEqual({ made: 0, missing: 1, failed: 0 });
    expect(swapped.updates).toEqual([]);
  });

  it("an ffmpeg failure counts as failed, leaves the row alone, and the run continues", async () => {
    const { d, updates } = deps(
      { [SRC]: "hash-a-0000", "b.mp4": "hash-b" },
      {
        rows: [row(), row({ id: "m2", sourcePath: "b.mp4", contentHash: "hash-b", r2Key: null })],
        makePoster: async (from) => {
          if (from === SRC) throw new Error("poster: ffmpeg wrote no frame");
        },
      },
    );
    expect(await runPosterBackfill(d)).toEqual({ made: 1, missing: 0, failed: 1 });
    expect(updates).toEqual([["m2", "posters/hash-b.jpg"]]);
  });
});
