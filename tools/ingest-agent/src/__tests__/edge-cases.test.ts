import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTransient, withRetry } from "../retry.js";
import { findVideoFiles } from "../scan.js";

// Edge cases found in the 2026-11-11 ingest audit (docs/reports/ingest-count-2026-11-11.md).
describe("findVideoFiles edge cases", () => {
  let root: string;
  const names = () => findVideoFiles([{ path: root, pillar: "gym" }]).map((f) => f.path.slice(root.length + 1).replace(/\\/g, "/")).sort();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "autopilot-edge-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("takes mp4/mov/m4v in any case and nothing else", () => {
    for (const f of ["a.mp4", "b.MP4", "c.mov", "d.MOV", "e.m4v", "f.M4V", "g.avi", "h.mkv", "i.webm", "j.mp4.json", "k.jpg"]) writeFileSync(join(root, f), "");
    expect(names()).toEqual(["a.mp4", "b.MP4", "c.mov", "d.MOV", "e.m4v", "f.M4V"]);
  });

  it("skips posted folders at any depth and in any case, including 'Already Posted'", () => {
    for (const d of ["Physique Check Edits/posted", "Posted", "x/Already Posted", "keep/Posted Ideas"]) {
      mkdirSync(join(root, d), { recursive: true });
      writeFileSync(join(root, d, "v.mp4"), "");
    }
    // "Posted Ideas" isn't a posted folder (the rule is an exact name), so it's kept.
    expect(names()).toEqual(["keep/Posted Ideas/v.mp4"]);
  });

  it("skips hidden files such as macOS '._' sidecars", () => {
    writeFileSync(join(root, "._clip.mp4"), "");
    writeFileSync(join(root, ".clip.mov"), "");
    writeFileSync(join(root, "clip.mp4"), "");
    expect(names()).toEqual(["clip.mp4"]);
  });

  it("several roots, one missing: the rest still scan", () => {
    writeFileSync(join(root, "a.mp4"), "");
    const found = findVideoFiles([
      { path: join(root, "gone"), pillar: "gym" },
      { path: root, pillar: "gym" },
    ]);
    expect(found).toHaveLength(1);
  });
});

describe("withRetry", () => {
  const noSleep = async () => {};
  const tlsError = Object.assign(new Error("58780000:error:0A0003FC:SSL routines:ssl3_read_bytes:ssl/tls alert bad record mac"), {});

  it("recognizes the transient errors seen in practice, not auth/validation ones", () => {
    expect(isTransient(tlsError)).toBe(true); // the real 2026-11-11 R2 upload failure
    expect(isTransient(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransient(new Error("socket hang up"))).toBe(true);
    expect(isTransient(new Error("AccessDenied: invalid credentials"))).toBe(false);
    expect(isTransient(new Error("NoSuchBucket"))).toBe(false);
  });

  it("retries a transient failure and succeeds", async () => {
    let calls = 0;
    const retried: number[] = [];
    const out = await withRetry(
      async () => {
        if (++calls < 2) throw tlsError;
        return "ok";
      },
      { sleep: noSleep, onRetry: (n) => retried.push(n) },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(2);
    expect(retried).toEqual([1]);
  });

  it("gives up after the attempt budget with the last error", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw tlsError; }, { attempts: 3, sleep: noSleep })).rejects.toThrow(/bad record mac/);
    expect(calls).toBe(3);
  });

  it("never retries a non-transient error", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new Error("AccessDenied"); }, { sleep: noSleep })).rejects.toThrow("AccessDenied");
    expect(calls).toBe(1);
  });

  it("backs off exponentially from baseMs", async () => {
    const waits: number[] = [];
    await expect(
      withRetry(async () => { throw tlsError; }, { attempts: 4, baseMs: 100, sleep: async (ms) => { waits.push(ms); } }),
    ).rejects.toThrow();
    expect(waits).toEqual([100, 200, 400]);
  });
});
