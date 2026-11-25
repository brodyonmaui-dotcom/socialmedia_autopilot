import { checkFolderLabel, weekFolderLabel } from "@autopilot/core";

/** Parsed ingest flags. `folder` and `folderFromWeek` are mutually exclusive. */
export interface IngestFlags {
  dryRun: boolean;
  /** `--folder "<label>"`: the label every new clip gets (already validated). */
  folder: string | null;
  /** `--folder-from week`: "Week of <Mon DD>" from each file's captured date. */
  folderFromWeek: boolean;
  /** `--retag` (with `--folder`): also set the folder on clips that are already in the library. */
  retag: boolean;
}

export type FlagResult = { ok: true; flags: IngestFlags } | { ok: false; error: string };

export function parseIngestFlags(argv: readonly string[]): FlagResult {
  let dryRun = false;
  let retag = false;
  let folderRaw: string | null = null;
  let from: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const eq = a.indexOf("=");
    const [name, inline] = a.startsWith("--") && eq > 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, null];
    const value = (): string | null => (inline !== null ? inline : argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--") ? argv[++i]! : null);
    if (name === "--dry-run") dryRun = true;
    else if (name === "--retag") retag = true;
    else if (name === "--folder") {
      folderRaw = value();
      if (folderRaw === null) return { ok: false, error: '--folder needs a label, e.g. --folder "Week of Nov 23"' };
    } else if (name === "--folder-from") {
      from = value();
      if (from !== "week") return { ok: false, error: '--folder-from only supports "week"' };
    }
  }
  if (folderRaw !== null && from !== null) return { ok: false, error: "use --folder or --folder-from, not both" };
  let folder: string | null = null;
  if (folderRaw !== null) {
    const c = checkFolderLabel(folderRaw);
    if (!c.ok) return { ok: false, error: `--folder: ${c.reason}` };
    folder = c.folder;
  }
  if (retag && folder === null) return { ok: false, error: "--retag needs --folder \"<label>\" (it only re-labels clips already in the library)" };
  return { ok: true, flags: { dryRun, folder, folderFromWeek: from === "week", retag } };
}

/** The folder a new clip gets: the fixed label, or the week of its captured date (creator-local, else UTC); null when neither applies. */
export function folderForClip(flags: Pick<IngestFlags, "folder" | "folderFromWeek">, capturedAt: string | null, timeZone: string): string | null {
  if (flags.folder) return flags.folder;
  if (!flags.folderFromWeek || !capturedAt) return null;
  const d = new Date(capturedAt);
  return Number.isNaN(d.getTime()) ? null : weekFolderLabel(d, timeZone);
}
