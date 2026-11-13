import { pickReply, type RotationHistory } from "./rotation.js";
import type { ActionHistory, EngagementSettings, InboundComment, PlannedAction, TriageResult } from "./types.js";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const AUTHOR_TEXT_DAYS = 30; // run-2-decisions.md F3 #1: no text reuse to a person for 30 days

/**
 * Turns a triaged comment into planned actions. Pure apart from reading history.
 * Shadow and live both plan; the caller stores shadow rows with status 'shadow'.
 * The hourly/daily/global caps, the kill switch and dry-run are enforced at send time (send gate),
 * not here, so a planned action can still be held back when it comes due.
 */
export async function planActions(
  c: InboundComment,
  t: TriageResult,
  s: EngagementSettings,
  h: ActionHistory,
  now: Date,
): Promise<PlannedAction[]> {
  if (c.isOwn) return [{ kind: "none", reason: "own comment" }];
  const platform = c.platform;
  if (s.mode[platform] === "off") return [{ kind: "none", reason: "mode off" }];
  const notBefore = new Date(now.getTime() + s.minDelayMin * MIN).toISOString();
  const why = t.reasons.join("; ");

  if (t.bucket === "flag") return [{ kind: "flag", reason: why || "flagged" }];
  if (t.bucket === "hide_flag") {
    return s.hideEnabled[platform]
      ? [{ kind: "hide", notBefore }]
      : [{ kind: "flag", reason: `hide suggested: ${why || "abusive"}` }];
  }

  const authorId = c.authorId;
  if (authorId) {
    if (await h.isBlockedAuthor(platform, authorId)) return [{ kind: "flag", reason: "blocked author" }];
    const since = new Date(now.getTime() - s.limits.perPersonDays * DAY);
    if ((await h.repliesToAuthorSince(platform, authorId, since)).length > 0) return [{ kind: "none", reason: "per-person limit" }];
  }
  if (c.ownRepliesInThread.length > 0) return [{ kind: "none", reason: "human replied" }];

  const pool = t.bucket === "simple_positive" ? s.pools.positive : s.pools.negative;
  const candidates = [t.reply, ...pool].filter((x): x is string => typeof x === "string" && x.trim() !== "");
  const daySince = new Date(now.getTime() - DAY);
  const [recent, toAuthor, counts] = await Promise.all([
    h.lastRepliesOn(platform, 3),
    authorId ? h.repliesToAuthorSince(platform, authorId, new Date(now.getTime() - AUTHOR_TEXT_DAYS * DAY)) : Promise.resolve([]),
    Promise.all(candidates.map(async (text) => [text, await h.textUseCount(platform, text, daySince)] as const)),
  ]);
  const history: RotationHistory = {
    recent,
    toAuthor,
    overused: new Set(counts.filter(([, n]) => n > 2).map(([text]) => text)),
  };
  const text = pickReply(candidates, history, c.platformCommentId);
  if (text === null) return [{ kind: "flag", reason: "rotation exhausted" }];
  return [{ kind: "reply", text, notBefore }];
}
