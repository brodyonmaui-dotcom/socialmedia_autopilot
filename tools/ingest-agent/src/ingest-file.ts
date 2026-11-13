import { join } from "node:path";
import type { QaResult, TouchUpOptions } from "@autopilot/media";
import type { FoundFile } from "./scan.js";

/** Everything with side effects is injected so the strip → verify → upload order is testable. */
export interface IngestFileDeps {
  runQa(filePath: string, platform: "reels"): Promise<QaResult>;
  touchUp(filePath: string, opts: TouchUpOptions): Promise<void>;
  /** Location-capable tag keys still present (packages/media `probeLocationTagKeys`). */
  locationTagKeys(filePath: string): Promise<string[]>;
  upload(key: string, cleanPath: string): Promise<void>;
  /** Insert params: content_hash, source_path, r2_key, duration_s, width, height, pillar, qa json, captured_at. */
  insert(params: unknown[]): Promise<void>;
  tmpDir(): string;
  cleanup(dir: string): void;
}

/**
 * One new file: QA → touchUp into a temp clean copy → re-probe the clean copy (F7 C1) → upload the
 * clean copy only (F7 C2: never `file.path`) → record it. A lingering location tag throws, so
 * runIngest logs `ERROR <name> — …`, counts it failed, and writes no row (the next run retries).
 */
export function createIngestFile(d: IngestFileDeps): (file: FoundFile, hash: string) => Promise<string> {
  return async (file, hash) => {
    const base = file.path.split(/[\\/]/).pop();
    const qa = await d.runQa(file.path, "reels");
    const tmp = d.tmpDir();
    const cleanPath = join(tmp, "clean.mp4");
    try {
      await d.touchUp(file.path, { outPath: cleanPath });
      const lingering = await d.locationTagKeys(cleanPath);
      if (lingering.length > 0) {
        // Key count only: never echo tag values (they're coordinates) or the source folder.
        throw new Error(`location tag(s) remain after strip (${lingering.length} key${lingering.length === 1 ? "" : "s"}); not uploaded`);
      }
      // Key = content hash, so a retried upload overwrites the same object (idempotent).
      const key = `library/${hash}.mp4`;
      await d.upload(key, cleanPath);
      await d.insert([hash, file.path, key, qa.probe.durationS, qa.probe.width, qa.probe.height, file.pillar, JSON.stringify(qa), qa.probe.capturedAt ?? null]);
      return `INGESTED ${base} · ${file.pillar} · ${qa.probe.durationS.toFixed(1)}s · ${qa.warnings.length} warning(s)`;
    } finally {
      d.cleanup(tmp);
    }
  };
}
