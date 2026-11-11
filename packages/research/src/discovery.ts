import type { CreatorSnapshot, SnapshotPost } from "./brief.js";
import type { Creator } from "./types.js";

/**
 * Instagram Business Discovery → CreatorSnapshot. Shape from Meta's docs (logged in
 * docs/research.md, 2026-11-11):
 *   GET /{our-ig-user-id}?fields=business_discovery.username(<handle>){followers_count,media_count,media.limit(N){…}}
 *   → { business_discovery: { followers_count, media_count, media: { data: [ { id, caption, like_count,
 *       comments_count, view_count, media_type, media_product_type, timestamp } ], paging? }, id }, id }
 * Works only for other Business/Creator accounts (age-gated ones return nothing). `like_count` is
 * omitted when the owner hides likes → null. `view_count` (Reels) includes paid views.
 * Read-only GET, token in a header. Never stores captions' places: brief.ts lints what it shows.
 */

export interface HttpResponse {
  status: number;
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<HttpResponse>;

export interface DiscoveryConfig {
  /** OUR Instagram professional account id (IG_USER_ID). */
  igUserId: string;
  accessToken: string;
  fetch: FetchLike;
  graphVersion?: string;
  baseUrl?: string;
  /** Recent posts to read per creator (default 25). */
  limit?: number;
}

const FIELDS = "id,caption,like_count,comments_count,view_count,media_type,media_product_type,timestamp";
const HANDLE = /^[a-z0-9._]{1,30}$/;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function discoveryUrl(handle: string, cfg: Pick<DiscoveryConfig, "igUserId" | "graphVersion" | "baseUrl" | "limit">): string {
  if (!/^\d+$/.test(cfg.igUserId)) throw new Error("business discovery: igUserId must be numeric");
  if (!HANDLE.test(handle)) throw new Error("business discovery: handle must be a lowercase Instagram username");
  const limit = Math.max(1, Math.min(cfg.limit ?? 25, 50));
  const fields = `business_discovery.username(${handle}){followers_count,media_count,media.limit(${limit}){${FIELDS}}}`;
  return `${cfg.baseUrl ?? "https://graph.facebook.com"}/${cfg.graphVersion ?? "v25.0"}/${cfg.igUserId}?fields=${encodeURIComponent(fields)}`;
}

function mediaType(m: Json): SnapshotPost["mediaType"] {
  if (m.media_product_type === "REELS") return "reel";
  if (m.media_type === "CAROUSEL_ALBUM") return "carousel";
  if (m.media_type === "VIDEO") return "video";
  return "image";
}

/** Pure mapping from the documented response body. Exported for tests. */
export function toSnapshot(creatorId: string, body: unknown): CreatorSnapshot {
  const bd = isObj(body) && isObj(body.business_discovery) ? body.business_discovery : null;
  if (!bd) throw new Error("business discovery: no business_discovery in response (personal or age-gated account?)");
  const data = isObj(bd.media) && Array.isArray(bd.media.data) ? bd.media.data : [];
  const posts: SnapshotPost[] = data.filter(isObj).flatMap((m) => {
    if (typeof m.id !== "string" || typeof m.timestamp !== "string") return [];
    return [
      {
        id: m.id,
        caption: typeof m.caption === "string" ? m.caption : "",
        likes: num(m.like_count),
        comments: num(m.comments_count) ?? 0,
        views: num(m.view_count),
        mediaType: mediaType(m),
        postedAt: new Date(m.timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).toISOString(),
      },
    ];
  });
  return { creatorId, followers: num(bd.followers_count), posts };
}

export async function fetchCreatorSnapshot(creator: Creator, cfg: DiscoveryConfig): Promise<CreatorSnapshot> {
  if (creator.platform !== "instagram") throw new Error(`business discovery: ${creator.platform} creators aren't supported (Instagram only)`);
  const res = await cfg.fetch(discoveryUrl(creator.handle, cfg), { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
  const body = await res.json();
  if (res.status !== 200) {
    const e = isObj(body) && isObj(body.error) ? body.error : {};
    throw new Error(`business discovery: HTTP ${res.status}${e.code !== undefined ? ` code ${String(e.code)}` : ""}${typeof e.message === "string" ? ` ${e.message}` : ""}`);
  }
  return toSnapshot(creator.id, body);
}
