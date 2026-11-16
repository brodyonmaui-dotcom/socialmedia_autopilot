import type { FetchLike } from "../sources.js";
import { safeErrorMessage } from "../ingest.js";
import { EMPTY_ACCOUNT_METRICS, type AccountFetchResult, type AccountTotals, type FetchedAccountPost } from "../account-types.js";
import { AccountApiError, BudgetedFetch, BudgetExhausted, RateLimitError, cleanText, isObj, isoOrNull, num, type Json } from "./common.js";
import { ACCOUNT_LOOKBACK_DAYS } from "./instagram-account.js";

/**
 * YouTube account analytics (Data API v3, read-only GETs, OAuth Bearer from the worker's token refresh).
 * Path per docs/research.md (2026-11-14): channels?mine=true → contentDetails.relatedPlaylists.uploads →
 * playlistItems (contentDetails.videoId / videoPublishedAt) → videos?part=snippet,statistics,contentDetails.
 * statistics counts are strings (probe 2026-11-14). Never requests thumbnails or recordingDetails (location).
 *
 * Quota (list = 1 unit, research.md): 1 (channels) + 1 per playlist page of 50 + 1 per videos page of 50.
 * A 60-day window of ~50 Shorts ≈ 1 + 2 + 1 = 4 units per run, ×4 runs/day ≈ 16 of the 10,000 daily units.
 */
export const YT_ACCOUNT_MAX_REQUESTS = 20; // = 20 quota units at most per run
const PAGE_SIZE = 50;
const RATE_LIMIT_REASONS = new Set(["quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"]);

export interface YouTubeAccountConfig {
  accessToken: string;
  fetch: FetchLike;
  baseUrl?: string;
  maxRequests?: number;
  lookbackDays?: number;
}

function check(status: number, body: unknown): void {
  if (status === 200) return;
  const e = isObj(body) && isObj(body.error) ? body.error : {};
  const reasons = Array.isArray(e.errors) ? e.errors.map((x) => (isObj(x) && typeof x.reason === "string" ? x.reason : "")) : [];
  if (status === 429 || (status === 403 && reasons.some((r) => RATE_LIMIT_REASONS.has(r)))) {
    throw new RateLimitError("youtube", `HTTP ${status}${reasons[0] ? ` ${reasons[0]}` : ""}`);
  }
  throw new AccountApiError("youtube", status, num(e.code), typeof e.message === "string" ? e.message.slice(0, 120) : "");
}

/** ISO 8601 duration ("PT1M5S", "P0D") → seconds; null when it doesn't parse. */
export function parseIsoDuration(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(v);
  if (!m || v === "P" || v.endsWith("T")) return null;
  const [, d, h, mi, s] = m;
  return Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0);
}

export function parseYouTubeChannel(body: unknown): { uploads: string | null; account: AccountTotals } {
  const item = isObj(body) && Array.isArray(body.items) ? body.items.find(isObj) : undefined;
  const s: Json = isObj(item) && isObj(item.statistics) ? item.statistics : {};
  const cd = isObj(item) && isObj(item.contentDetails) && isObj(item.contentDetails.relatedPlaylists) ? item.contentDetails.relatedPlaylists : {};
  return {
    uploads: typeof cd.uploads === "string" && cd.uploads ? cd.uploads : null,
    account: {
      followers: s.hiddenSubscriberCount === true ? null : num(s.subscriberCount),
      totalViews: num(s.viewCount),
      postsCount: num(s.videoCount),
    },
  };
}

/** A videos.list item → post. `publishedAt` override = the playlist item's videoPublishedAt (go-public time). */
export function parseYouTubeVideo(item: unknown, publishedAtOverride?: string | null): FetchedAccountPost | null {
  if (!isObj(item) || typeof item.id !== "string" || !/^[\w-]{6,20}$/.test(item.id)) return null;
  const sn: Json = isObj(item.snippet) ? item.snippet : {};
  const st: Json = isObj(item.statistics) ? item.statistics : {};
  const cd: Json = isObj(item.contentDetails) ? item.contentDetails : {};
  const publishedAt = publishedAtOverride ?? isoOrNull(sn.publishedAt);
  if (!publishedAt) return null;
  return {
    platformPostId: item.id,
    permalink: `https://www.youtube.com/watch?v=${item.id}`,
    kind: null,
    title: cleanText(sn.title, 200),
    caption: cleanText(sn.description, 2200),
    publishedAt,
    durationS: parseIsoDuration(cd.duration),
    metrics: { ...EMPTY_ACCOUNT_METRICS, views: num(st.viewCount), likes: num(st.likeCount), comments: num(st.commentCount) },
  };
}

/**
 * Reads channel totals + uploads within `lookbackDays`. Playlist items without `videoPublishedAt` (not
 * public yet: private/scheduled) are skipped. Paging stops when a page is entirely older than the cutoff
 * (newest-first ordering is assumed, not verified), on the last page, or at the request cap.
 */
export async function fetchYouTubeAccount(cfg: YouTubeAccountConfig, opts: { now: Date; includeAccount: boolean }): Promise<AccountFetchResult> {
  const base = cfg.baseUrl ?? "https://www.googleapis.com/youtube/v3";
  const http = new BudgetedFetch("youtube", cfg.fetch, { Authorization: `Bearer ${cfg.accessToken}` }, cfg.maxRequests ?? YT_ACCOUNT_MAX_REQUESTS);
  const cutoff = opts.now.getTime() - (cfg.lookbackDays ?? ACCOUNT_LOOKBACK_DAYS) * 86_400_000;
  const res: AccountFetchResult = { platform: "youtube", posts: [], account: null, requests: 0, stoppedBy: null, error: null };
  try {
    const ch = await http.get(`${base}/channels?part=statistics,contentDetails&mine=true`);
    check(ch.status, ch.body);
    const { uploads, account } = parseYouTubeChannel(ch.body);
    if (opts.includeAccount) res.account = account;
    if (!uploads) throw new Error("youtube account analytics: channel has no uploads playlist");

    const ids: Array<{ id: string; publishedAt: string }> = [];
    let pageToken: string | null = null;
    for (;;) {
      const r = await http.get(`${base}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploads)}&maxResults=${PAGE_SIZE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
      check(r.status, r.body);
      const items = isObj(r.body) && Array.isArray(r.body.items) ? r.body.items : [];
      let anyRecent = false;
      for (const it of items) {
        const c = isObj(it) && isObj(it.contentDetails) ? it.contentDetails : null;
        const id = c && typeof c.videoId === "string" ? c.videoId : null;
        const at = c ? isoOrNull(c.videoPublishedAt) : null;
        if (!id || !at) continue; // not public yet
        if (Date.parse(at) < cutoff) continue;
        anyRecent = true;
        ids.push({ id, publishedAt: at });
      }
      const next = isObj(r.body) && typeof r.body.nextPageToken === "string" ? r.body.nextPageToken : null;
      if (!next || !anyRecent) break;
      pageToken = next;
    }

    for (let i = 0; i < ids.length; i += PAGE_SIZE) {
      const chunk = ids.slice(i, i + PAGE_SIZE);
      const r = await http.get(`${base}/videos?part=snippet,statistics,contentDetails&id=${chunk.map((c) => c.id).join(",")}&maxResults=${PAGE_SIZE}`);
      check(r.status, r.body);
      const items = isObj(r.body) && Array.isArray(r.body.items) ? r.body.items : [];
      for (const c of chunk) {
        const item = items.find((x) => isObj(x) && x.id === c.id);
        const p = parseYouTubeVideo(item, c.publishedAt);
        if (p) res.posts.push(p);
      }
    }
  } catch (err) {
    res.stoppedBy = err instanceof RateLimitError ? "rate-limit" : err instanceof BudgetExhausted ? "budget" : "error";
    res.error = safeErrorMessage(err);
  }
  res.requests = http.requests;
  return res;
}
