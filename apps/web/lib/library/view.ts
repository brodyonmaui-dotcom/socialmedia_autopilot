/**
 * Pure view logic for /library and /touch-up (F12/5). No DB, no fs: pages pass rows in.
 */
import type { BadgeTone } from "../../components/ui/Badge.js";
import type { DisplayLine } from "../../components/ui/Display.js";

/** The columns both pages read from `media` (the touch-up query selects a subset). */
export interface ClipRow {
  id: string;
  pillar: string | null;
  duration_s: string | number | null;
  width?: number | null;
  height?: number | null;
  status?: string;
  qa: { warnings?: string[] } | null;
  source_path: string;
}

/** Last path segment for either separator. */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Seconds → "m:ss" (rounded); "—" when unknown or not a number. */
export function durationLabel(s: string | number | null | undefined): string {
  const n = Number(s);
  if (s == null || s === "" || !Number.isFinite(n) || n < 0) return "—";
  const total = Math.round(n);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "1080×1920", or null when either side is unknown. */
export function sizeLabel(w: number | null | undefined, h: number | null | undefined): string | null {
  return w && h ? `${w}×${h}` : null;
}

/** The ed-qa warnings on a row (strings only, blanks dropped). */
export function warningsOf(row: Pick<ClipRow, "qa">): string[] {
  const w = row.qa?.warnings;
  return Array.isArray(w) ? w.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

/** Media status → Badge. Ready = accent (good to batch), qa_fail = warn, the rest neutral. */
export function statusBadge(status: string | undefined): { label: string; tone: BadgeTone } {
  switch (status) {
    case "ready":
      return { label: "Ready", tone: "accent" };
    case "used":
      return { label: "Used", tone: "neutral" };
    case "qa_fail":
      return { label: "QA fail", tone: "warn" };
    case "qa_pass":
      return { label: "QA pass", tone: "neutral" };
    case "ingested":
      return { label: "Ingested", tone: "neutral" };
    default:
      return { label: status ? status.replace(/_/g, " ") : "Unknown", tone: "neutral" };
  }
}

/** Normalised search query from `?q=` (first value, trimmed, max 80 chars), or "" for none. */
export function parseQuery(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (v ?? "").trim().slice(0, 80);
}

/**
 * Client-side filter (no SQL): every whitespace-separated term must appear (case-insensitive) in the file
 * name, pillar, status or a warning. Empty query keeps every row.
 */
export function filterClips<T extends ClipRow>(rows: T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  return rows.filter((r) => {
    const hay = [basename(r.source_path), r.pillar ?? "", r.status ?? "", ...warningsOf(r)].join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** Hero lines: outline "Library", serif "in stock", the clip count solid. */
export function heroLines(count: number): DisplayLine[] {
  return [
    { text: "Library", style: "stroke" },
    { text: "in stock", style: "serif" },
    { text: String(Math.max(0, count)), style: "solid" },
  ];
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Clip count per pillar, largest first (ties by name); null pillar = "unsorted". */
export function pillarCounts(rows: Pick<ClipRow, "pillar">[]): { pillar: string; n: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const p = r.pillar?.trim() || "unsorted";
    m.set(p, (m.get(p) ?? 0) + 1);
  }
  return [...m.entries()].map(([pillar, n]) => ({ pillar, n })).sort((a, b) => b.n - a.n || a.pillar.localeCompare(b.pillar));
}

/** "gym 22 · tip 13 · …" capped at `max` pillars (+ "+N more"). */
export function pillarSummary(rows: Pick<ClipRow, "pillar">[], max = 4): string {
  const all = pillarCounts(rows);
  if (all.length === 0) return "—";
  const shown = all.slice(0, max).map((p) => `${p.pillar} ${p.n}`);
  return all.length > max ? `${shown.join(" · ")} · +${all.length - max} more` : shown.join(" · ");
}

/** Section head for the grid: "All clips" or "Matches" for a search, meta = shown count. */
export function gridHead(query: string, shown: number, total: number): { title: string; serif: string; meta: string } {
  if (!query) return { title: "All", serif: "clips", meta: plural(shown, "clip") };
  return { title: "Search", serif: "matches", meta: `${shown} of ${total} · “${query}”` };
}

/** Two-digit cell index (01, 02, … 100). */
export function cellIndex(i: number): string {
  return String(i + 1).padStart(2, "0");
}

/** Library link that searches for one file (touch-up → library). */
export function libraryHref(sourcePath: string): string {
  return `/library?q=${encodeURIComponent(basename(sourcePath))}`;
}
