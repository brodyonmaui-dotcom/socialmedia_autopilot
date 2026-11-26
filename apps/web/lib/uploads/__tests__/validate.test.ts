import { describe, expect, it } from "vitest";
import {
  baseName,
  checkPartSize,
  checkUploadFile,
  extOf,
  folderFromRelPath,
  incomingKey,
  isUuid,
  MAX_UPLOAD_BYTES,
  MIN_PART_BYTES,
  PART_SIZE,
  partCount,
  parsePartNumber,
} from "../validate.js";

describe("checkUploadFile", () => {
  it("accepts mp4/mov/m4v videos up to 2 GiB, keeping only the basename", () => {
    expect(checkUploadFile({ name: "leg day.MOV", size: 10, type: "video/quicktime" })).toEqual({ ok: true, name: "leg day.MOV", ext: "mov", contentType: "video/quicktime" });
    expect(checkUploadFile({ name: "C:\\Users\\x\\clip.mp4", size: 1, type: "" })).toEqual({ ok: true, name: "clip.mp4", ext: "mp4", contentType: null });
    expect(checkUploadFile({ name: "a/b/c.m4v", size: MAX_UPLOAD_BYTES, type: "application/octet-stream" })).toMatchObject({ ok: true, name: "c.m4v" });
  });

  it("refuses other extensions, non-video types, empty / oversized / odd sizes and odd names", () => {
    expect(checkUploadFile({ name: "song.mp3", size: 10, type: "audio/mpeg" }).ok).toBe(false);
    expect(checkUploadFile({ name: "clip.mp4", size: 10, type: "image/png" }).ok).toBe(false);
    expect(checkUploadFile({ name: "clip.mp4", size: 0, type: "video/mp4" }).ok).toBe(false);
    expect(checkUploadFile({ name: "clip.mp4", size: MAX_UPLOAD_BYTES + 1, type: "video/mp4" }).ok).toBe(false);
    expect(checkUploadFile({ name: "clip.mp4", size: 1.5, type: "video/mp4" }).ok).toBe(false);
    expect(checkUploadFile({ name: "clip.mp4", size: "10", type: "video/mp4" }).ok).toBe(false);
    expect(checkUploadFile({ name: ".hidden.mp4", size: 10 }).ok).toBe(false);
    expect(checkUploadFile({ name: "mp4", size: 10 }).ok).toBe(false);
    expect(checkUploadFile({ name: "a\u0000.mp4", size: 10 }).ok).toBe(false);
    expect(checkUploadFile({ name: `${"x".repeat(250)}.mp4`, size: 10 }).ok).toBe(false);
    expect(checkUploadFile({ name: 42, size: 10 }).ok).toBe(false);
  });
});

describe("folderFromRelPath", () => {
  it("is the parent directory NAME only", () => {
    expect(folderFromRelPath("Upper body/day1/clip.mp4")).toBe("day1");
    expect(folderFromRelPath("Physique checks/clip.mp4")).toBe("Physique checks");
    expect(folderFromRelPath("  Full   workout log /clip.mp4")).toBe("Full workout log");
    expect(folderFromRelPath("a\\Lower body\\clip.mov")).toBe("Lower body");
  });

  it("is null without a parent or when folder.ts refuses the name", () => {
    expect(folderFromRelPath(undefined)).toBeNull();
    expect(folderFromRelPath("")).toBeNull();
    expect(folderFromRelPath("clip.mp4")).toBeNull();
    expect(folderFromRelPath(`${"x".repeat(61)}/clip.mp4`)).toBeNull();
    expect(folderFromRelPath("a/../clip.mp4")).toBeNull();
    expect(folderFromRelPath("a/\u0007bell/clip.mp4")).toBeNull();
    expect(folderFromRelPath("   /clip.mp4")).toBeNull();
  });
});

describe("parts", () => {
  it("part numbers are 1..10000 written plainly", () => {
    expect(parsePartNumber("1")).toBe(1);
    expect(parsePartNumber("10000")).toBe(10000);
    for (const bad of ["0", "10001", "-1", "01", "1.0", "abc", "", "1e3", undefined]) expect(parsePartNumber(bad)).toBeNull();
  });

  it("sizes: ≤ part size, all but the last exactly the part size (≥ 5 MiB), the last the remainder, never past the end", () => {
    const size = PART_SIZE * 2 + 100;
    expect(partCount(size)).toBe(3);
    expect(partCount(1)).toBe(1);
    expect(checkPartSize(1, PART_SIZE, size)).toEqual({ ok: true });
    expect(checkPartSize(3, 100, size)).toEqual({ ok: true });
    expect(checkPartSize(1, PART_SIZE + 1, size)).toMatchObject({ ok: false, status: 413 });
    expect(checkPartSize(2, MIN_PART_BYTES - 1, size)).toMatchObject({ ok: false, status: 400 });
    expect(checkPartSize(2, MIN_PART_BYTES, size)).toMatchObject({ ok: false, status: 400 });
    expect(checkPartSize(3, 99, size)).toMatchObject({ ok: false, status: 400 });
    expect(checkPartSize(4, 100, size)).toMatchObject({ ok: false, status: 400 });
    expect(checkPartSize(1, 0, size)).toMatchObject({ ok: false, status: 400 });
    expect(checkPartSize(1, 10, 10)).toEqual({ ok: true });
  });

  it("keys and ids", () => {
    expect(incomingKey("5e5510e0-0000-4000-8000-000000000001", "mov")).toBe("incoming/5e5510e0-0000-4000-8000-000000000001.mov");
    expect(isUuid("5e5510e0-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("../etc")).toBe(false);
    expect(baseName("/a/b/c.mp4")).toBe("c.mp4");
    expect(extOf("c.MP4")).toBe("mp4");
    expect(extOf("noext")).toBe("");
  });
});
