import { join } from "node:path";
import { localDate, localHHMM, type CadenceSettings, type Platform } from "@autopilot/core";
import type { LintResult } from "@autopilot/research";
import type { QaResult, TouchUpOptions } from "@autopilot/media";
import { existingRange, ingestKey, planReadyItems, readyWindow, type PlannedItem, type ReadyExisting } from "./plan.js";
import { parseSidecar, type Sidecar } from "./sidecar.js";
import type { MediaRow, WriteInput, WriteResult } from "./write.js";

/**
 * `pnpm ingest:ready` (F15 "Laptop side"): one pass over INGEST_READY_DIR (top level only).
 * Every side effect is injected so the order (validate → skip check → QA → strip → location check
 * → upload → HEAD verify → media → plan → write → move) is testable without a DB, R2 or ffmpeg.
 * Files are moved to `_ingested/` only after the upload is verified AND the DB write succeeded;
 * on any failure both stay where they are. Nothing is ever deleted.
 */

export const INGESTED_DIR = "_ingested";

export interface ReadyFs {
  /** Names of regular files directly in `dir` (no recursion). */
  list(dir: string): string[];
  readText(path: string): string;
  exists(path: string): boolean;
  mkdir(path: string): void;
  rename(from: string, to: string): void;
}

export interface ReadyDb {
  existingKeys(keys: string[]): Promise<string[]>;
  loadCadence(): Promise<CadenceSettings>;
  existingPosts(from: string, to: string): Promise<ReadyExisting[]>;
  upsertMedia(row: MediaRow): Promise<string>;
  writeItems(input: WriteInput): Promise<WriteResult>;
}

export interface ReadyDeps {
  dir: string;
  dryRun: boolean;
  timeZone: string;
  now(): Date;
  fs: ReadyFs;
  hash(path: string): Promise<string>;
  runQa(filePath: string, platform: "reels"): Promise<QaResult>;
  touchUp(filePath: string, opts: TouchUpOptions): Promise<void>;
  /** Location-capable tag keys still present (packages/media `probeLocationTagKeys`). */
  locationTagKeys(filePath: string): Promise<string[]>;
  upload(key: string, cleanPath: string): Promise<void>;
  /** Object size from a HEAD, or null when it isn't there. */
  headObject(key: string): Promise<{ size: number } | null>;
  tmpDir(): string;
  cleanup(dir: string): void;
  db: ReadyDb;
  lint(text: string, kind: "caption" | "title", platform: Platform): LintResult;
  log(line: string): void;
}

export interface ReadySummary {
  new: number;
  skipped: number;
  wait: number;
  fail: number;
}

export function readySummaryLine(s: ReadySummary): string {
  return `ingest:ready: ${s.new} new · ${s.skipped} skipped · ${s.wait} wait · ${s.fail} fail`;
}

/** A failure at a named stage; the line is `FAIL <name>: <stage>[ (<detail>)]`. */
class StageError extends Error {
  constructor(
    readonly stage: string,
    readonly detail?: string,
  ) {
    super(detail ? `${stage} (${detail})` : stage);
  }
}

async function stage<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StageError) throw err;
    throw new StageError(name, oneLine((err as Error)?.message ?? String(err)));
  }
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);

const MP4 = /\.mp4$/i;
const SIDECAR_SUFFIX = ".post.json";

function slotText(item: PlannedItem, timeZone: string): string {
  if (!item.scheduledFor) return `${item.platform} no-slot`;
  const d = new Date(item.scheduledFor);
  return `${item.platform} ${localDate(d, timeZone)} ${localHHMM(d, timeZone)}`;
}

function flagText(items: PlannedItem[]): string {
  const parts = items.flatMap((i) => i.flags.filter((f) => f !== "no-slot").map((f) => `${f}(${i.platform})`));
  return parts.length ? ` · flags: ${parts.join(", ")}` : "";
}

export async function runReady(d: ReadyDeps): Promise<ReadySummary> {
  const s: ReadySummary = { new: 0, skipped: 0, wait: 0, fail: 0 };
  const names = d.fs
    .list(d.dir)
    .filter((n) => !n.startsWith(".") && n !== INGESTED_DIR)
    .sort();
  const present = new Set(names);

  /** Moves both files into `_ingested/`; on a clash both get `-<hash8>` (then `-<hash8>-2`, ...). */
  function moveBoth(base: string, mp4: string, sidecar: string, hash: string): void {
    const dest = join(d.dir, INGESTED_DIR);
    if (!d.fs.exists(dest)) d.fs.mkdir(dest);
    const ext = mp4.slice(base.length);
    const free = (stem: string) => !d.fs.exists(join(dest, `${stem}${ext}`)) && !d.fs.exists(join(dest, `${stem}${SIDECAR_SUFFIX}`));
    let stem = base;
    if (!free(stem)) {
      stem = `${base}-${hash.slice(0, 8)}`;
      for (let n = 2; !free(stem); n++) stem = `${base}-${hash.slice(0, 8)}-${n}`;
    }
    d.fs.rename(join(d.dir, mp4), join(dest, `${stem}${ext}`));
    d.fs.rename(join(d.dir, sidecar), join(dest, `${stem}${SIDECAR_SUFFIX}`));
  }

  async function one(mp4: string): Promise<"new" | "skipped" | "wait"> {
    const base = mp4.replace(MP4, "");
    const sidecarName = `${base}${SIDECAR_SUFFIX}`;
    if (!present.has(sidecarName)) {
      d.log(`WAIT ${mp4} (no ${sidecarName} yet)`);
      return "wait";
    }
    const mp4Path = join(d.dir, mp4);

    // 1. Validate the sidecar, hash the mp4.
    let json: unknown;
    try {
      json = JSON.parse(d.fs.readText(join(d.dir, sidecarName)));
    } catch (err) {
      throw new StageError("sidecar", `not valid JSON: ${oneLine((err as Error).message)}`);
    }
    const parsed = parseSidecar(json);
    if (!parsed.ok) throw new StageError(`${parsed.path}: ${parsed.message}`);
    const sidecar: Sidecar = parsed.value;
    const hash = await stage("hash", () => d.hash(mp4Path));

    // 2. Every key already there → the earlier run proved the upload; just move the files.
    const keys = sidecar.platforms.map((p) => ingestKey(hash, p));
    const have = new Set(await stage("db-read", () => d.db.existingKeys(keys)));
    if (keys.every((k) => have.has(k))) {
      if (d.dryRun) {
        d.log(`WOULD SKIP ${mp4} (already ingested)`);
      } else {
        await stage("move", () => moveBoth(base, mp4, sidecarName, hash));
        d.log(`SKIP ${mp4} (already ingested)`);
      }
      return "skipped";
    }

    const now = d.now();
    const win = readyWindow(sidecar, now, d.timeZone);
    const range = existingRange(win, d.timeZone);
    const plan = async (mediaId: string) => {
      const cadence = await stage("db-read", () => d.db.loadCadence());
      const existing = await stage("db-read", () => d.db.existingPosts(range.from, range.to));
      return stage("plan", () => planReadyItems({ sidecar, contentHash: hash, mediaId, now, timeZone: d.timeZone, cadence, existing, lint: d.lint }));
    };

    if (d.dryRun) {
      const items = await plan("(dry-run)");
      d.log(`WOULD INGEST ${mp4} · ${sidecar.pillar} · ${items.map((i) => slotText(i, d.timeZone)).join(", ")}${flagText(items)}`);
      return "new";
    }

    // 3. QA → strip → location check → upload → HEAD verify → media row.
    const qa = await stage("qa", () => d.runQa(mp4Path, "reels"));
    const tmp = await stage("touch-up", () => d.tmpDir());
    let mediaId: string;
    try {
      const cleanPath = join(tmp, "clean.mp4");
      await stage("touch-up", () => d.touchUp(mp4Path, { outPath: cleanPath }));
      const lingering = await stage("location-check", () => d.locationTagKeys(cleanPath));
      // Key count only: never echo tag values (they're coordinates) or the source folder.
      if (lingering.length > 0) throw new StageError("location-check", `${lingering.length} location tag key(s) remain after strip; not uploaded`);
      const r2Key = `library/${hash}.mp4`;
      await stage("upload", () => d.upload(r2Key, cleanPath));
      const head = await stage("verify-upload", () => d.headObject(r2Key));
      if (!head || !(head.size > 0)) throw new StageError("verify-upload", "object missing or empty");
      mediaId = await stage("media", () =>
        d.db.upsertMedia({
          contentHash: hash,
          sourcePath: mp4Path,
          r2Key,
          durationS: qa.probe.durationS ?? null,
          width: qa.probe.width ?? null,
          height: qa.probe.height ?? null,
          pillar: sidecar.pillar,
          qa,
          capturedAt: qa.probe.capturedAt ?? null,
        }),
      );
    } finally {
      d.cleanup(tmp);
    }

    // 4. Plan + write (one transaction).
    const items = await plan(mediaId);
    const written = await stage("db-write", () => d.db.writeItems({ mediaId, sidecar, items, now }));

    // 5. Only now: move both files.
    await stage("move", () => moveBoth(base, mp4, sidecarName, hash));
    d.log(
      `NEW ${mp4} · ${sidecar.pillar} · ${items.map((i) => slotText(i, d.timeZone)).join(", ")} · ${written.inserted.length} draft item(s)` +
        `${written.existing.length ? `, ${written.existing.length} already there` : ""}${flagText(items)}`,
    );
    return "new";
  }

  for (const name of names.filter((n) => MP4.test(n))) {
    try {
      const r = await one(name);
      s[r === "new" ? "new" : r === "skipped" ? "skipped" : "wait"]++;
    } catch (err) {
      const msg = err instanceof StageError ? err.message : `unexpected (${oneLine((err as Error)?.message ?? String(err))})`;
      d.log(`FAIL ${name}: ${msg}`);
      s.fail++;
    }
  }
  return s;
}
