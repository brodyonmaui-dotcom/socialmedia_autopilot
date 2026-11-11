import { describe, expect, it } from "vitest";
import { findDuplicateSets } from "../dedupe.js";

describe("findDuplicateSets", () => {
  it("returns only hashes with more than one file", () => {
    const result = findDuplicateSets([
      { path: "a.mp4", hash: "h1", size: 100 },
      { path: "b.mp4", hash: "h2", size: 200 },
      { path: "c.mp4", hash: "h1", size: 100 },
    ]);
    expect(result).toEqual([{ hash: "h1", files: [{ path: "a.mp4", hash: "h1", size: 100 }, { path: "c.mp4", hash: "h1", size: 100 }] }]);
  });

  it("returns an empty array when there are no duplicates", () => {
    expect(findDuplicateSets([{ path: "a.mp4", hash: "h1", size: 1 }, { path: "b.mp4", hash: "h2", size: 1 }])).toEqual([]);
  });

  it("handles three copies of the same file as one set", () => {
    const files = [
      { path: "a.mp4", hash: "h1", size: 1 },
      { path: "b.mp4", hash: "h1", size: 1 },
      { path: "c.mp4", hash: "h1", size: 1 },
    ];
    const result = findDuplicateSets(files);
    expect(result).toHaveLength(1);
    expect(result[0]!.files).toHaveLength(3);
  });

  it("returns an empty array for an empty input", () => {
    expect(findDuplicateSets([])).toEqual([]);
  });
});
