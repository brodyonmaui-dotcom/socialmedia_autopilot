// Cross-post backfill: which Instagram reels are not yet on YouTube / TikTok, and a paced plan to catch up.
// Pure functions only (no network, no DB): the CLI in scripts/skills/backfill.ts feeds them.
// Bias: when unsure, an IG reel is "check" (a human decides), never "missing". A wrong "missing" is a double post.

export type Target = "youtube" | "tiktok";

export interface SourcePost {
  id: string;
  caption: string;
  timestamp: string; // ISO
  permalink?: string;
  /** IG omits media_url for reels with licensed audio (research.md): the IG version was cut to a song. */
  licensedAudio?: boolean;
}

export interface TargetPost {
  id: string;
  /** YouTube: title + "\n" + description. TikTok: caption. */
  text: string;
  timestamp: string; // published or scheduled time, ISO
  /** Where we saw it: the platform itself, Zernio's own queue, or our outbox/batches. */
  via: "platform" | "zernio-queue" | "outbox";
}

export interface Snapshot {
  takenAt: string;
  instagram: SourcePost[];
  youtube: TargetPost[];
  tiktok: TargetPost[];
  /** Oldest timestamp each target listing is known to cover; IG reels older than this are "check". */
  coverageFrom?: Partial<Record<Target, string>>;
}

export type Verdict = "posted" | "missing" | "check";

export interface MatchResult {
  ig: SourcePost;
  series: SeriesInfo | null;
  verdict: Record<Target, Verdict>;
  matchedId: Partial<Record<Target, string>>;
  reason: Partial<Record<Target, string>>;
}

export interface SeriesInfo {
  /** Normalized caption with the day number removed, first 6 words: groups "Day 13 of …" posts. */
  key: string;
  day: number;
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "it", "my", "i", "this", "that", "with", "at", "be"]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/not financial advice\.?/g, " ")
    .replace(/[^\p{L}\p{N}\s/$+.-]/gu, " ")
    .replace(/(?<!\d)[.](?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter((t) => t.length > 1 && !STOP.has(t)));
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  // Mean of overlap (a YouTube title is a short subset of the IG caption, which Jaccard under-scores)
  // and Jaccard (so a 4-word title sharing 3 common words isn't a match on its own).
  const overlap = inter / Math.min(ta.size, tb.size);
  const jaccard = inter / (ta.size + tb.size - inter);
  return (overlap + jaccard) / 2;
}

const DAY_RE = /\bday\s*#?\s*(\d{1,4})\b/i;
const DAY_RE_G = /\bday\s*#?\s*(\d{1,4})\b/gi;

export function seriesOf(caption: string): SeriesInfo | null {
  const m = DAY_RE.exec(caption);
  if (!m) return null;
  const rest = normalize(caption.replace(DAY_RE, " ")).replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim();
  const key = rest.split(" ").filter((t) => !STOP.has(t)).slice(0, 6).join(" ");
  return { key: key || "day-series", day: Number(m[1]) };
}

/** Same day number is only a match if the series words overlap too (two "Day N" series can run at once). */
export function seriesWordsOverlap(a: string, b: string): number {
  const clean = (x: string) => new Set([...tokens(x.replace(DAY_RE_G, " "))].filter((t) => !/^\d+$/.test(t) && t !== "day"));
  const ta = clean(a);
  const tb = clean(b);
  if (!ta.size || !tb.size) return ta.size === tb.size ? 1 : 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

const DAY_MS = 86_400_000;

/**
 * One IG reel against one platform's posts.
 * - Series posts ("Day 13"): posted iff a target has the same day number and shares the series words.
 * - Others: posted at similarity ≥ 0.6; 0.35–0.6 → check; below → missing.
 * - Targets published more than a day before the IG reel can't be its copy (except outbox/queue rows).
 */
export function matchOne(ig: SourcePost, targets: TargetPost[], coverageFrom?: string): { verdict: Verdict; id?: string; reason: string } {
  const igTime = Date.parse(ig.timestamp);
  const series = seriesOf(ig.caption);
  let best: { score: number; post: TargetPost } | null = null;
  for (const t of targets) {
    if (t.via === "platform" && Date.parse(t.timestamp) < igTime - DAY_MS) continue;
    let score = similarity(ig.caption, t.text);
    if (series) {
      const ts = seriesOf(t.text);
      if (ts && ts.day === series.day) score = Math.max(score, seriesWordsOverlap(ig.caption, t.text) >= 0.25 ? 1 : 0.5);
      else if (ts && ts.day !== series.day) score = Math.min(score, 0.3); // a different episode is never this one
    }
    if (!best || score > best.score) best = { score, post: t };
  }
  if (best && best.score >= 0.6) return { verdict: "posted", id: best.post.id, reason: `match ${best.score.toFixed(2)} (${best.post.via})` };
  if (coverageFrom && igTime < Date.parse(coverageFrom)) return { verdict: "check", reason: "older than the platform listing covers" };
  if (best && best.score >= 0.35) return { verdict: "check", id: best.post.id, reason: `weak match ${best.score.toFixed(2)} (${best.post.via})` };
  return { verdict: "missing", reason: best ? `best ${best.score.toFixed(2)}` : "no posts to compare" };
}

export function diff(s: Snapshot): MatchResult[] {
  const reels = [...s.instagram].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return reels.map((ig) => {
    const out: MatchResult = { ig, series: seriesOf(ig.caption), verdict: { youtube: "check", tiktok: "check" }, matchedId: {}, reason: {} };
    for (const target of ["youtube", "tiktok"] as const) {
      const r = matchOne(ig, s[target], s.coverageFrom?.[target]);
      out.verdict[target] = r.verdict;
      if (r.id) out.matchedId[target] = r.id;
      out.reason[target] = r.reason;
    }
    return out;
  });
}

export interface Pace {
  /** Backfill posts per day per platform, on top of the regular plan. */
  perDay: Record<Target, number>;
}

export interface QueueEntry {
  ig: SourcePost;
  target: Target;
  /** 0-based day offset from the start date. */
  day: number;
  /** TikTok: the IG reel had licensed audio → send as an inbox draft, add the sound in-app. */
  tiktokDraft: boolean;
}

/**
 * Orders the missing posts per platform and assigns each a day.
 * - Oldest first; a series always goes in day-number order (Day 8 before Day 9 on every platform),
 *   so a lagging platform never shows an episode before the ones that come before it.
 * - Days fill in order (never back-filled), so the posting order is exactly the queue order.
 * - TikTok drafts (licensed-audio reels) are capped per day so pending drafts stay under TikTok's 5.
 */
export function buildQueue(results: MatchResult[], pace: Pace, opts: { maxTikTokDraftsPerDay?: number } = {}): QueueEntry[] {
  const maxDrafts = opts.maxTikTokDraftsPerDay ?? 3;
  const out: QueueEntry[] = [];
  for (const target of ["youtube", "tiktok"] as const) {
    const missing = results
      .filter((r) => r.verdict[target] === "missing")
      .sort((a, b) => Date.parse(a.ig.timestamp) - Date.parse(b.ig.timestamp));
    // Within a series, re-seat the episodes in day order on the slots the series already holds.
    const ordered = [...missing];
    for (const key of new Set(missing.filter((r) => r.series).map((r) => r.series!.key))) {
      const idx = ordered.map((r, i) => (r.series?.key === key ? i : -1)).filter((i) => i >= 0);
      const eps = idx.map((i) => ordered[i]!).sort((a, b) => a.series!.day - b.series!.day);
      idx.forEach((i, k) => (ordered[i] = eps[k]!));
    }
    const perDay = Math.max(1, pace.perDay[target]);
    const used: number[] = [];
    const drafts: number[] = [];
    let prev = 0; // monotonic: a later entry never lands on an earlier day than the one before it
    for (const r of ordered) {
      const draft = target === "tiktok" && !!r.ig.licensedAudio;
      let d = prev;
      while ((used[d] ?? 0) >= perDay || (draft && (drafts[d] ?? 0) >= maxDrafts)) d++;
      used[d] = (used[d] ?? 0) + 1;
      if (draft) drafts[d] = (drafts[d] ?? 0) + 1;
      prev = d;
      out.push({ ig: r.ig, target, day: d, tiktokDraft: draft });
    }
  }
  return out;
}

export interface Summary {
  reels: number;
  byTarget: Record<Target, Record<Verdict, number>>;
  daysToClear: Record<Target, number>;
  /** IG series whose newest episode is ahead of a platform's newest posted one. */
  seriesGaps: { key: string; target: Target; igLatest: number; targetLatest: number | null }[];
}

export function summarize(results: MatchResult[], queue: QueueEntry[]): Summary {
  const zero = (): Record<Verdict, number> => ({ posted: 0, missing: 0, check: 0 });
  const byTarget = { youtube: zero(), tiktok: zero() };
  for (const r of results) for (const t of ["youtube", "tiktok"] as const) byTarget[t][r.verdict[t]]++;
  const daysToClear = { youtube: 0, tiktok: 0 };
  for (const q of queue) daysToClear[q.target] = Math.max(daysToClear[q.target], q.day + 1);
  const seriesGaps: Summary["seriesGaps"] = [];
  const keys = [...new Set(results.filter((r) => r.series).map((r) => r.series!.key))];
  for (const key of keys) {
    const eps = results.filter((r) => r.series?.key === key);
    const igLatest = Math.max(...eps.map((r) => r.series!.day));
    for (const t of ["youtube", "tiktok"] as const) {
      const posted = eps.filter((r) => r.verdict[t] === "posted").map((r) => r.series!.day);
      const targetLatest = posted.length ? Math.max(...posted) : null;
      if (targetLatest === null || targetLatest < igLatest) seriesGaps.push({ key, target: t, igLatest, targetLatest });
    }
  }
  return { reels: results.length, byTarget, daysToClear, seriesGaps };
}

/** The markdown report a human reads (logs/, gitignored). Captions are the creator's own public text. */
export function formatReport(s: Snapshot, results: MatchResult[], queue: QueueEntry[], pace: Pace): string {
  const sum = summarize(results, queue);
  const L: string[] = [];
  L.push(`# Cross-post backfill: ${s.takenAt.slice(0, 10)}`, "");
  L.push(`${sum.reels} Instagram reels compared. Pace: YouTube +${pace.perDay.youtube}/day, TikTok +${pace.perDay.tiktok}/day on top of the regular plan.`, "");
  L.push("| | posted | missing | check | days to clear |", "|---|---|---|---|---|");
  for (const t of ["youtube", "tiktok"] as const) L.push(`| ${t} | ${sum.byTarget[t].posted} | ${sum.byTarget[t].missing} | ${sum.byTarget[t].check} | ${sum.daysToClear[t]} |`);
  if (sum.seriesGaps.length) {
    L.push("", "## Series gaps", "");
    for (const g of sum.seriesGaps) L.push(`- "${g.key}" on ${g.target}: Instagram is at day ${g.igLatest}, ${g.target} at ${g.targetLatest ?? "none"}. New episodes should wait on ${g.target} until the gap closes.`);
  }
  for (const v of ["check", "missing"] as const) {
    L.push("", `## ${v === "check" ? "Check by hand (could already be posted; never auto-scheduled)" : "Missing (queued below)"}`, "");
    L.push("| IG date | caption (first line) | YouTube | TikTok | link |", "|---|---|---|---|---|");
    for (const r of results.filter((x) => x.verdict.youtube === v || x.verdict.tiktok === v)) {
      const first = r.ig.caption.split("\n")[0]!.slice(0, 70).replace(/\|/g, "/");
      const cell = (t: Target) => (r.verdict[t] === v ? `${v}: ${r.reason[t]}` : r.verdict[t]);
      L.push(`| ${r.ig.timestamp.slice(0, 10)} | ${first}${r.ig.licensedAudio ? " 🎵" : ""} | ${cell("youtube")} | ${cell("tiktok")} | ${r.ig.permalink ?? ""} |`);
    }
  }
  L.push("", "🎵 = the IG version used licensed audio: YouTube gets the master with its original audio; TikTok goes as an inbox draft so the sound is added in the app.");
  L.push("", "## Queue (day offset → platform → reel)", "");
  for (const q of [...queue].sort((a, b) => a.day - b.day || a.target.localeCompare(b.target))) {
    L.push(`- day ${q.day + 1} · ${q.target}${q.tiktokDraft ? " (draft)" : ""} · ${q.ig.timestamp.slice(0, 10)} · ${q.ig.caption.split("\n")[0]!.slice(0, 60)}`);
  }
  return L.join("\n") + "\n";
}
