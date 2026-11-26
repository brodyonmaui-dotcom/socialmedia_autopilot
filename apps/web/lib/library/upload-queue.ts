/**
 * Pure logic behind the Library uploader (F23 U2): which picked files count, folder labels, splitting a file
 * into parts, retry with backoff and the 2-files-at-a-time pool. No DOM, no network: tested in __tests__/upload-queue.test.ts.
 */

export const VIDEO_EXT = ["mp4", "mov", "m4v"] as const;
export const MAX_FILE_BYTES = 2 * 1024 ** 3;
export const MAX_FILES = 200;
export const FILE_CONCURRENCY = 2;
export const PART_RETRIES = 3;

export interface PickedFile {
  name: string;
  size: number;
  type: string;
  /** `webkitRelativePath` of a folder pick ("Upper body/day1/clip.mp4"); empty for a plain file pick. */
  relPath?: string;
}

const extOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};

/** A dotfile anywhere in the path (".DS_Store", "._clip.mp4", ".hidden/clip.mp4"). */
export function isHidden(file: Pick<PickedFile, "name" | "relPath">): boolean {
  const segs = (file.relPath || file.name).split("/").filter(Boolean);
  return segs.some((s) => s.startsWith("."));
}

export function isVideo(file: Pick<PickedFile, "name" | "type">): boolean {
  return (VIDEO_EXT as readonly string[]).includes(extOf(file.name)) || (file.type.startsWith("video/") && extOf(file.name) !== "");
}

export interface Classified {
  accepted: PickedFile[];
  /** Not videos, hidden files or over the size limit. */
  ignored: number;
  /** Videos left out because of the 200-file cap. */
  overLimit: number;
}

/** Keep video files (not dotfiles, ≤ 2 GiB), at most `room` of them. */
export function classifyFiles(files: readonly PickedFile[], room: number = MAX_FILES): Classified {
  const ok: PickedFile[] = [];
  let ignored = 0;
  for (const f of files) {
    if (isHidden(f) || !isVideo(f) || f.size <= 0 || f.size > MAX_FILE_BYTES) ignored++;
    else ok.push(f);
  }
  const keep = Math.max(0, room);
  return { accepted: ok.slice(0, keep), ignored, overLimit: Math.max(0, ok.length - keep) };
}

/** The parent directory name of a folder pick ("A/B/clip.mp4" → "B"); null for a plain file or a file at the picked root's top. */
export function folderLabel(relPath: string | undefined): string | null {
  if (!relPath) return null;
  const segs = relPath.split("/").filter(Boolean);
  return segs.length >= 2 ? segs[segs.length - 2]! : null;
}

export interface Part {
  /** 1-based. */
  n: number;
  start: number;
  /** Exclusive. */
  end: number;
}

/** Split `size` bytes into parts of `partSize`; the last one holds the rest. A 0-byte file has no parts. */
export function splitParts(size: number, partSize: number): Part[] {
  if (!(partSize > 0)) throw new Error("partSize must be positive");
  const out: Part[] = [];
  for (let start = 0, n = 1; start < size; start += partSize, n++) out.push({ n, start, end: Math.min(size, start + partSize) });
  return out;
}

/** 0 for nothing sent yet, else the share of bytes in finished parts plus the current part's loaded bytes, 0..1. */
export function progressOf(size: number, doneBytes: number, inPartBytes = 0): number {
  if (size <= 0) return 0;
  return Math.max(0, Math.min(1, (doneBytes + inPartBytes) / size));
}

/** Wait before retry number `attempt` (1, 2, 3): 1 s, 2 s, 4 s, capped at 8 s. */
export function backoffMs(attempt: number): number {
  return Math.min(8000, 1000 * 2 ** Math.max(0, attempt - 1));
}

/** Run `fn`; on a throw retry up to `retries` more times, waiting `backoffMs` between. `shouldStop` ends early (pause/cancel). */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  o: { retries?: number; sleep?: (ms: number) => Promise<void>; shouldStop?: () => boolean } = {},
): Promise<T> {
  const retries = o.retries ?? PART_RETRIES;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || o.shouldStop?.()) throw err;
      await sleep(backoffMs(attempt + 1));
    }
  }
}

/** Run `worker` over `items` with at most `limit` in flight, starting in order. Resolves when all finished (workers handle their own errors). */
export async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>, shouldStop: () => boolean = () => false): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (!shouldStop()) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}

export const sameFile = (a: { name: string; size: number }, b: { name: string; size: number }): boolean => a.name === b.name && a.size === b.size;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export type RowStatus = "checking" | "ready" | "already" | "skipped" | "waiting" | "uploading" | "paused" | "processing" | "done" | "duplicate" | "failed" | "cancelled";

export interface RowView {
  status: RowStatus;
  /** 0..1 while uploading. */
  progress: number;
}

/** "Waiting", "Uploading 45%", "Processing", "Done", "Duplicate", "Failed", "Already in your library"… */
export function statusLabel(r: RowView): string {
  switch (r.status) {
    case "checking":
      return "Checking…";
    case "ready":
      return "Ready";
    case "already":
      return "Already in your library";
    case "skipped":
      return "Skipped";
    case "waiting":
      return "Waiting";
    case "uploading":
      return `Uploading ${Math.round(r.progress * 100)}%`;
    case "paused":
      return `Paused at ${Math.round(r.progress * 100)}%`;
    case "processing":
      return "Processing";
    case "done":
      return "Done";
    case "duplicate":
      return "Duplicate";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

/** Server status (from the status route) → row status; unknown/uploaded/processing → processing. */
export function rowStatusFromServer(s: string): RowStatus {
  if (s === "done") return "done";
  if (s === "duplicate") return "duplicate";
  if (s === "failed") return "failed";
  if (s === "aborted") return "cancelled";
  return "processing";
}

/** Rows to check on the 5-second poll: the ones the worker is processing. */
export const needsPolling = (rows: ReadonlyArray<{ status: RowStatus; uploadId?: string }>): string[] => rows.filter((r) => r.status === "processing" && r.uploadId).map((r) => r.uploadId!);
