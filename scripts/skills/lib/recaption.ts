// skill:recaption (F26 B): re-composes captions for the DRAFT items of a week that fail the judge. Dry run by default
// (prints a table, writes nothing); --apply stores the new captions through weekly-fill's writeFill, which re-checks
// under a row lock that every item is still a 'draft' (approved, queued, published and rejected items are never touched).
import {
  addCalendarDays,
  captionGroupFor,
  extractHashtags,
  judgePost,
  localToUtc,
  type JudgeResult,
  type Platform,
} from "../../../packages/core/src/index.js";
import { lintText } from "../../../packages/research/src/index.js";
import { basename, localSlot } from "./weekly-fill.js";
import type { InsertClient } from "./batch-draft.js";

export interface RecaptionItem {
  id: string;
  platform: Platform;
  caption: string;
  title: string | null;
  scheduledFor: string | null;
  durationS: number | null;
  pillar: string | null;
  /** Folder + file name of the clip. */
  clipContext: string;
}

export interface RecaptionRow {
  id: string;
  platform: Platform;
  when: string | null;
  before: JudgeResult;
  after: JudgeResult | null;
  /** New caption; null when the item passes, or nothing fresh could be composed. */
  caption: string | null;
  source: "ai" | "template" | "none" | "ok";
}

export type Composer = (i: { group: ReturnType<typeof captionGroupFor>; platform: Platform; clipContext: string; recentCaptions: string[]; recentHashtagSets: string[][]; seed: string }) => Promise<{ caption: string | null; source: "ai" | "template" | "none" }>;

/** Checks recaptioning can fix (a clip that is too long or a duplicate video are not caption problems). */
const CAPTION_CHECKS = /^(caption\.|hashtags\.|lint|title\.)/;
export const failsJudge = (r: JudgeResult): boolean => r.checks.some((c) => c.level !== "pass" && CAPTION_CHECKS.test(c.id));

const judge = (i: { platform: Platform; caption: string; title: string | null; durationS: number | null }, recentCaptions: string[], blocklist: string[]): JudgeResult =>
  judgePost({
    platform: i.platform,
    caption: i.caption,
    title: i.title,
    durationS: i.durationS,
    recent: { captions: recentCaptions, hashtagSets: recentCaptions.slice(0, 5).map(extractHashtags) },
    lint: (text, kind) => lintText({ text, kind, platform: i.platform, blocklist }).issues.map((x) => ({ severity: x.severity, message: x.message })),
  });

/**
 * Pure planner. `recentByPlatform` = captions of the last 30 days (newest first) from items outside this plan; the
 * captions composed here join the list as it goes, so two items of the week never get alike captions.
 */
export async function planRecaption(items: RecaptionItem[], recentByPlatform: Partial<Record<Platform, string[]>>, compose: Composer, opts: { blocklist?: string[] } = {}): Promise<RecaptionRow[]> {
  const blocklist = opts.blocklist ?? [];
  const recent: Partial<Record<Platform, string[]>> = {};
  for (const [p, list] of Object.entries(recentByPlatform)) recent[p as Platform] = [...(list ?? [])];
  const rows: RecaptionRow[] = [];
  for (const it of items) {
    const list = (recent[it.platform] ??= []);
    // `list` never holds this item's own text: it is the loader's recent captions plus the items of the plan handled before it
    const others = list;
    const before = judge(it, others, blocklist);
    if (!failsJudge(before)) {
      rows.push({ id: it.id, platform: it.platform, when: it.scheduledFor, before, after: null, caption: null, source: "ok" });
      list.unshift(it.caption);
      continue;
    }
    const c = await compose({
      group: captionGroupFor(it.pillar),
      platform: it.platform,
      clipContext: it.clipContext,
      recentCaptions: others,
      recentHashtagSets: others.slice(0, 5).map(extractHashtags),
      seed: `recaption:${it.id}`,
    });
    if (!c.caption) {
      rows.push({ id: it.id, platform: it.platform, when: it.scheduledFor, before, after: null, caption: null, source: "none" });
      continue;
    }
    const after = judge({ ...it, caption: c.caption }, others, blocklist);
    if (failsJudge(after)) {
      rows.push({ id: it.id, platform: it.platform, when: it.scheduledFor, before, after, caption: null, source: "none" });
      continue;
    }
    list.unshift(c.caption);
    rows.push({ id: it.id, platform: it.platform, when: it.scheduledFor, before, after, caption: c.caption, source: c.source });
  }
  return rows;
}

const firstLine = (s: string) => (s.split(/\r?\n/)[0] ?? "").slice(0, 48);

export function formatRecaptionTable(rows: RecaptionRow[]): string {
  const head = "id        platform   when                  before  after  action     new first line";
  const lines = rows.map((r) => {
    const action = r.source === "ok" ? "keep" : r.caption ? `recaption (${r.source})` : "needs hand";
    return `${r.id.slice(0, 8)}  ${r.platform.padEnd(9)}  ${(r.when ?? "no time").padEnd(20)}  ${String(r.before.score).padStart(6)}  ${r.after ? String(r.after.score).padStart(5) : "    -"}  ${action.padEnd(18)} ${r.caption ? firstLine(r.caption) : ""}`;
  });
  return [head, ...lines].join("\n");
}

export const RECAPTION_SQL = `
  select bi.id, bi.platform, bi.caption, bi.title, bi.scheduled_for, m.pillar, m.duration_s, m.source_path, __FOLDER__ as folder
    from batch_items bi
    join batches b on b.id = bi.batch_id
    join media m on m.id = bi.media_id
   where bi.status = 'draft'
     and b.status <> 'archived'
     and ((bi.scheduled_for >= $2 and bi.scheduled_for < $3) or (bi.scheduled_for is null and b.week_start = $1::date))
   order by bi.scheduled_for nulls last, bi.media_id, bi.platform, bi.id`;

export async function loadRecaptionItems(db: InsertClient, weekStart: string, timeZone: string): Promise<RecaptionItem[]> {
  const from = localToUtc(weekStart, "00:00", timeZone);
  const to = localToUtc(addCalendarDays(weekStart, 7), "00:00", timeZone);
  const hasFolder = (await db.query(`select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'media' and column_name = 'folder'`)).rows.length > 0;
  const { rows } = await db.query(RECAPTION_SQL.replace("__FOLDER__", hasFolder ? "m.folder" : "null::text"), [weekStart, from, to]);
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform as Platform,
    caption: r.caption ?? "",
    title: r.platform === "youtube" ? (r.title ?? "") : null,
    scheduledFor: localSlot(r.scheduled_for, timeZone),
    durationS: r.duration_s == null ? null : Number(r.duration_s),
    pillar: r.pillar ?? null,
    clipContext: [r.folder, (basename(r.source_path) ?? "").replace(/\.[^.]*$/, "")].filter(Boolean).join(" "),
  }));
}

/** Captions of the last 30 days per platform, newest first, excluding the given items (they are being judged). */
export async function loadRecentCaptions(db: InsertClient, now: Date, excludeIds: string[]): Promise<Record<string, string[]>> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { rows } = await db.query(
    `select platform, caption from batch_items where caption <> '' and status <> 'rejected' and created_at >= $1::timestamptz and not (id = any($2::uuid[])) order by created_at desc limit 600`,
    [since, excludeIds],
  );
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.platform] ??= []).push(String(r.caption));
  return out;
}
