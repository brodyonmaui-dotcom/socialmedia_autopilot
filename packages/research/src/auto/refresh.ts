import { sanitizeForLog } from "@autopilot/core";
import yapBundle from "../../data/yap-2026-11-16.json" with { type: "json" };
import type { CreatorSnapshot } from "../brief.js";
import { DiscoveryRateLimitError } from "../discovery.js";
import type { QueryPool } from "../store.js";
import type { Creator } from "../types.js";
import { lintText } from "../voice-lint.js";
import { AI_NOTE_ESTIMATE_TOKENS, AI_NOTES_PURPOSE, canSpend, checkAiNotes, firstOfMonthUtc, type NoteWriter, type TokenUsage } from "./ai-notes.js";
import { hookLine } from "./hook-line.js";
import { nicheIdeas } from "./niche.js";
import { aboutFromCode, adaptFromCode, HOOK_TEMPLATES } from "./notes.js";
import { classifyPattern, PATTERN_LABEL, type AutoPattern } from "./patterns.js";
import { rankMedia } from "./rank.js";
import type { YapData } from "./yap.js";

/**
 * research-refresh (decisions.md §4 addendum 2026-11-16): one run of "research that runs itself".
 * For up to 10 active Instagram creators: Business Discovery (read-only) → creator_media → rank →
 * ideas (source 'creator') + hooks; then 3 niche ideas; then the bundled yap scripts (idempotent);
 * then optional AI notes within the monthly token budget; one research_runs row per run.
 * Writes only to our own tables, so it runs in dry-run too (same as analytics-ingest).
 * Every insert is `on conflict (source_key) do nothing`: re-runs never duplicate, never overwrite his edits.
 */

export const RESEARCH_REFRESH_CRON = "17 5 */3 * *"; // 05:17 UTC on days 1,4,7,…: every 3 days (resets at month start)
export const RESEARCH_MAX_CREATORS = 10;
export const DEFAULT_NICHE_PILLARS = ["gym", "trading", "lifestyle"] as const;

/** The next time RESEARCH_REFRESH_CRON fires after `from`. */
export function nextRefreshAt(from: Date): Date {
  const d0 = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let i = 0; i < 40; i++) {
    const d = new Date(d0 + i * 86_400_000);
    if ((d.getUTCDate() - 1) % 3 !== 0) continue;
    const at = new Date(d.getTime() + (5 * 60 + 17) * 60_000);
    if (at.getTime() > from.getTime()) return at;
  }
  return new Date(d0 + 3 * 86_400_000);
}

export function mondayOf(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

export const BUNDLED_YAP: YapData = yapBundle as YapData;

export interface RefreshDeps {
  /** Business Discovery per creator; null = no Instagram credentials (niche + scripts still run). */
  discover: ((c: Creator) => Promise<CreatorSnapshot>) | null;
  /** Only when research.aiNotes is on AND RESEARCH_AI_NOTES=1 (the worker decides). */
  noteWriter?: NoteWriter | null;
  aiMonthlyTokens?: number;
  yap?: YapData;
  pillars?: readonly string[];
  maxCreators?: number;
  now?: Date;
  blocklist?: string[];
  log?: (line: string) => void;
}

export interface RefreshResult {
  runId: string;
  status: "ok" | "partial" | "failed";
  creatorsChecked: number;
  ideasAdded: { creator: number; niche: number; script: number };
  hooksAdded: number;
  aiNotes: number;
  note: string;
}

const failsPrivacy = (texts: string[], blocklist?: string[]) =>
  texts.some((t) => t && lintText({ text: t, kind: "hook", blocklist }).issues.some((i) => i.rule.startsWith("privacy.")));
const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function toCreatorRow(r: any): Creator {
  return {
    id: r.id,
    platform: r.platform,
    handle: r.handle,
    pillar: r.pillar,
    notes: r.notes,
    followers: r.followers,
    active: r.active,
    lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

interface NewCreatorIdea {
  id: string;
  creator: Creator;
  kind: string;
  hookLine: string;
  ratio: number;
  pattern: AutoPattern;
  about: string;
  adapt: string;
}

export async function runResearchRefresh(pool: QueryPool, deps: RefreshDeps): Promise<RefreshResult> {
  const now = deps.now ?? new Date();
  const log = deps.log ?? (() => {});
  const notes: string[] = [];
  const res: RefreshResult = { runId: "", status: "ok", creatorsChecked: 0, ideasAdded: { creator: 0, niche: 0, script: 0 }, hooksAdded: 0, aiNotes: 0, note: "" };
  res.runId = (await pool.query("insert into research_runs (started_at, status) values ($1, 'running') returning id", [now.toISOString()])).rows[0].id;

  try {
    // ---------- tracked creators (Instagram Business Discovery) ----------
    const fresh: NewCreatorIdea[] = [];
    if (!deps.discover) {
      notes.push("no Instagram credentials: creators skipped, niche + scripts only");
    } else {
      const creators = (
        await pool.query(
          "select * from creators where active and platform = 'instagram' order by last_checked_at asc nulls first, handle limit $1",
          [deps.maxCreators ?? RESEARCH_MAX_CREATORS],
        )
      ).rows.map(toCreatorRow);
      for (const c of creators) {
        let snap: CreatorSnapshot;
        try {
          snap = await deps.discover(c);
        } catch (err) {
          if (err instanceof DiscoveryRateLimitError) {
            notes.push(`rate limited at @${c.handle}: run ended, the next run continues`);
            res.status = "partial";
            break;
          }
          notes.push(`@${c.handle} skipped: ${clip(sanitizeForLog((err as Error).message ?? String(err)))}`);
          res.status = "partial";
          continue;
        }
        res.creatorsChecked++;
        for (const p of snap.posts) {
          await pool.query(
            `insert into creator_media (creator_id, platform_media_id, permalink, kind, hook_line, like_count, comments_count, published_at, first_seen_at, last_seen_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
             on conflict (creator_id, platform_media_id) do update set
               permalink = coalesce(excluded.permalink, creator_media.permalink), kind = excluded.kind, hook_line = excluded.hook_line,
               like_count = excluded.like_count, comments_count = excluded.comments_count, last_seen_at = excluded.last_seen_at`,
            [c.id, p.id, p.permalink ?? null, p.mediaType, hookLine(p.caption, deps.blocklist), p.likes, p.comments, p.postedAt, now.toISOString()],
          );
        }
        await pool.query("update creators set last_checked_at = $2, followers = coalesce($3, followers) where id = $1", [c.id, now.toISOString(), snap.followers]);

        const keys = snap.posts.map((p) => `ig-${p.id}`);
        const done = new Set<string>((await pool.query("select source_key from ideas where source_key = any($1::text[])", [keys])).rows.map((r) => String(r.source_key).slice(3)));
        for (const r of rankMedia(snap, { now, exclude: done, blocklist: deps.blocklist })) {
          const pattern = classifyPattern(r.hookLine);
          const about = aboutFromCode({ kind: r.post.mediaType, hookLine: r.hookLine, ratio: r.ratio, pattern }, c);
          const adapt = adaptFromCode(pattern, c.pillar);
          const title = `${cap(PATTERN_LABEL[pattern])} hook from @${c.handle}`.slice(0, 140);
          if (failsPrivacy([title, about], deps.blocklist)) continue;
          const key = `ig-${r.post.id}`;
          const url = r.post.permalink ?? null;
          const ins = await pool.query(
            `insert into ideas (title, pillar, stage, source, source_key, reference_url, about, adapt, pattern, score, notes_by, source_creator_id)
             values ($1, $2, 'idea', 'creator', $3, $4, $5, $6, $7, $8, 'code', $9)
             on conflict (source_key) where source_key is not null do nothing returning id`,
            [title, c.pillar, key, url, about, adapt, pattern, Math.round(r.score * 1000) / 1000, c.id],
          );
          if (ins.rows[0]) {
            res.ideasAdded.creator++;
            fresh.push({ id: ins.rows[0].id, creator: c, kind: r.post.mediaType, hookLine: r.hookLine, ratio: r.ratio, pattern, about, adapt });
          }
          const h = await pool.query(
            `insert into hooks (text, pillar, source, source_creator_id, source_key, reference_url, pattern, template)
             values ($1, $2, 'creator', $3, $4, $5, $6, $7)
             on conflict (source_key) where source_key is not null do nothing returning id`,
            [`“${r.hookLine}” (@${c.handle})`, c.pillar, c.id, key, url, pattern, HOOK_TEMPLATES[pattern]],
          );
          if (h.rows[0]) res.hooksAdded++;
        }
      }
    }

    // ---------- his own niches ----------
    const nicheKeys = new Set<string>((await pool.query("select source_key from ideas where source = 'niche' and source_key is not null")).rows.map((r) => r.source_key));
    for (const n of nicheIdeas(deps.pillars ?? DEFAULT_NICHE_PILLARS, mondayOf(now), nicheKeys)) {
      if (failsPrivacy([n.title, n.hook, n.about, n.adapt], deps.blocklist)) continue;
      const ins = await pool.query(
        `insert into ideas (title, pillar, stage, hook, source, source_key, about, adapt, pattern, notes_by)
         values ($1, $2, 'idea', $3, 'niche', $4, $5, $6, $7, 'code')
         on conflict (source_key) where source_key is not null do nothing returning id`,
        [n.title, n.pillar, n.hook, n.sourceKey, n.about, n.adapt, classifyPattern(n.hook)],
      );
      if (ins.rows[0]) res.ideasAdded.niche++;
    }

    // ---------- bundled yap scripts (idempotent; never overwrites his edits) ----------
    const yap = deps.yap ?? BUNDLED_YAP;
    for (const y of yap.ideas) {
      if (failsPrivacy([y.title, y.hook, y.about, y.script], deps.blocklist)) continue;
      const ins = await pool.query(
        `insert into ideas (title, pillar, stage, hook, script, source, source_key, reference_url, about, adapt, pattern, notes_by)
         values ($1, $2, 'scripted', $3, $4, 'script', $5, $6, $7, '', $8, 'manual')
         on conflict (source_key) where source_key is not null do nothing returning id`,
        [y.title, y.pillar, y.hook, y.script, y.sourceKey, y.referenceUrl, y.about, classifyPattern(y.hook)],
      );
      if (ins.rows[0]) res.ideasAdded.script++;
    }
    for (const h of yap.hooks) {
      if (failsPrivacy([h.text], deps.blocklist)) continue;
      const ins = await pool.query(
        `insert into hooks (text, pillar, source, source_key, pattern, template)
         values ($1, $2, 'script', $3, $4, '')
         on conflict (source_key) where source_key is not null do nothing returning id`,
        [h.text, h.pillar, h.sourceKey, h.pattern],
      );
      if (ins.rows[0]) res.hooksAdded++;
    }

    // ---------- optional AI notes, inside the monthly budget ----------
    if (deps.noteWriter && fresh.length) {
      const month = firstOfMonthUtc(now);
      const budget = deps.aiMonthlyTokens ?? 0;
      const row = (await pool.query("select input_tokens, output_tokens from ai_token_usage where month = $1 and purpose = $2", [month, AI_NOTES_PURPOSE])).rows[0];
      const usage: TokenUsage = { inputTokens: Number(row?.input_tokens ?? 0), outputTokens: Number(row?.output_tokens ?? 0) };
      let discarded = 0;
      for (const f of fresh) {
        if (!canSpend(usage, budget, AI_NOTE_ESTIMATE_TOKENS)) {
          notes.push("AI notes: monthly token budget used up, code notes kept");
          break;
        }
        const req = { kind: f.kind, creatorHandle: f.creator.handle, pillar: f.creator.pillar, pattern: f.pattern, hookLine: f.hookLine, ratio: f.ratio, codeAbout: f.about, codeAdapt: f.adapt };
        const out = await deps.noteWriter.write(req);
        // Unknown usage (error before a response) counts as the estimate, so the budget can't be outrun.
        const spent = out.usage.inputTokens + out.usage.outputTokens > 0 ? out.usage : { inputTokens: AI_NOTE_ESTIMATE_TOKENS, outputTokens: 0 };
        usage.inputTokens += spent.inputTokens;
        usage.outputTokens += spent.outputTokens;
        await pool.query(
          `insert into ai_token_usage (month, purpose, input_tokens, output_tokens) values ($1, $2, $3, $4)
           on conflict (month, purpose) do update set input_tokens = ai_token_usage.input_tokens + excluded.input_tokens,
             output_tokens = ai_token_usage.output_tokens + excluded.output_tokens`,
          [month, AI_NOTES_PURPOSE, spent.inputTokens, spent.outputTokens],
        );
        if (!out.notes || checkAiNotes(req, out.notes, deps.blocklist)) {
          discarded++;
          continue;
        }
        const upd = await pool.query("update ideas set about = $2, adapt = $3, notes_by = 'ai', updated_at = now() where id = $1 and notes_by = 'code' returning id", [
          f.id,
          out.notes.about.trim(),
          out.notes.adapt.trim(),
        ]);
        if (upd.rows[0]) res.aiNotes++;
      }
      if (discarded) notes.push(`AI notes: ${discarded} discarded by the checks, code notes kept`);
    }
  } catch (err) {
    res.status = "failed";
    notes.push(`failed: ${clip(sanitizeForLog((err as Error).message ?? String(err)))}`);
  }

  res.note = notes.join("\n");
  const ideas = res.ideasAdded.creator + res.ideasAdded.niche + res.ideasAdded.script;
  await pool.query(
    "update research_runs set finished_at = $2, status = $3, creators_checked = $4, ideas_added = $5, hooks_added = $6, note = $7 where id = $1",
    [res.runId, new Date().toISOString(), res.status, res.creatorsChecked, ideas, res.hooksAdded, res.note],
  );
  log(formatRefreshLine(res));
  return res;
}

export function formatRefreshLine(r: RefreshResult): string {
  const i = r.ideasAdded;
  return `[research] ${r.status} · creators ${r.creatorsChecked} · ideas +${i.creator + i.niche + i.script} (creator ${i.creator}, niche ${i.niche}, script ${i.script}) · hooks +${r.hooksAdded}${r.aiNotes ? ` · ai notes ${r.aiNotes}` : ""}${r.note ? ` · ${r.note.split("\n")[0]}` : ""}`;
}

/** True when research-refresh has never run (the worker then queues one at start). */
export async function researchNeverRan(pool: QueryPool): Promise<boolean> {
  return (await pool.query("select 1 from research_runs limit 1")).rows.length === 0;
}
