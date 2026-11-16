import { describe, expect, it } from "vitest";
import { createIngestFile, type IngestFileDeps } from "../ingest-file.js";

const file = { path: "/clips/ready/gym/leg-day.mp4", pillar: "gym" };
const qa = { probe: { durationS: 12.3, width: 1080, height: 1920, capturedAt: undefined }, warnings: ["location tag present"] };

function deps(over: Partial<IngestFileDeps> = {}) {
  const uploads: Array<{ key: string; path: string }> = [];
  const inserts: unknown[][] = [];
  const touched: Array<{ from: string; to: string }> = [];
  const posters: Array<{ key: string; path: string }> = [];
  const logs: string[] = [];
  const d: IngestFileDeps = {
    runQa: async () => qa as never,
    touchUp: async (from, { outPath }) => {
      touched.push({ from, to: outPath });
    },
    locationTagKeys: async () => [],
    upload: async (key, path) => {
      uploads.push({ key, path });
    },
    insert: async (row) => {
      inserts.push(row);
    },
    makePoster: async () => {},
    uploadPoster: async (key, path) => {
      posters.push({ key, path });
    },
    log: (line) => {
      logs.push(line);
    },
    tmpDir: () => "/tmp/ingest-test-dir",
    cleanup: () => {},
    ...over,
  };
  return { d, uploads, inserts, touched, posters, logs };
}

describe("createIngestFile (F7 C1/C2)", () => {
  it("uploads only the touched-up copy, never the original path (C2)", async () => {
    const { d, uploads, touched, inserts } = deps();
    const line = await createIngestFile(d)(file, "abc123");
    expect(line).toMatch(/^INGESTED leg-day\.mp4/);
    expect(touched).toEqual([{ from: file.path, to: "/tmp/ingest-test-dir/clean.mp4" }]);
    expect(uploads).toEqual([{ key: "library/abc123.mp4", path: "/tmp/ingest-test-dir/clean.mp4" }]);
    expect(uploads.every((u) => u.path !== file.path)).toBe(true);
    expect(inserts).toHaveLength(1);
  });

  it("re-probes the clean file and refuses the upload if a location tag lingers (C1)", async () => {
    const probed: string[] = [];
    const cleaned: string[] = [];
    const { d, uploads, inserts } = deps({
      locationTagKeys: async (p) => {
        probed.push(p);
        return ["com.apple.quicktime.location.ISO6709"];
      },
      cleanup: (dir) => {
        cleaned.push(dir);
      },
    });
    await expect(createIngestFile(d)(file, "abc123")).rejects.toThrow(/location tag\(s\) remain after strip \(1 key\); not uploaded/);
    expect(probed).toEqual(["/tmp/ingest-test-dir/clean.mp4"]);
    expect(uploads).toEqual([]);
    expect(inserts).toEqual([]); // no row: the next run retries it
    expect(cleaned).toEqual(["/tmp/ingest-test-dir"]);
  });

  it("the refusal message names the key count only, never tag values or the source folder", async () => {
    const { d } = deps({ locationTagKeys: async () => ["location", "location-eng"] });
    const err = (await createIngestFile(d)(file, "h").catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("2 keys");
    expect(err.message).not.toContain("/clips/ready");
  });

  it("makes a poster from the clean copy, uploads it under posters/<hash>.jpg and stores poster_key ($10)", async () => {
    const made: Array<{ from: string; to: string; durationS: number }> = [];
    const { d, posters, inserts } = deps({
      makePoster: async (from, to, o) => {
        made.push({ from, to, durationS: o.durationS });
      },
    });
    await createIngestFile(d)(file, "abc123");
    expect(made).toEqual([{ from: "/tmp/ingest-test-dir/clean.mp4", to: "/tmp/ingest-test-dir/poster.jpg", durationS: 12.3 }]);
    expect(posters).toEqual([{ key: "posters/abc123.jpg", path: "/tmp/ingest-test-dir/poster.jpg" }]);
    expect(inserts[0]![9]).toBe("posters/abc123.jpg");
  });

  it("a poster failure (ffmpeg throws) never fails the ingest: one log line, poster_key null", async () => {
    const { d, uploads, inserts, logs, posters } = deps({
      makePoster: async () => {
        throw new Error("poster: ffmpeg wrote no frame");
      },
    });
    const line = await createIngestFile(d)(file, "abc123");
    expect(line).toMatch(/^INGESTED leg-day\.mp4/);
    expect(uploads).toHaveLength(1);
    expect(posters).toEqual([]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]![9]).toBeNull();
    expect(logs).toEqual(["POSTER skipped leg-day.mp4 — poster: ffmpeg wrote no frame"]);
  });

  it("a poster upload failure also leaves poster_key null and still ingests", async () => {
    const { d, inserts } = deps({
      uploadPoster: async () => {
        throw new Error("network down");
      },
    });
    await createIngestFile(d)(file, "abc123");
    expect(inserts[0]![9]).toBeNull();
  });
});
