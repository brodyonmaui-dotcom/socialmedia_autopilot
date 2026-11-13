import { findCapBreaches, localDate, type CadenceSettings, type Platform } from "@autopilot/core";
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
}

const PLACEHOLDER = /\{\{[^}]*\}\}/;
/** Covered by our own "placeholder" warning; dropped from lint output so the same problem isn't shown twice. */
const LINT_RULES_COVERED = new Set(["numbers.placeholder"]);

const capKey = (platform: Platform, day: string) => `${platform}|${day}`;
const captionKey = (i: BatchItemView) => `${i.platform}|${i.caption.trim().toLowerCase()}`;
const mediaKey = (i: BatchItemView) => `${i.platform}|${i.mediaId}`;

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
    lint(item.caption, "caption");
    if (item.platform === "youtube") lint(item.title ?? "", "title");

    if (PLACEHOLDER.test(item.caption)) ws.push({ code: "placeholder", severity: "block", message: "fill in the {{…}} placeholder", field: "caption" });
    if (item.title != null && PLACEHOLDER.test(item.title)) ws.push({ code: "placeholder", severity: "block", message: "fill in the {{…}} placeholder", field: "title" });

    if (item.scheduledFor == null) {
      ws.push({ code: "time.missing", severity: "block", message: "no time set", field: "time" });
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

    if (item.caption.trim() !== "" && (captionCounts.get(captionKey(item)) ?? 0) > 1) {
      ws.push({ code: "duplicate.caption", severity: "warn", message: `same caption as another ${item.platform} post in this batch`, field: "caption" });
    }
    if ((mediaCounts.get(mediaKey(item)) ?? 0) > 1) {
      ws.push({ code: "duplicate.media", severity: "warn", message: `this video is in the batch twice for ${item.platform}` });
    }

    if (item.media.qaWarnings.length > 0) ws.push({ code: "media.qa", severity: "warn", message: `media QA: ${item.media.qaWarnings.join("; ")}` });
    if (!item.media.hasCleanFile) ws.push({ code: "media.no-clean-file", severity: "block", message: "no clean file in storage; run touch-up/ingest first" });

    if (item.platform === "tiktok" && item.tiktokDraft) {
      ws.push({ code: "tiktok.needs-sound", severity: "warn", message: "goes to the TikTok inbox as a draft: finish the sound in the app; max 5 pending drafts per 24 h" });
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
