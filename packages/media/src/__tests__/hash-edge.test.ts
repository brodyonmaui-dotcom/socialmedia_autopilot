import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findDuplicateSets } from "../dedupe.js";
import { sha256File } from "../hash.js";

describe("sha256File edge cases", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "autopilot-hash-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("a file that disappeared rejects (ENOENT) instead of hanging or hashing nothing", async () => {
    await expect(sha256File(join(dir, "gone.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("an empty file hashes to the well-known empty sha256", async () => {
    writeFileSync(join(dir, "empty.mp4"), "");
    expect(await sha256File(join(dir, "empty.mp4"))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("byte-identical copies under different names hash the same (the ' - Copy.mp4' case) and group as one set", async () => {
    writeFileSync(join(dir, "Day 001.mp4"), "same bytes");
    writeFileSync(join(dir, "Day 001 - Copy.mp4"), "same bytes");
    writeFileSync(join(dir, "Day 002.mp4"), "other bytes");
    const files = await Promise.all(["Day 001.mp4", "Day 001 - Copy.mp4", "Day 002.mp4"].map(async (n) => ({ path: n, hash: await sha256File(join(dir, n)), size: 1 })));
    const sets = findDuplicateSets(files);
    expect(sets).toHaveLength(1);
  });
});
