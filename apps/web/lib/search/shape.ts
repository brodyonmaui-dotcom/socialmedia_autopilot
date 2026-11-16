// Pure result shaping for GET /app/api/search (no DB, no React). Tested in __tests__/shape.test.ts.
import { localDate, type Platform } from "@autopilot/core";
import { mediaLabel } from "../batches/pg-store.js";

export const MIN_QUERY = 2;
export const MAX_QUERY = 80;
export const PER_GROUP = 5;

export type SearchGroupId = "pages" | "posts" | "ideas" | "clips";
export type SearchResult = { id: string; title: string; meta: string; href: string };
export type SearchGroup = { id: SearchGroupId; label: string; results: SearchResult[] };
export type SearchResponse = { q: string; groups: SearchGroup[] };

export const GROUP_LABEL: Record<SearchGroupId, string> = { pages: "Pages", posts: "Posts", ideas: "Ideas", clips: "Clips" };

const PLATFORM_NAME: Record<Platform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", snapchat: "Snapchat" };
const STATUS_WORD: Record<string, string> = {
  draft: "Draft",
  approved: "Scheduled",
  queued: "Scheduled",
  publishing: "Posting",
  published: "Posted",
  failed: "Failed",
  unknown: "Check status",
  rejected: "Rejected",
};

/** The trimmed query, or null when it is too short to search (min 2 characters). Long input is cut at 80. */
export function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  return q.length >= MIN_QUERY ? q : null;
}

/** ILIKE pattern with %, _ and \ escaped (used with `escape '\'`), so user input is matched literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Static Pages group: label or keywords contain the query (case-insensitive), max 5. */
export function matchPages(pages: Array<{ label: string; href: string; keywords: string }>, q: string): SearchResult[] {
  const n = q.toLowerCase();
  return pages
    .filter((p) => p.label.toLowerCase().includes(n) || p.keywords.includes(n))
    .slice(0, PER_GROUP)
    .map((p) => ({ id: `page:${p.href}`, title: p.label, meta: "Page", href: p.href }));
}

/** One line of text: first non-empty line, tags/mentions/links kept as typed, max `max` chars with an ellipsis. */
export function oneLine(s: string | null | undefined, max = 70): string {
  const line = (s ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export type PostRow = {
  id: string;
  media_id: string;
  source_path: string | null;
  platform: string;
  title: string | null;
  caption: string | null;
  status: string;
  scheduled_for: Date | string | null;
};

/**
 * Posts group: one result per clip per day (its platforms listed together), in row order, max 5.
 * Links to the calendar day (`/calendar?day=YYYY-MM-DD`, creator zone); untimed posts link to the calendar.
 */
export function shapePosts(rows: PostRow[], timeZone: string): SearchResult[] {
  const groups = new Map<string, { row: PostRow; day: string | null; platforms: Platform[] }>();
  for (const r of rows) {
    const at = r.scheduled_for == null ? null : new Date(r.scheduled_for);
    const day = at && !Number.isNaN(at.getTime()) ? localDate(at, timeZone) : null;
    const key = `${r.media_id}|${day ?? "-"}`;
    const g = groups.get(key);
    if (g) {
      if (!g.platforms.includes(r.platform as Platform)) g.platforms.push(r.platform as Platform);
    } else groups.set(key, { row: r, day, platforms: [r.platform as Platform] });
  }
  return [...groups.values()].slice(0, PER_GROUP).map(({ row, day, platforms }) => {
    const label = mediaLabel(row.source_path, row.media_id);
    const title = oneLine(row.title) || oneLine(row.caption) || label;
    const when = day ? dayLabel(day) : "No time yet";
    const meta = [when, platforms.map((p) => PLATFORM_NAME[p] ?? p).join(", "), STATUS_WORD[row.status] ?? row.status].join(" · ");
    return { id: `post:${row.id}`, title, meta, href: day ? `/calendar?day=${day}` : "/calendar" };
  });
}

/** "Mon, Nov 16" for a YYYY-MM-DD calendar date. */
export function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export type IdeaRow = { id: string; kind: "idea" | "hook"; text: string; pillar: string | null };

/** Ideas group (ideas and hooks together, ideas first), max 5. */
export function shapeIdeas(rows: IdeaRow[]): SearchResult[] {
  return [...rows]
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "idea" ? -1 : 1))
    .slice(0, PER_GROUP)
    .map((r) => ({
      id: `${r.kind}:${r.id}`,
      title: oneLine(r.text) || "Untitled",
      meta: [r.kind === "idea" ? "Idea" : "Hook", r.pillar ? r.pillar[0]!.toUpperCase() + r.pillar.slice(1) : null].filter(Boolean).join(" · "),
      href: r.kind === "idea" ? "/research/ideas" : "/research/hooks",
    }));
}

export type ClipRow = { id: string; source_path: string | null; pillar: string | null; duration_s: number | string | null };

/** Clips group: the media label, linking to `/library?q=<label>`, max 5. */
export function shapeClips(rows: ClipRow[]): SearchResult[] {
  return rows.slice(0, PER_GROUP).map((r) => {
    const label = mediaLabel(r.source_path, r.id);
    const d = r.duration_s == null ? null : Math.round(Number(r.duration_s));
    const len = d == null || !Number.isFinite(d) ? null : `${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`;
    return {
      id: `clip:${r.id}`,
      title: label,
      meta: ["Clip", r.pillar ? r.pillar[0]!.toUpperCase() + r.pillar.slice(1) : null, len].filter(Boolean).join(" · "),
      href: `/library?q=${encodeURIComponent(label)}`,
    };
  });
}

/** Groups in fixed order (Pages, Posts, Ideas, Clips), empty groups dropped. */
export function buildResponse(q: string, parts: Partial<Record<SearchGroupId, SearchResult[]>>): SearchResponse {
  const order: SearchGroupId[] = ["pages", "posts", "ideas", "clips"];
  return {
    q,
    groups: order.filter((id) => (parts[id]?.length ?? 0) > 0).map((id) => ({ id, label: GROUP_LABEL[id], results: parts[id]!.slice(0, PER_GROUP) })),
  };
}
