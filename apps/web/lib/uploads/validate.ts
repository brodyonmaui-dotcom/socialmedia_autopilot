// Browser upload (F23) rules, pure: which files may be uploaded, the part arithmetic, and the two things kept
// from the laptop's path: the file's BASENAME (media.source_path) and its parent directory NAME (the library
// folder label, validated by packages/core/src/folder.ts). Never the rest of the path (location boundary).
import { checkFolderLabel } from "@autopilot/core";

export const VIDEO_EXTS = ["mp4", "mov", "m4v"] as const;
/** 2 GiB per file. */
export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
export const MAX_BATCH_FILES = 200;
/** Browser chunk = one S3 part. 8 MiB stays under Next's 10 MB middleware body buffer. */
export const PART_SIZE = 8 * 1024 ** 2;
/** S3/R2: every part but the last must be at least 5 MiB. */
export const MIN_PART_BYTES = 5 * 1024 ** 2;
export const MAX_PARTS = 10_000;
/** Longest basename kept (a label, not a path). */
export const NAME_MAX = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Last path segment ("/" or "\\" separated), trimmed. */
export function baseName(name: string): string {
  const segs = String(name ?? "").split(/[\\/]/);
  return (segs[segs.length - 1] ?? "").trim();
}

/** Lowercased extension of a basename, "" when none. */
export function extOf(name: string): string {
  const b = baseName(name);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i + 1).toLowerCase();
}

/**
 * Library folder label from a folder pick's `webkitRelativePath` ("Upper body/day1/clip.mp4" → "day1"):
 * the file's parent directory NAME only. No parent, or a name folder.ts refuses → null.
 */
export function folderFromRelPath(relPath: string | undefined | null): string | null {
  if (typeof relPath !== "string" || !relPath) return null;
  const segs = relPath.split(/[\\/]/).filter((s) => s.length > 0);
  if (segs.length < 2) return null;
  const parent = segs[segs.length - 2]!;
  if (parent === "." || parent === "..") return null;
  const c = checkFolderLabel(parent);
  return c.ok ? c.folder : null;
}

export type UploadFileCheck = { ok: true; name: string; ext: string; contentType: string | null } | { ok: false; error: string };

/** One picked file: a video basename (mp4/mov/m4v), video/* (or unknown) type, 1 byte to 2 GiB. */
export function checkUploadFile(f: { name: unknown; size: unknown; type?: unknown }): UploadFileCheck {
  if (typeof f.name !== "string") return { ok: false, error: "The file has no name." };
  const name = baseName(f.name);
  // eslint-disable-next-line no-control-regex
  if (!name || name.startsWith(".") || /[\u0000-\u001f\u007f]/.test(name)) return { ok: false, error: "That file name can't be used." };
  if (name.length > NAME_MAX) return { ok: false, error: `The file name is longer than ${NAME_MAX} characters.` };
  const ext = extOf(name);
  if (!(VIDEO_EXTS as readonly string[]).includes(ext)) return { ok: false, error: "Only .mp4, .mov and .m4v videos can be uploaded." };
  const type = typeof f.type === "string" ? f.type.trim().toLowerCase() : "";
  if (type && !type.startsWith("video/") && type !== "application/octet-stream") return { ok: false, error: "That file isn't a video." };
  const size = f.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) return { ok: false, error: "The file is empty." };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: "The file is bigger than 2 GB." };
  return { ok: true, name, ext, contentType: type.startsWith("video/") ? type : null };
}

/** How many parts a file of `size` bytes has at `partSize`. */
export const partCount = (size: number, partSize: number = PART_SIZE): number => Math.max(1, Math.ceil(size / partSize));

/** The private raw key: `incoming/<uploadId>.<ext>`. */
export const incomingKey = (uploadId: string, ext: string): string => `incoming/${uploadId}.${ext}`;

/** "7" → 7 when 1..10000 (no signs, no decimals, no leading zeros); else null. */
export function parsePartNumber(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_PARTS ? n : null;
}

export type PartCheck = { ok: true } | { ok: false; status: 400 | 413; error: string };

/**
 * One part's size against the file: never more than `partSize`, never past the file's last part, every
 * part but the last at least 5 MiB, and the last exactly the remainder.
 */
export function checkPartSize(n: number, bytes: number, fileSize: number, partSize: number = PART_SIZE): PartCheck {
  const count = partCount(fileSize, partSize);
  if (bytes > partSize) return { ok: false, status: 413, error: "The part is bigger than the part size." };
  if (n > count) return { ok: false, status: 400, error: "That part number is past the end of the file." };
  if (bytes <= 0) return { ok: false, status: 400, error: "The part is empty." };
  if (n < count && bytes < Math.min(MIN_PART_BYTES, partSize)) return { ok: false, status: 400, error: "Every part but the last must be at least 5 MB." };
  const expected = n < count ? partSize : fileSize - partSize * (count - 1);
  if (bytes !== expected) return { ok: false, status: 400, error: "The part has the wrong size for this file." };
  return { ok: true };
}
