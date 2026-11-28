import { classifyVideoUse, extractHashtags, judgeWarnings, findCapBreaches, localDate, videoUseMessage, type CadenceSettings, type ClipSibling, type Platform, type VideoMatchWhy, type VideoRelation } from "@autopilot/core";
import { isPillar, lintText } from "@autopilot/research";
import type { BatchItemView, Warning } from "./types.js";

export interface WarningContext {
  now: Date;
  cadence: CadenceSettings;
  /** TZ_CREATOR; caps count creator-local days. */
  timeZone: string;
  /** Posts already committed in other batches, so caps account for them. */
  existing: Array<{ platform: Platform; scheduledFor: string }>;
  /** PRIVACY_BLOCKLIST terms (from .env at runtime). */
  blocklist: string[];
  /**
   * Duplicate guard v2 (F26 A): other batch_items (any batch, any time) that use the same video or its footage on the
   * same platforms, fetched by the loader (loadClipSiblings → @autopilot/db loadVideoUses). This batch's own items are
   * added here, with their current (or planned) times, so a Move is re-checked against the new time. Optional: absent =
   * this batch only.
   */
  clipSiblings?: ClipSibling[];
  /** media id → its same-video / derived media (@autopilot/db videoFamily). Absent = only the same media id matches. */
  videoFamilies?: Map<string, Map<string, { relation: VideoRelation; why: VideoMatchWhy }>>;
  /** F26 judge: other posts' captions (last 30 days, any batch). Absent = only this batch is compared. */
  recentPosts?: Array<{ id: string; platform: Platform; caption: string }>;
}


const PLACEHOLDER = /\{\{[^}]*\}\}/;
/** Covered by our own "placeholder" warning; dropped from lint output so the same problem isn't shown twice. */
const LINT_RULES_COVERED = new Set(["numbers.placeholder"]);

const capKey = (platform: Platform, day: string) => `${platform}|${day}`;
const captionKey = (i: BatchItemView) => `${i.platform}|${i.caption.trim().toLowerCase()}`;
const mediaKey = (i: BatchItemView) => `${i.platform}|${i.mediaId}`;
/** Same normalisation as the Instagram adapter's existence check (NFC, whitespace collapsed, trimmed, lower-cased). */
const igCaptionNorm = (c: string) => c.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
const IG_SAME_CAPTION_WINDOW_MS = 36 * 3_600_000;

function tally(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

/** itemId → warnings. Only draft/approved items are checked; everything else gets []. Pure. */
export function computeWarnings(items: BatchItemView[], ctx: WarningContext): Map<string, Warning[]> {
  const out = new Map<string, Warning[]>();
  const nowMs = ctx.now.getTime();

  // Caps: other batches + this batch's live, timed items.
  // Unparseable times are reported as time.missing below and left out here (localDate would throw).
  const counted = items.filter(
    (i) => i.scheduledFor != null && !Number.isNaN(new Date(i.scheduledFor).getTime()) && i.status !== "rejected" && i.status !== "failed",
  );
  const breaches = findCapBreaches(
    [...ctx.existing, ...counted.map((i) => ({ platform: i.platform, scheduledFor: i.scheduledFor! }))],
    ctx.cadence,
    ctx.timeZone,
  );
  const breachByKey = new Map(breaches.map((b) => [capKey(b.platform, b.localDate), b]));

  const live = items.filter((i) => i.status !== "rejected");
  const captionCounts = tally(live.filter((i) => i.caption.trim() !== "").map(captionKey));
  const mediaCounts = tally(live.map(mediaKey));
  // This batch's items win over the loader's copies (they may carry planned times).
  const own = new Set(items.map((i) => i.id));
  const siblings: ClipSibling[] = [
    ...(ctx.clipSiblings ?? []).filter((s) => !own.has(s.id)),
    ...items.map((i) => ({ id: i.id, mediaId: i.mediaId, platform: i.platform, status: i.status, scheduledFor: i.scheduledFor, publishedAt: i.scheduledFor, alreadyPosted: i.rejectReason === "already-posted" })),
  ];

  for (const item of items) {
    if (item.status !== "draft" && item.status !== "approved") {
      out.set(item.id, []);
      continue;
    }
    const ws: Warning[] = [];
    const pillar = isPillar(item.media.pillar) ? item.media.pillar : null;

    const lint = (text: string, kind: "caption" | "title") => {
      const res = lintText({ text, kind, platform: item.platform, pillar, blocklist: ctx.blocklist });
      for (const issue of res.issues) {
        if (LINT_RULES_COVERED.has(issue.rule)) continue;
        ws.push(
          issue.severity === "error"
            ? { code: "lint.error", severity: "block", message: issue.message, field: kind }
            : { code: "lint.warn", severity: "warn", message: issue.message, field: kind },
        );
      }
    };
    // An empty caption/title is reported once as caption.missing (below), not again as lint noise ("0 hashtags").
    const missing = (t: string | null) => item.platform !== "snapchat" && (t ?? "").trim() === "";
    if (!missing(item.caption)) lint(item.caption, "caption");
    if (item.platform === "youtube" && !missing(item.title)) lint(item.title ?? "", "title");

    if (PLACEHOLDER.test(item.caption)) ws.push({ code: "placeholder", severity: "block", message: "fill in the {{…}} placeholder", field: "caption" });
    if (item.title != null && PLACEHOLDER.test(item.title)) ws.push({ code: "placeholder", severity: "block", message: "fill in the {{…}} placeholder", field: "title" });

    // F15: nothing goes out without words. Snapchat is assisted (captions optional in the share sheet).
    if (item.platform !== "snapchat") {
      if (item.caption.trim() === "") ws.push({ code: "caption.missing", severity: "block", message: "needs a caption", field: "caption" });
      if (item.platform === "youtube" && (item.title ?? "").trim() === "") ws.push({ code: "caption.missing", severity: "block", message: "needs a title", field: "title" });
    }

    const editor = item.origin === "editor" ? item.editor ?? null : null;
    if (item.scheduledFor == null) {
      ws.push(
        editor
          ? { code: "time.missing", severity: "block", message: "No free slot today — move to tomorrow", field: "time" }
          : { code: "time.missing", severity: "block", message: "no time set", field: "time" },
      );
    } else {
      const at = new Date(item.scheduledFor);
      const ms = at.getTime();
      if (Number.isNaN(ms)) {
        ws.push({ code: "time.missing", severity: "block", message: "time is not a valid date", field: "time" });
      } else {
        if (ms <= nowMs) ws.push({ code: "time.past", severity: "block", message: "time is in the past", field: "time" });
        const b = breachByKey.get(capKey(item.platform, localDate(at, ctx.timeZone)));
        if (b) ws.push({ code: "cap.breach", severity: "block", message: `${b.platform}: ${b.count} posts on ${b.localDate}, cap ${b.cap}`, field: "time" });
      }
    }

    // Audit #1c: Instagram has no idempotency key; its existence check matches captions within ±36 h, so two live
    // Instagram posts with the same normalised caption that close together could be confused on a retry → block.
    const igTwin = item.platform === "instagram" && item.caption.trim() !== "" && item.scheduledFor != null && live.some((o) => {
      if (o.id === item.id || o.platform !== "instagram" || o.scheduledFor == null) return false;
      const d = Math.abs(Date.parse(o.scheduledFor) - Date.parse(item.scheduledFor!));
      return Number.isFinite(d) && d <= IG_SAME_CAPTION_WINDOW_MS && igCaptionNorm(o.caption) === igCaptionNorm(item.caption);
    });
    if (igTwin) {
      ws.push({ code: "duplicate.caption", severity: "block", message: "same caption as another Instagram post within 36 h: change one", field: "caption" });
    } else if (item.caption.trim() !== "" && (captionCounts.get(captionKey(item)) ?? 0) > 1) {
      ws.push({ code: "duplicate.caption", severity: "warn", message: `same caption as another ${item.platform} post this week`, field: "caption" });
    }
    // Duplicate guard v2 (F26 A): same video within 90 days → block ("This video was already posted on Instagram on
    // Fri Nov 20"); older, or footage with new edits → warn. Already-posted rejects count as posted.
    const family = ctx.videoFamilies?.get(item.mediaId);
    const use = classifyVideoUse({ id: item.id, mediaId: item.mediaId, platform: item.platform, scheduledFor: item.scheduledFor }, siblings, (m) => family?.get(m) ?? null, ctx.now);
    if (use.hit) {
      ws.push({ code: use.level === "block" ? "duplicate.clip" : "duplicate.footage", severity: use.level === "block" ? "block" : "warn", message: videoUseMessage(use, ctx.timeZone), itemId: use.hit.id });
    }
    if (use.level !== "block" && (mediaCounts.get(mediaKey(item)) ?? 0) > 1) {
      ws.push({ code: "duplicate.media", severity: "warn", message: `this video is planned twice this week for ${item.platform}` });
    }

    // F26 judge: platform best-practice checks (hashtag limits/relevance/repeats, near-duplicate captions, hook, length).
    if (item.caption.trim() !== "") {
      const others = [...(ctx.recentPosts ?? []), ...items.filter((o) => o.status !== "rejected" && o.status !== "failed").map((o) => ({ id: o.id, platform: o.platform, caption: o.caption }))].filter((o) => o.id !== item.id && o.platform === item.platform && o.caption.trim() !== "");
      ws.push(...judgeWarnings({ platform: item.platform, caption: item.caption, title: item.title, durationS: item.media.durationS, recent: { captions: others.map((o) => o.caption), hashtagSets: others.map((o) => extractHashtags(o.caption)) } }));
    }
    if (item.media.qaWarnings.length > 0) ws.push({ code: "media.qa", severity: "warn", message: `media QA: ${item.media.qaWarnings.join("; ")}` });
    if (!item.media.hasCleanFile) ws.push({ code: "media.no-clean-file", severity: "block", message: "no clean file in storage; run touch-up/ingest first" });

    if (item.platform === "tiktok" && item.tiktokDraft) {
      ws.push({ code: "tiktok.needs-sound", severity: "warn", message: "goes to the TikTok inbox as a draft: finish the sound in the app; max 5 pending drafts per 24 h" });
    }
    if (editor?.flags.includes("add-sound-in-app")) {
      ws.push({ code: "sound.in-app", severity: "warn", message: "add the sound in the app, or post as-is" });
    }
    if (editor?.flags.includes("tiktok-draft-limit")) {
      ws.push({ code: "tiktok.draft-limit", severity: "warn", message: "TikTok allows 5 pending inbox drafts per 24 h; this one may wait" });
    }
    if (item.platform === "youtube" && item.media.durationS != null && item.media.durationS > 60) {
      ws.push({ code: "yt.over-60s", severity: "warn", message: "over 60 s: licensed music in Shorts is limited to 60 s; fine if the audio is original" });
    }

    out.set(item.id, [...ws.filter((w) => w.severity === "block"), ...ws.filter((w) => w.severity === "warn")]);
  }
  return out;
}

export function hasBlock(ws: Warning[]): boolean {
  return ws.some((w) => w.severity === "block");
}
