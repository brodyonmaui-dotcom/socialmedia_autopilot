import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE, localToUtc } from "@autopilot/core";
import { lintText } from "@autopilot/research";
import { runReady, readySummaryLine, type ReadyDeps, type ReadyFs } from "../ready/run.js";
import type { WriteInput } from "../ready/write.js";

const TZ = "America/New_York";
const DIR = join("ready-to-post");
const DONE = join(DIR, "_ingested");

const sidecarJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    pillar: "workout-log",
    platforms: ["instagram", "tiktok"],
    when: "today",
    caption: { instagram: "leg day", tiktok: "legs" },
    soundInApp: false,
    approvedInEditor: "2026-11-18T15:00:00Z",
    source: "workout-assembly",
    ...over,
  });

/** In-memory folder: path → content. */
function memFs(files: Record<string, string>): ReadyFs & { files: Map<string, string> } {
  const m = new Map(Object.entries(files));
  return {
    files: m,
    list: (dir) => [...m.keys()].filter((p) => dirname(p) === dir).map((p) => p.slice(dir.length + 1)),
    readText: (p) => {
      const v = m.get(p);
      if (v === undefined) throw new Error("ENOENT");
      return v;
    },
    exists: (p) => m.has(p) || [...m.keys()].some((k) => dirname(k) === p),
    mkdir: () => {},
    rename: (from, to) => {
      const v = m.get(from);
      if (v === undefined) throw new Error("ENOENT");
      m.delete(from);
      m.set(to, v);
    },
  };
}

function setup(files: Record<string, string>, over: Partial<ReadyDeps> = {}, dbOver: Partial<ReadyDeps["db"]> = {}) {
  const fs = memFs(files);
  const keys = new Set<string>();
  const calls: string[] = [];
  const writes: WriteInput[] = [];
  const lines: string[] = [];
  const d: ReadyDeps = {
    dir: DIR,
    dryRun: false,
    timeZone: TZ,
    now: () => localToUtc("2026-11-18", "12:00", TZ),
    fs,
    hash: async (p) => `hash-${p.split(/[\\/]/).pop()}-0123456789`,
    runQa: async () => {
      calls.push("qa");
      return { probe: { width: 1080, height: 1920, fps: 30, durationS: 20, hasAudio: true, hasLocationTags: false }, blackSegments: [], frozenSegments: [], warnings: [] };
    },
    touchUp: async () => void calls.push("touchUp"),
    locationTagKeys: async () => (calls.push("locationTagKeys"), []),
    upload: async (key) => void calls.push(`upload ${key}`),
    headObject: async () => (calls.push("head"), { size: 1234 }),
    tmpDir: () => "tmp",
    cleanup: () => void calls.push("cleanup"),
    db: {
      existingKeys: async (ks) => ks.filter((k) => keys.has(k)),
      loadCadence: async () => DEFAULT_CADENCE,
      existingPosts: async () => [],
      upsertMedia: async () => (calls.push("media"), "media-1"),
      writeItems: async (input) => {
        calls.push("write");
        writes.push(input);
        const inserted = input.items.filter((i) => !keys.has(i.ingestKey)).map((i) => ({ id: `id-${i.ingestKey}`, platform: i.platform, batchId: "b1" }));
        for (const i of input.items) keys.add(i.ingestKey);
        return { inserted, existing: [] };
      },
      ...dbOver,
    },
    lint: (text, kind, platform) => lintText({ text, kind, platform }),
    log: (l) => lines.push(l),
    ...over,
  };
  return { d, fs, keys, calls, writes, lines };
}

const pair = (name = "clip", sc = sidecarJson()) => ({ [join(DIR, `${name}.mp4`)]: "video", [join(DIR, `${name}.post.json`)]: sc });
const inPlace = (fs: { files: Map<string, string> }, name = "clip") => fs.files.has(join(DIR, `${name}.mp4`)) && fs.files.has(join(DIR, `${name}.post.json`));

describe("runReady", () => {
  it("success: QA → strip → location check → upload → HEAD → media → write, then both files move", async () => {
    const { d, fs, calls, writes, lines } = setup(pair());
    const s = await runReady(d);
    expect(s).toEqual({ new: 1, skipped: 0, wait: 0, fail: 0 });
    expect(calls).toEqual(["qa", "touchUp", "locationTagKeys", "upload library/hash-clip.mp4-0123456789.mp4", "head", "media", "cleanup", "write"]);
    expect(writes[0]!.items.map((i) => i.platform)).toEqual(["instagram", "tiktok"]);
    expect(writes[0]!.mediaId).toBe("media-1");
    expect(inPlace(fs)).toBe(false);
    expect(fs.files.has(join(DONE, "clip.mp4")) && fs.files.has(join(DONE, "clip.post.json"))).toBe(true);
    expect(lines[0]).toMatch(/^NEW clip\.mp4 · workout-log · instagram 2026-11-18 13:00, tiktok 2026-11-18 13:00 · 2 draft item\(s\)$/);
    expect(lines.join("\n")).not.toContain("leg day"); // no caption text in output
    expect(readySummaryLine(s)).toBe("ingest:ready: 1 new · 0 skipped · 0 wait · 0 fail");
  });

  it("second run of the same render → SKIP, no upload, files moved", async () => {
    const { d, fs, keys, calls, lines } = setup(pair());
    keys.add("hash-clip.mp4-0123456789:instagram").add("hash-clip.mp4-0123456789:tiktok");
    expect(await runReady(d)).toEqual({ new: 0, skipped: 1, wait: 0, fail: 0 });
    expect(calls).toEqual([]);
    expect(lines).toEqual(["SKIP clip.mp4 (already ingested)"]);
    expect(fs.files.has(join(DONE, "clip.mp4"))).toBe(true);
  });

  it("running twice end to end: second pass sees nothing left; re-dropped render SKIPs and gets -<hash8>", async () => {
    const { d, fs, writes, lines } = setup(pair());
    await runReady(d);
    expect(await runReady(d)).toEqual({ new: 0, skipped: 0, wait: 0, fail: 0 });
    fs.files.set(join(DIR, "clip.mp4"), "video");
    fs.files.set(join(DIR, "clip.post.json"), sidecarJson());
    expect(await runReady(d)).toMatchObject({ skipped: 1 });
    expect(writes).toHaveLength(1);
    expect(fs.files.has(join(DONE, "clip-hash-cli.mp4")) && fs.files.has(join(DONE, "clip-hash-cli.post.json"))).toBe(true);
    expect(lines.at(-1)).toBe("SKIP clip.mp4 (already ingested)");
  });

  it("mp4 without a sidecar → WAIT, untouched; dot-files and _ingested ignored", async () => {
    const { d, fs, calls, lines } = setup({ [join(DIR, "half.mp4")]: "v", [join(DIR, ".hidden.mp4")]: "v", [join(DONE, "old.mp4")]: "v", [join(DONE, "old.post.json")]: "{}" });
    expect(await runReady(d)).toEqual({ new: 0, skipped: 0, wait: 1, fail: 0 });
    expect(lines).toEqual(["WAIT half.mp4 (no half.post.json yet)"]);
    expect(calls).toEqual([]);
    expect(fs.files.has(join(DIR, "half.mp4"))).toBe(true);
  });

  it("invalid sidecar → FAIL with the zod path, files stay, nothing uploaded", async () => {
    const { d, fs, calls, lines } = setup(pair("clip", sidecarJson({ when: "someday" })));
    expect(await runReady(d)).toMatchObject({ fail: 1 });
    expect(lines[0]).toMatch(/^FAIL clip\.mp4: when: /);
    expect(calls).toEqual([]);
    expect(inPlace(fs)).toBe(true);
    const bad = setup(pair("clip", "{not json"));
    await runReady(bad.d);
    expect(bad.lines[0]).toMatch(/^FAIL clip\.mp4: sidecar \(not valid JSON/);
  });

  it("failed upload → FAIL upload, files stay, no DB write", async () => {
    const { d, fs, calls, lines } = setup(pair(), { upload: async () => { throw new Error("socket hang up"); } });
    expect(await runReady(d)).toMatchObject({ new: 0, fail: 1 });
    expect(lines[0]).toBe("FAIL clip.mp4: upload (socket hang up)");
    expect(calls).not.toContain("media");
    expect(calls).not.toContain("write");
    expect(calls).toContain("cleanup");
    expect(inPlace(fs)).toBe(true);
  });

  it("HEAD size 0 (or missing) → FAIL verify-upload, files stay, no DB write", async () => {
    for (const head of [{ size: 0 }, null]) {
      const { d, fs, calls, lines } = setup(pair(), { headObject: async () => head });
      expect(await runReady(d)).toMatchObject({ fail: 1 });
      expect(lines[0]).toMatch(/^FAIL clip\.mp4: verify-upload/);
      expect(calls).not.toContain("media");
      expect(calls).not.toContain("write");
      expect(inPlace(fs)).toBe(true);
    }
  });

  it("failed DB write → FAIL db-write, files stay", async () => {
    const { d, fs, lines } = setup(pair(), {}, { writeItems: async () => { throw new Error("deadlock detected"); } });
    expect(await runReady(d)).toMatchObject({ fail: 1 });
    expect(lines[0]).toBe("FAIL clip.mp4: db-write (deadlock detected)");
    expect(inPlace(fs)).toBe(true);
  });

  it("location tag left after strip → FAIL, nothing uploaded, no tag values echoed", async () => {
    const { d, fs, calls, lines } = setup(pair(), { locationTagKeys: async () => ["com.apple.quicktime.location.ISO6709"] });
    expect(await runReady(d)).toMatchObject({ fail: 1 });
    expect(lines[0]).toBe("FAIL clip.mp4: location-check (1 location tag key(s) remain after strip; not uploaded)");
    expect(calls.some((c) => c.startsWith("upload"))).toBe(false);
    expect(calls).not.toContain("write");
    expect(inPlace(fs)).toBe(true);
  });

  it("one bad file doesn't stop the rest", async () => {
    const { d, lines } = setup({ ...pair("a", sidecarJson({ version: 2 })), ...pair("b") });
    expect(await runReady(d)).toEqual({ new: 1, skipped: 0, wait: 0, fail: 1 });
    expect(lines[0]).toMatch(/^FAIL a\.mp4: version: /);
    expect(lines[1]).toMatch(/^NEW b\.mp4/);
  });

  it("--dry-run plans and prints only: no QA, upload, writes or moves", async () => {
    const { d, fs, calls, lines } = setup(pair("clip", sidecarJson({ caption: {} })), { dryRun: true });
    expect(await runReady(d)).toEqual({ new: 1, skipped: 0, wait: 0, fail: 0 });
    expect(calls).toEqual([]);
    expect(inPlace(fs)).toBe(true);
    expect(lines[0]).toBe("WOULD INGEST clip.mp4 · workout-log · instagram 2026-11-18 13:00, tiktok 2026-11-18 13:00 · flags: needs-caption(instagram), needs-caption(tiktok)");
  });
});

describe("static guarantees (ready/*.ts)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = (f: string) => readFileSync(join(here, "..", f), "utf8");
  const files = ["ready/sidecar.ts", "ready/plan.ts", "ready/write.ts", "ready/run.ts", "ready-cli.ts"];
  const sqlOf = (code: string) => [...code.matchAll(/`([^`]*)`/g)].map((m) => m[1]!).filter((s) => /\b(select|insert|update|delete)\b/i.test(s));

  it("no delete statement anywhere", () => {
    for (const f of files) {
      expect(src(f)).not.toMatch(/\bdelete\s+from\b/i);
      for (const sql of sqlOf(src(f))) expect(sql).not.toMatch(/\bdelete\b/i);
    }
  });

  it("never approves: no 'approved' in any write SQL, items insert as 'draft'", () => {
    const sql = sqlOf(src("ready/write.ts"));
    expect(sql.length).toBeGreaterThan(3);
    for (const s of sql) {
      expect(s).not.toMatch(/'approved'|approved_at|approved_session/i);
      expect(s).not.toMatch(/update\s+batches\s+set\s+status/i);
    }
    expect(sql.find((s) => s.includes("insert into batch_items"))).toMatch(/'draft', 'editor'/);
    for (const f of files) expect(src(f)).not.toMatch(/planTransition|approveBatch|\.apply\(/);
  });
});
