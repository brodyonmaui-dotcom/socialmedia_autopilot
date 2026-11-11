import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const VIDEO_EXT = /\.(mp4|mov|m4v)$/i;
/** Never descend into already-posted archives, our own ed-qa debug output, or hidden/editor-cache dirs. */
const SKIP_DIR = /^posted$|^already posted$|-qa$|^\./i;

export interface IngestRoot {
  path: string;
  pillar: string;
}

export interface FoundFile {
  path: string;
  pillar: string;
}

/** Recursively collects video files under each root, applying the skip rules. Explicit roots only — never crawls upward or sideways. */
export function findVideoFiles(roots: IngestRoot[]): FoundFile[] {
  const out: FoundFile[] = [];
  for (const root of roots) walk(root.path, root.pillar, out);
  return out;
}

function walk(dir: string, pillar: string, out: FoundFile[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // missing/inaccessible root: skip, don't crash the whole run
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (SKIP_DIR.test(entry)) continue;
      walk(full, pillar, out);
    } else if (VIDEO_EXT.test(entry) && !entry.startsWith(".")) {
      // Hidden files are skipped too: macOS "._clip.mp4" AppleDouble sidecars look like videos but aren't.
      out.push({ path: full, pillar });
    }
  }
}
