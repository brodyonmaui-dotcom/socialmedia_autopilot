/**
 * Touch-up issues as the web app reads them (pure). v2 results (packages/media `runQa`, version 2) carry
 * structured issues with plain-word sentences; older rows only have loose warning strings, which can't be
 * trusted (the old thresholds flagged normal tripod and talking-head clips), so `issuesOf` maps them:
 * "effectively silent" → info `no-sound`; frozen/black counts without positions → info `recheck` (never
 * flagged; the worker's media-recheck job replaces them with a real v2 result).
 *
 * The shapes mirror packages/media/src/qa.ts + fix.ts. They are repeated here because the web app does not
 * depend on @autopilot/media (it shells out to ffmpeg); keep the two in step.
 */

export type QaSeverity = "fix" | "info";

export interface QaIssue {
  code: string;
  severity: QaSeverity;
  fixable: boolean;
  detail: string;
  segments?: Array<{ start: number; end: number }>;
}

export type FixOp = "trim" | "remove-gaps" | "reencode" | "pad" | "loudness" | "strip";

export const FIX_OP_ORDER: readonly FixOp[] = ["trim", "remove-gaps", "reencode", "pad", "loudness", "strip"];

/** Same table as packages/media fix.ts OP_FOR_CODE. */
export const OP_FOR_CODE: Readonly<Record<string, FixOp>> = {
  "frozen-head": "trim",
  "frozen-tail": "trim",
  "black-head": "trim",
  "black-tail": "trim",
  "silence-gaps": "remove-gaps",
  format: "reencode",
  rotation: "reencode",
  aspect: "pad",
  loudness: "loudness",
  metadata: "strip",
};

/** Off in "Fix all" unless asked for by name (it changes the pacing). */
export const OPT_IN_OPS: readonly FixOp[] = ["remove-gaps"];

/** Short tag labels for info issues (library chips). */
const TAG_LABELS: Record<string, string> = {
  "no-sound": "No sound yet",
  landscape: "Landscape",
  square: "Square",
  tall: "Extra tall",
  "silence-gaps": "Silent pauses",
  "frozen-middle": "Still moment",
  "black-middle": "Black moment",
  "too-long": "Too long",
  recheck: "Re-check pending",
};

export function tagLabel(code: string): string {
  return TAG_LABELS[code] ?? code.replace(/-/g, " ");
}

export const RECHECK_DETAIL = "Checked with the old rules. A fresh check is queued.";

const SEVERITIES = new Set<QaSeverity>(["fix", "info"]);

function cleanIssue(x: unknown): QaIssue | null {
  const i = x as Partial<QaIssue> | null;
  if (!i || typeof i.code !== "string" || !SEVERITIES.has(i.severity as QaSeverity)) return null;
  return {
    code: i.code,
    severity: i.severity as QaSeverity,
    fixable: i.fixable === true,
    detail: typeof i.detail === "string" ? i.detail : "",
    ...(Array.isArray(i.segments) ? { segments: i.segments.filter((s) => s && Number.isFinite(s.start) && Number.isFinite(s.end)) } : {}),
  };
}

/** One legacy warning string → an info issue (never `fix`), or null to drop it. */
export function mapLegacyWarning(w: string): QaIssue | null {
  if (/effectively silent/i.test(w)) return { code: "no-sound", severity: "info", fixable: false, detail: "No sound yet." };
  if (/^landscape/i.test(w)) return { code: "landscape", severity: "info", fixable: false, detail: "Landscape." };
  if (/exceeds .* limit/i.test(w)) return { code: "too-long", severity: "info", fixable: false, detail: "Longer than the platform allows." };
  // Frozen/black counts without positions, location notes about the pre-strip original, anything else.
  return { code: "recheck", severity: "info", fixable: false, detail: RECHECK_DETAIL };
}

/** True when the stored QA is a v2 result. */
export function isQaV2(qa: unknown): boolean {
  const q = qa as { version?: unknown; issues?: unknown } | null;
  return !!q && Number(q.version) === 2 && Array.isArray(q.issues);
}

/** The issues on a media row: v2 as stored (sanitised), legacy through the mapper (deduped by code). */
export function issuesOf(qa: unknown): QaIssue[] {
  if (isQaV2(qa)) return ((qa as { issues: unknown[] }).issues.map(cleanIssue).filter(Boolean) as QaIssue[]);
  const w = (qa as { warnings?: unknown } | null)?.warnings;
  if (!Array.isArray(w)) return [];
  const seen = new Set<string>();
  const out: QaIssue[] = [];
  for (const s of w) {
    if (typeof s !== "string" || !s.trim()) continue;
    const i = mapLegacyWarning(s);
    if (i && !seen.has(i.code)) {
      seen.add(i.code);
      out.push(i);
    }
  }
  return out;
}

/** Flagged = `fix` issues not dismissed. Info issues never count. */
export function flaggedIssues(issues: QaIssue[], dismissed: Iterable<string> = []): QaIssue[] {
  const d = new Set(dismissed);
  return issues.filter((i) => i.severity === "fix" && !d.has(i.code));
}

/** Library tags: the info issues, one per code. */
export function infoTags(issues: QaIssue[]): Array<{ code: string; label: string }> {
  const seen = new Set<string>();
  return issues.filter((i) => i.severity === "info" && !seen.has(i.code) && seen.add(i.code)).map((i) => ({ code: i.code, label: tagLabel(i.code) }));
}

const sortOps = (ops: Iterable<FixOp>): FixOp[] => {
  const s = new Set(ops);
  return FIX_OP_ORDER.filter((o) => s.has(o));
};

/** Every op the clip's (undismissed) fixable issues allow. */
export function availableOps(issues: QaIssue[], dismissed: Iterable<string> = []): FixOp[] {
  const d = new Set(dismissed);
  return sortOps(issues.filter((i) => i.fixable && !d.has(i.code) && OP_FOR_CODE[i.code]).map((i) => OP_FOR_CODE[i.code]!));
}

/** "Fix it" default: the fixable `fix` issues only (opt-in ops excluded). */
export function defaultOps(issues: QaIssue[], dismissed: Iterable<string> = []): FixOp[] {
  return availableOps(flaggedIssues(issues, dismissed), []).filter((o) => !OPT_IN_OPS.includes(o));
}

/** Requested ops → the ones this clip allows (unknown strings dropped); undefined → the default set. */
export function resolveOps(issues: QaIssue[], requested: readonly string[] | undefined, dismissed: Iterable<string> = []): FixOp[] {
  if (!requested) return defaultOps(issues, dismissed);
  const allowed = new Set(availableOps(issues, dismissed));
  return sortOps(requested.filter((o): o is FixOp => allowed.has(o as FixOp)));
}

/** Library deep link that lands on one clip: the search narrows, `focus` puts it first. */
export function focusHref(label: string, mediaId: string): string {
  return `/library?q=${encodeURIComponent(label)}&focus=${encodeURIComponent(mediaId)}`;
}
