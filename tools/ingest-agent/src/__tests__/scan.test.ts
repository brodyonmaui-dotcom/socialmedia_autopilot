import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findVideoFiles } from "../scan.js";

describe("findVideoFiles", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "autopilot-scan-test-"));
    writeFileSync(join(root, "a.mp4"), "");
    writeFileSync(join(root, "notes.txt"), "");
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "b.MOV"), "");
    mkdirSync(join(root, "Posted"));
    writeFileSync(join(root, "Posted", "c.mp4"), "");
    mkdirSync(join(root, "clip-qa"));
    writeFileSync(join(root, "clip-qa", "d.mp4"), "");
    mkdirSync(join(root, ".hidden"));
    writeFileSync(join(root, ".hidden", "e.mp4"), "");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("finds videos recursively, skips posted/-qa/hidden dirs and non-video files", () => {
    const found = findVideoFiles([{ path: root, pillar: "gym" }]);
    const names = found.map((f) => f.path.split(/[\\/]/).pop()).sort();
    expect(names).toEqual(["a.mp4", "b.MOV"]);
    expect(found.every((f) => f.pillar === "gym")).toBe(true);
  });

  it("skips a missing root instead of throwing", () => {
    expect(findVideoFiles([{ path: join(root, "does-not-exist"), pillar: "gym" }])).toEqual([]);
  });
});
