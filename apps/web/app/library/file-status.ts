import { existsSync } from "node:fs";

/**
 * Whether a media row's source master is still on disk. Read-only: never touches the DB.
 *
 * Source paths are the laptop's (the ingest agent runs there). The server can't see that disk,
 * so a path is only judged when a nearby ancestor folder is reachable from where the page runs
 * (local `next dev` on the laptop). Otherwise it's "unknown" and no badge shows: on the VPS
 * every row would look missing, which would be noise, not information.
 */
export type FileStatus = "present" | "missing" | "unknown";

/** Ancestor folders checked above the file. Drive roots (`C:`) never count as "reachable". */
const MAX_LEVELS = 4;

export function sourceFileStatus(sourcePath: string, exists: (p: string) => boolean = existsSync): FileStatus {
  if (exists(sourcePath)) return "present";
  let dir = sourcePath;
  for (let i = 0; i < MAX_LEVELS; i++) {
    const up = parentOf(dir);
    if (up === null) break;
    dir = up;
    if (exists(dir)) return "missing";
  }
  return "unknown";
}

/** Parent folder for either separator, or null at a drive/filesystem root. */
function parentOf(p: string): string | null {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  if (i <= 0) return null;
  const up = p.slice(0, i);
  return /^[A-Za-z]:$/.test(up) ? null : up;
}
