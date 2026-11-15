// Turns the backfill queue into a weekly-batch draft file (same shape as scripts/skills/fixtures/draft-sample.json).
// Captions are adapted from the creator's own IG caption, per docs/voice.md platform tailoring.
// mediaId starts empty: the master file has to come from the library (IG strips licensed-audio reels' media_url,
// and IG re-encodes everything), so a human or the skill matches it before `weekly-batch check` passes.
import type { BatchDraft, DraftItem } from "./batch-draft.js";
import type { QueueEntry, Target } from "./backfill.js";

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

export function guessPillar(caption: string): string {
  if (/p\/l|\btrad(e|es|ing)\b|prop firm|nasdaq|\bict\b|#daytrading|liquidity|\bbos\b|\bsmt\b/i.test(caption)) return "trading";
  if (/meal|protein|full day of eating|macros/i.test(caption)) return "meal";
  if (/\brun(ning)?\b|blister|miles?\b/i.test(caption)) return "running";
  return "gym";
}

const DEFAULT_TAGS: Record<string, string[]> = {
  trading: ["#daytrading", "#nasdaq", "#ict", "#discipline", "#trading"],
  meal: ["#mealprep", "#highproteinmeals", "#fulldayofeating"],
  running: ["#running", "#discipline", "#collegefitness"],
  gym: ["#gym", "#gymbro", "#physique", "#hypertrophy"],
};

/** First non-empty line, hashtags and "Not financial advice." removed. */
export function hookLine(caption: string): string {
  const line = caption.split("\n").map((l) => l.replace(HASHTAG_RE, "").replace(/not financial advice\.?/i, "").trim()).find((l) => l.length > 0) ?? "";
  return line.replace(/\s+/g, " ");
}

function tagsFor(caption: string, pillar: string, n: number): string {
  const own = [...new Set(caption.match(HASHTAG_RE) ?? [])].map((t) => t.toLowerCase());
  return [...new Set([...own, ...(DEFAULT_TAGS[pillar] ?? DEFAULT_TAGS.gym!)])].slice(0, n).join(" ");
}

/** YouTube titles are ≤ 60 chars; cut on a word boundary and keep his trailing "…". */
export function ytTitle(line: string): string {
  if (line.length <= 60) return line;
  const cut = line.slice(0, 59);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 59).trimEnd()}…`;
}

export interface DraftOptions {
  weekStart: string;
  perDay: Record<Target, number>;
  /** Returns `days * perDay` slot instants for a platform, or null when the time zone is unknown. */
  slotsFor: ((target: Target, days: number) => Date[]) | null;
}

export function draftFromQueue(queue: QueueEntry[], opts: DraftOptions): BatchDraft {
  const items = new Map<string, DraftItem>();
  const slotIndex: Record<Target, number[]> = { youtube: [], tiktok: [] };
  const slots: Partial<Record<Target, Date[]>> = {};
  for (const t of ["youtube", "tiktok"] as const) {
    const days = Math.max(0, ...queue.filter((q) => q.target === t).map((q) => q.day + 1));
    if (opts.slotsFor && days) slots[t] = opts.slotsFor(t, days);
  }
  for (const q of queue) {
    const caption = q.ig.caption;
    const pillar = guessPillar(caption);
    const line = hookLine(caption);
    const nfa = pillar === "trading" ? " Not financial advice." : "";
    const item: DraftItem =
      items.get(q.ig.id) ??
      { mediaId: "", pillar, label: `IG ${q.ig.timestamp.slice(0, 10)} · ${line.slice(0, 50)} · ${q.ig.permalink ?? ""}`, posts: {} };
    const k = (slotIndex[q.target][q.day] = (slotIndex[q.target][q.day] ?? 0) + 1) - 1;
    const at = slots[q.target]?.[q.day * opts.perDay[q.target] + k];
    const when = at ? { scheduledFor: at.toISOString() } : {};
    if (q.target === "youtube") {
      item.posts.youtube = { title: ytTitle(line), caption: `${line}${nfa}\n\n${tagsFor(caption, pillar, 3)}`, ...when };
    } else {
      item.posts.tiktok = { caption: `${line}${nfa} ${tagsFor(caption, pillar, 4)}`, ...when, ...(q.tiktokDraft ? { tiktokDraft: true } : {}) };
    }
    items.set(q.ig.id, item);
  }
  return { weekStart: opts.weekStart, items: [...items.values()] };
}
