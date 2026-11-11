import type { Platform } from "../../../packages/core/src/index.js";
import { isPillar, lintText, type LintIssue, type Pillar } from "../../../packages/research/src/index.js";

/**
 * The file the weekly-batch skill writes (Claude drafts the text, this checks it). Times are
 * optional: slot assignment belongs to the scheduler (F1); a draft without times can be checked
 * but not created.
 */
export interface DraftPost {
  caption: string;
  /** YouTube only. */
  title?: string;
  /** ISO 8601 with offset. */
  scheduledFor?: string;
  /** TikTok: sound-dependent posts go to the Creator Inbox as drafts (CLAUDE.md routes). */
  tiktokDraft?: boolean;
}
export interface DraftItem {
  mediaId: string;
  pillar: string;
  /** What the clip is, for the summary only. */
  label?: string;
  posts: Partial<Record<Platform, DraftPost>>;
}
export interface BatchDraft {
  weekStart: string; // YYYY-MM-DD
  items: DraftItem[];
}

export interface DraftFinding extends LintIssue {
  item: number;
  platform: Platform | "item";
  field: "caption" | "title" | "scheduledFor" | "mediaId" | "pillar" | "batch";
}
export interface DraftCheck {
  ok: boolean;
  /** true when every post has a time and the batch could be written as a draft. */
  creatable: boolean;
  posts: number;
  errors: number;
  warnings: number;
  findings: DraftFinding[];
}

const PLATFORMS: Platform[] = ["instagram", "youtube", "tiktok", "snapchat"];

export function checkDraft(draft: BatchDraft, opts: { blocklist?: string[]; now?: Date } = {}): DraftCheck {
  const findings: DraftFinding[] = [];
  const now = opts.now ?? new Date();
  let posts = 0;
  let missingTimes = 0;
  const seen = new Map<string, number>(); // platform|caption → item index (no copy-paste captions within a week)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.weekStart ?? "")) {
    findings.push({ item: -1, platform: "item", field: "batch", rule: "batch.week", severity: "error", message: "weekStart must be YYYY-MM-DD" });
  }

  draft.items.forEach((it, idx) => {
    const pillar: Pillar | null = isPillar(it.pillar) ? it.pillar : null;
    if (!pillar) findings.push({ item: idx, platform: "item", field: "pillar", rule: "item.pillar", severity: "error", message: `unknown pillar "${it.pillar}"` });
    if (!it.mediaId) findings.push({ item: idx, platform: "item", field: "mediaId", rule: "item.media", severity: "error", message: "mediaId missing" });

    for (const platform of PLATFORMS) {
      const post = it.posts[platform];
      if (!post) continue;
      posts++;
      const add = (field: DraftFinding["field"], i: LintIssue) => findings.push({ ...i, item: idx, platform, field });
      for (const i of lintText({ text: post.caption, kind: "caption", platform, pillar, blocklist: opts.blocklist }).issues) add("caption", i);
      if (platform === "youtube") {
        if (!post.title?.trim()) add("title", { rule: "youtube.title-missing", severity: "error", message: "YouTube needs a title" });
        else for (const i of lintText({ text: post.title, kind: "title", platform, pillar, blocklist: opts.blocklist }).issues) add("title", i);
      }
      if (platform === "tiktok" && post.tiktokDraft) {
        // batch_items has no column for Zernio's draft flag yet, so creating this would post it publicly
        // without the sound. Block until the adapter work (F4) stores it.
        add("caption", { rule: "tiktok.draft-unsupported", severity: "error", message: "TikTok inbox drafts aren't stored by batches yet; finish this one in the TikTok app" });
      }
      if (!post.caption.trim()) add("caption", { rule: "caption.empty", severity: "error", message: "empty caption" });
      const key = `${platform}|${post.caption.trim().toLowerCase()}`;
      if (post.caption.trim() && seen.has(key)) add("caption", { rule: "caption.duplicate", severity: "warn", message: `same ${platform} caption as item ${seen.get(key)! + 1}` });
      else seen.set(key, idx);

      if (!post.scheduledFor) missingTimes++;
      else {
        const t = Date.parse(post.scheduledFor);
        if (!Number.isFinite(t) || !/([+-]\d{2}:?\d{2}|Z)$/.test(post.scheduledFor)) {
          add("scheduledFor", { rule: "time.invalid", severity: "error", message: "scheduledFor must be ISO 8601 with an offset" });
        } else if (t <= now.getTime()) {
          add("scheduledFor", { rule: "time.past", severity: "error", message: "scheduledFor is in the past" });
        }
      }
    }
  });

  if (posts === 0) findings.push({ item: -1, platform: "item", field: "batch", rule: "batch.empty", severity: "error", message: "no posts in the draft" });
  const errors = findings.filter((f) => f.severity === "error").length;
  return {
    ok: errors === 0,
    creatable: errors === 0 && missingTimes === 0,
    posts,
    errors,
    warnings: findings.length - errors,
    findings,
  };
}

/** One connection (pg PoolClient), not a Pool: the begin/commit must run on the same connection. */
export interface InsertClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/**
 * Writes the draft as ONE batch with status 'draft' and its items with status 'draft'.
 * Never approves anything: approval is the creator's tap on the phone (non-negotiable 2).
 * Media must exist in the library. Callers run checkDraft first; this re-checks creatable.
 */
export async function createDraftBatch(pool: InsertClient, draft: BatchDraft, opts: { blocklist?: string[]; now?: Date } = {}): Promise<{ batchId: string; items: number }> {
  const check = checkDraft(draft, opts);
  if (!check.creatable) throw new Error(`draft not creatable: ${check.errors} error(s)${check.ok ? ", missing times" : ""}`);
  const mediaIds = [...new Set(draft.items.map((i) => i.mediaId))];
  const { rows: found } = await pool.query("select id from media where id = any($1)", [mediaIds]);
  const missing = mediaIds.filter((id) => !found.some((r) => r.id === id));
  if (missing.length) throw new Error(`${missing.length} mediaId(s) not in the library`);

  await pool.query("begin");
  try {
    const { rows } = await pool.query("insert into batches (week_start, status) values ($1, 'draft') returning id", [draft.weekStart]);
    const batchId = rows[0].id as string;
    let items = 0;
    for (const it of draft.items) {
      for (const platform of PLATFORMS) {
        const post = it.posts[platform];
        if (!post) continue;
        await pool.query(
          `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status)
           values ($1, $2, $3, $4, $5, $6, 'draft')`,
          [batchId, it.mediaId, platform, post.caption, platform === "youtube" ? (post.title ?? null) : null, post.scheduledFor],
        );
        items++;
      }
    }
    await pool.query("commit");
    return { batchId, items };
  } catch (err) {
    await pool.query("rollback");
    throw err;
  }
}

export function formatFindings(check: DraftCheck): string {
  return check.findings
    .map((f) => `${f.severity.toUpperCase()} item ${f.item + 1} ${f.platform} ${f.field}: ${f.message} [${f.rule}]`)
    .join("\n");
}
