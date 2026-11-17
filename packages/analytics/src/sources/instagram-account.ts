import type { FetchLike } from "../sources.js";
import { safeErrorMessage } from "../ingest.js";
import { EMPTY_ACCOUNT_METRICS, type AccountFetchResult, type AccountMetrics, type AccountTotals, type FetchedAccountPost } from "../account-types.js";
import { AccountApiError, BudgetedFetch, BudgetExhausted, RateLimitError, cleanText, isObj, isoOrNull, num, type Json } from "./common.js";

/**
 * Instagram account analytics (Graph API via Facebook Login, read-only GETs, Bearer header).
 * Shapes per docs/research.md: IG Media fields (`like_count` omitted when likes are hidden → null),
 * media insights envelope `data[].values[].value` (probe 2026-11-14), reel metrics accepted in v25.
 * Requested media fields are only id, caption, permalink, timestamp, media_type, media_product_type,
 * like_count, comments_count: never media_url/thumbnail_url (short-lived CDN links), never location.
 */

/** Per-run cap. 1 account call + ≤4 list pages (200 items / 50) + ≤1–2 insights calls per post stays under it
 *  for a 60-day window; a bigger backlog waits for the next 6-hourly run. Keeps one run far from Graph's
 *  hourly per-user call budget (the exact number is not recorded in research.md). */
export const IG_ACCOUNT_MAX_REQUESTS = 250;
export const IG_ACCOUNT_MAX_ITEMS = 200;
export const ACCOUNT_LOOKBACK_DAYS = 60;
const PAGE_SIZE = 50;

/** Combined insights request. Reels: the probe-accepted metrics we store. Other media: the subset that isn't reel-only. */
export const IG_ACCOUNT_REEL_METRICS = ["views", "reach", "saved", "shares", "ig_reels_avg_watch_time"] as const;
export const IG_ACCOUNT_OTHER_METRICS = ["views", "reach", "saved", "shares"] as const;

/** Graph throttling codes (4 app, 17 user, 32 page, 613 hourly cap, 80002 IG business-use-case). Not yet in research.md: needs a probe. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002]);

export interface InstagramAccountConfig {
  accessToken: string;
  igUserId: string;
  fetch: FetchLike;
  graphVersion?: string;
  baseUrl?: string;
  maxRequests?: number;
  maxItems?: number;
  lookbackDays?: number;
}

function errorOf(status: number, body: unknown): { code: number | null; message: string } {
  const e = isObj(body) && isObj(body.error) ? body.error : {};
  return { code: num(e.code), message: typeof e.message === "string" ? e.message.slice(0, 120) : "" };
}

function check(status: number, body: unknown): void {
  if (status === 200) return;
  const { code, message } = errorOf(status, body);
  if (status === 429 || (code !== null && RATE_LIMIT_CODES.has(code))) throw new RateLimitError("instagram", `HTTP ${status}${code !== null ? ` code ${code}` : ""}`);
  throw new AccountApiError("instagram", status, code, message);
}

/** `{ data: [{ name, values: [{ value }], total_value?: { value } }] }` → name → number. */
export function parseInsights(body: unknown): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const rows = isObj(body) && Array.isArray(body.data) ? body.data : [];
  for (const row of rows) {
    if (!isObj(row) || typeof row.name !== "string") continue;
    const first = Array.isArray(row.values) ? row.values[0] : undefined;
    const v = isObj(first) ? num(first.value) : null;
    out[row.name] = v ?? (isObj(row.total_value) ? num(row.total_value.value) : null);
  }
  return out;
}

/** One media list item → a post (metrics from insights are merged later). null = unusable (no id/permalink/timestamp). */
export function parseInstagramMedia(item: unknown): (FetchedAccountPost & { listMetrics: AccountMetrics; isReel: boolean }) | null {
  if (!isObj(item)) return null;
  const id = typeof item.id === "string" && /^\d+$/.test(item.id) ? item.id : null;
  const permalink = typeof item.permalink === "string" && /^https:\/\/(www\.)?instagram\.com\//.test(item.permalink) ? item.permalink : null;
  const publishedAt = isoOrNull(item.timestamp);
  if (!id || !permalink || !publishedAt) return null;
  const product = typeof item.media_product_type === "string" ? item.media_product_type.toLowerCase() : null;
  return {
    platformPostId: id,
    permalink,
    kind: product,
    caption: cleanText(item.caption),
    title: null,
    publishedAt,
    durationS: null, // no documented duration field on IG Media (needs a probe)
    metrics: null,
    isReel: product === "reels",
    listMetrics: { ...EMPTY_ACCOUNT_METRICS, likes: num(item.like_count), comments: num(item.comments_count) },
  };
}

export function parseInstagramAccount(body: unknown): AccountTotals {
  const b: Json = isObj(body) ? body : {};
  return { followers: num(b.followers_count), totalViews: null, postsCount: num(b.media_count) };
}

/**
 * Reads the account: totals (when `includeAccount`), the media list newest first (paged by the `after`
 * cursor; stops at `lookbackDays`, `maxItems`, or the last page), then insights per item. A metric the
 * media type doesn't support fails that item's combined request: it retries with `views` alone, and
 * failing that keeps the list counts (likes/comments). A rate limit or the request cap ends the run with
 * what was read; posts whose insights weren't reached come back with `metrics: null` (no snapshot).
 */
export async function fetchInstagramAccount(cfg: InstagramAccountConfig, opts: { now: Date; includeAccount: boolean }): Promise<AccountFetchResult> {
  const base = `${cfg.baseUrl ?? "https://graph.facebook.com"}/${cfg.graphVersion ?? "v25.0"}`;
  if (!/^\d+$/.test(cfg.igUserId)) throw new Error("instagram user id must be numeric");
  const http = new BudgetedFetch("instagram", cfg.fetch, { Authorization: `Bearer ${cfg.accessToken}` }, cfg.maxRequests ?? IG_ACCOUNT_MAX_REQUESTS);
  const cutoff = opts.now.getTime() - (cfg.lookbackDays ?? ACCOUNT_LOOKBACK_DAYS) * 86_400_000;
  const maxItems = cfg.maxItems ?? IG_ACCOUNT_MAX_ITEMS;
  const res: AccountFetchResult = { platform: "instagram", posts: [], account: null, requests: 0, stoppedBy: null, error: null };
  const listed: Array<NonNullable<ReturnType<typeof parseInstagramMedia>>> = [];

  try {
    if (opts.includeAccount) {
      const r = await http.get(`${base}/${cfg.igUserId}?fields=followers_count,media_count`);
      check(r.status, r.body);
      res.account = parseInstagramAccount(r.body);
    }

    let after: string | null = null;
    pages: for (;;) {
      const url: string = `${base}/${cfg.igUserId}/media?fields=id,caption,permalink,timestamp,media_type,media_product_type,like_count,comments_count&limit=${PAGE_SIZE}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const r = await http.get(url);
      check(r.status, r.body);
      const data = isObj(r.body) && Array.isArray(r.body.data) ? r.body.data : [];
      for (const raw of data) {
        const p = parseInstagramMedia(raw);
        if (!p) continue;
        if (Date.parse(p.publishedAt) < cutoff) break pages; // newest first: the rest is older
        listed.push(p);
        if (listed.length >= maxItems) break pages;
      }
      const paging = isObj(r.body) && isObj(r.body.paging) ? r.body.paging : {};
      const cursors = isObj(paging.cursors) ? paging.cursors : {};
      const next = typeof cursors.after === "string" && cursors.after && typeof paging.next === "string" ? cursors.after : null;
      if (!next || !data.length) break;
      after = next;
    }

    for (const p of listed) {
      const metrics = await insightsFor(http, base, p);
      res.posts.push(strip(p, metrics));
    }
  } catch (err) {
    res.stoppedBy = err instanceof RateLimitError ? "rate-limit" : err instanceof BudgetExhausted ? "budget" : "error";
    res.error = safeErrorMessage(err);
    // Keep what was listed: posts not reached yet carry no metrics (upserted, no snapshot).
    for (const p of listed.slice(res.posts.length)) res.posts.push(strip(p, null));
  }
  res.requests = http.requests;
  return res;
}

function strip(p: NonNullable<ReturnType<typeof parseInstagramMedia>>, metrics: AccountMetrics | null): FetchedAccountPost {
  const { listMetrics: _l, isReel: _r, ...post } = p;
  return { ...post, metrics };
}

async function insightsFor(http: BudgetedFetch, base: string, p: NonNullable<ReturnType<typeof parseInstagramMedia>>): Promise<AccountMetrics> {
  const metrics = p.isReel ? IG_ACCOUNT_REEL_METRICS : IG_ACCOUNT_OTHER_METRICS;
  let v: Record<string, number | null> | null = null;
  const r = await http.get(`${base}/${p.platformPostId}/insights?metric=${metrics.join(",")}`);
  if (r.status === 200) v = parseInsights(r.body);
  else {
    check429(r.status, r.body);
    // "metric not supported for this media type" (or any per-item refusal): one retry with views alone.
    const r2 = await http.get(`${base}/${p.platformPostId}/insights?metric=views`);
    if (r2.status === 200) v = parseInsights(r2.body);
    else check429(r2.status, r2.body);
  }
  const watchMs = v?.ig_reels_avg_watch_time ?? null;
  return {
    ...p.listMetrics,
    views: v?.views ?? null,
    reach: v?.reach ?? null,
    saves: v?.saved ?? null,
    shares: v?.shares ?? null,
    // ms per Zernio's schema; Meta's page gives no unit (research.md 2026-11-11).
    avgWatchS: watchMs !== null ? watchMs / 1000 : null,
  };
}

/** A per-item failure is tolerated, but a rate limit still ends the run. */
function check429(status: number, body: unknown): void {
  const { code } = errorOf(status, body);
  if (status === 429 || (code !== null && RATE_LIMIT_CODES.has(code))) throw new RateLimitError("instagram", `HTTP ${status}${code !== null ? ` code ${code}` : ""}`);
}
