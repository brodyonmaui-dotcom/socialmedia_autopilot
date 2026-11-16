import { localDate, type Platform } from "@autopilot/core";
import { matchAccountPosts } from "./account-match.js";
import { hasAccountSnapshot, insertAccountSnapshot, loadExistingMatches, loadMatchCandidates, upsertAccountPost, upsertAccountSnapshot } from "./account-store.js";
import type { AccountFetchResult, AccountStop } from "./account-types.js";
import type { QueryPool } from "./store.js";

/**
 * One account-ingest pass for one platform: (1) ask the fetcher (which knows whether today's account row
 * is still missing), (2) match each post to an app item, (3) upsert posts, insert one snapshot per post
 * that came back with numbers, (4) upsert today's account row. Idempotent: the same `now` twice writes
 * nothing new. Read-only on the platform.
 */
export type AccountFetcher = (opts: { now: Date; includeAccount: boolean }) => Promise<AccountFetchResult>;

export interface AccountIngestSummary {
  platform: Platform;
  posts: number;
  snapshots: number;
  matchedById: number;
  matchedByCaption: number;
  byHand: number;
  account: boolean;
  requests: number;
  stoppedBy: AccountStop | null;
  error: string | null;
}

/** Window for app items that a caption match may land on (lookback + the ±36 h slack). */
const CANDIDATE_DAYS = 62;

export async function ingestAccountOnce(
  pool: QueryPool,
  platform: Platform,
  fetcher: AccountFetcher,
  opts: { now: Date; timeZone: string },
): Promise<AccountIngestSummary> {
  const today = localDate(opts.now, opts.timeZone);
  const includeAccount = !(await hasAccountSnapshot(pool, platform, today));
  const res = await fetcher({ now: opts.now, includeAccount });

  const candidates = await loadMatchCandidates(pool, platform, new Date(opts.now.getTime() - CANDIDATE_DAYS * 86_400_000));
  const existing = await loadExistingMatches(pool, platform, res.posts.map((p) => p.platformPostId));
  const matches = matchAccountPosts(res.posts.map((p) => ({ ...p, platform })), candidates, existing);

  const sum: AccountIngestSummary = {
    platform,
    posts: 0,
    snapshots: 0,
    matchedById: 0,
    matchedByCaption: 0,
    byHand: 0,
    account: false,
    requests: res.requests,
    stoppedBy: res.stoppedBy,
    error: res.error,
  };
  for (const [i, p] of res.posts.entries()) {
    const m = matches[i]!;
    const id = await upsertAccountPost(pool, platform, p, m, opts.now);
    sum.posts++;
    if (m.matchedBy === "id") sum.matchedById++;
    else if (m.matchedBy === "caption") sum.matchedByCaption++;
    else sum.byHand++;
    const metrics = p.metrics;
    if (metrics && Object.values(metrics).some((v) => v !== null)) {
      if (await insertAccountSnapshot(pool, id, opts.now, metrics)) sum.snapshots++;
    }
  }
  if (res.account) {
    await upsertAccountSnapshot(pool, platform, today, res.account);
    sum.account = true;
  }
  return sum;
}

const SHORT: Partial<Record<Platform, string>> = { instagram: "ig", youtube: "yt" };

export function formatAccountIngestLine(s: AccountIngestSummary): string {
  return (
    `[account] ${SHORT[s.platform] ?? s.platform} posts ${s.posts} (id ${s.matchedById}, caption ${s.matchedByCaption}, by hand ${s.byHand})` +
    ` · snapshots ${s.snapshots} · account ${s.account ? "yes" : "no"} · requests ${s.requests}${s.stoppedBy ? ` · stopped: ${s.stoppedBy}` : ""}`
  );
}
