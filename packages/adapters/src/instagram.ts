import { NonRetryableError, type OutboxPost, type PlatformAdapter, type PublishOptions, type PublishResult } from "@autopilot/core";
import { assertNoLocationFields, countHashtags, getJson, PlatformRequestError, type FetchLike } from "./http.js";

export interface InstagramAdapterConfig {
  /** Page access token (Facebook Login, never expires; data access re-authorized every 90 days). */
  accessToken: string;
  /** The IG professional account id (IG_USER_ID from probe:connect-meta). */
  igUserId: string;
  /** Graph API version path, e.g. "v25.0" (research.md: the app runs v25.0). */
  graphVersion?: string;
  fetch?: FetchLike;
  /** Container polling (Meta: about once a minute, up to five minutes). */
  pollIntervalMs?: number;
  maxPolls?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** CLAUDE.md: ≤5 hashtags on Instagram. */
  maxHashtags?: number;
}

interface GraphError {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}
interface ContainerStatus extends GraphError {
  id?: string;
  status_code?: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";
  status?: string;
}
interface MediaList extends GraphError {
  data?: Array<{ id: string; caption?: string; permalink?: string; timestamp?: string; media_product_type?: string }>;
}

/** The M1 day-1 refusal (research.md): "Application does not have permission for this action" when a trial isn't allowed. */
export const IG_TRIAL_REFUSED = { code: 10, error_subcode: 2207081 } as const;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
  });
}

/**
 * Instagram Reels via the Graph API (Facebook Login), the "direct, server-fires" route:
 *   1. POST /{ig-user-id}/media  (media_type=REELS, video_url, caption, share_to_feed, trial_params?)
 *   2. GET  /{container-id}?fields=status_code  until FINISHED (poll ~1/min, ≤5 min)
 *   3. POST /{ig-user-id}/media_publish (creation_id)
 * Containers expire in 24 h, so they're only ever created at fire time (never pre-created).
 * Trial refused (code 10 / subcode 2207081) → plain reel + trialFellBack (decisions.md §5).
 * Never sets location_id; refuses captions with more than 5 hashtags (NonRetryable).
 */
export function createInstagramAdapter(cfg: InstagramAdapterConfig): PlatformAdapter {
  const fetchImpl = cfg.fetch ?? ((url, init) => fetch(url, init));
  const version = cfg.graphVersion ?? "v25.0";
  const base = `https://graph.facebook.com/${version}`;
  const sleep = cfg.sleep ?? defaultSleep;
  const pollIntervalMs = cfg.pollIntervalMs ?? 60_000;
  const maxPolls = cfg.maxPolls ?? 5;
  const maxHashtags = cfg.maxHashtags ?? 5;
  const auth = { Authorization: `Bearer ${cfg.accessToken}` };

  async function createContainer(fields: Record<string, string>, signal?: AbortSignal) {
    assertNoLocationFields("instagram", fields);
    return getJson<ContainerStatus>(fetchImpl, `${base}/${cfg.igUserId}/media`, { method: "POST", headers: auth, body: new URLSearchParams(fields) }, signal);
  }

  return {
    platform: "instagram",

    async publish(post: OutboxPost, opts: PublishOptions = {}): Promise<PublishResult> {
      const signal = opts.signal;
      if (countHashtags(post.caption) > maxHashtags) throw new NonRetryableError(`instagram: caption has more than ${maxHashtags} hashtags`);

      const baseFields: Record<string, string> = { media_type: "REELS", video_url: post.mediaUrl, caption: post.caption, share_to_feed: "true" };
      let trialFellBack = false;
      let container: string | undefined;

      if (post.trial) {
        const trial = await createContainer({ ...baseFields, trial_params: JSON.stringify({ graduation_strategy: post.trial.graduationStrategy }) }, signal);
        if (trial.body.id) container = trial.body.id;
        else {
          const e = trial.body.error;
          const refused = e?.code === IG_TRIAL_REFUSED.code || e?.error_subcode === IG_TRIAL_REFUSED.error_subcode;
          if (!refused) throw new PlatformRequestError("instagram", trial.status, trial.body, `instagram container rejected: ${e?.message ?? JSON.stringify(trial.body)} (code ${e?.code}/${e?.error_subcode})`);
          trialFellBack = true; // decided fallback: plain reel + flag; the daily re-probe handles eligibility
        }
      }
      if (!container) {
        const plain = await createContainer(baseFields, signal);
        if (!plain.body.id) {
          const e = plain.body.error;
          throw new PlatformRequestError("instagram", plain.status, plain.body, `instagram container rejected: ${e?.message ?? JSON.stringify(plain.body)} (code ${e?.code}/${e?.error_subcode})`);
        }
        container = plain.body.id;
      }

      // Poll until FINISHED. ERROR/EXPIRED = this container is dead; a retry creates a fresh one (nothing was published).
      let status: ContainerStatus["status_code"] = "IN_PROGRESS";
      for (let i = 0; i <= maxPolls && status === "IN_PROGRESS"; i++) {
        if (i > 0) await sleep(pollIntervalMs, signal);
        const s = await getJson<ContainerStatus>(fetchImpl, `${base}/${container}?fields=status_code,status`, { headers: auth }, signal);
        status = s.body.status_code ?? (s.body.error ? "ERROR" : "IN_PROGRESS");
        if (status === "ERROR" || status === "EXPIRED") throw new Error(`instagram container ${container} ${status}: ${s.body.status ?? s.body.error?.message ?? ""}`);
      }
      if (status !== "FINISHED" && status !== "PUBLISHED") throw new Error(`instagram container ${container} still ${status} after ${maxPolls} polls; will retry with a new container`);

      const pub = await getJson<ContainerStatus>(fetchImpl, `${base}/${cfg.igUserId}/media_publish`, { method: "POST", headers: auth, body: new URLSearchParams({ creation_id: container }) }, signal);
      if (!pub.body.id) throw new PlatformRequestError("instagram", pub.status, pub.body, `instagram media_publish rejected: ${pub.body.error?.message ?? JSON.stringify(pub.body)}`);

      let permalink: string | undefined;
      try {
        const m = await getJson<{ permalink?: string }>(fetchImpl, `${base}/${pub.body.id}?fields=permalink`, { headers: auth }, signal);
        permalink = m.body.permalink;
      } catch {
        permalink = undefined; // best effort only
      }
      const flags = trialFellBack ? ["trial refused: posted as a regular reel"] : [];
      return { platformPostId: pub.body.id, platformPostUrl: permalink, trialFellBack, flags };
    },

    /**
     * Instagram has no idempotency key, so "does it exist?" is a caption match on the account's recent
     * media within a day of scheduled_for. Only ever used to AVOID a resend; a miss means "not found".
     */
    async findExisting(post: OutboxPost, opts: PublishOptions = {}): Promise<PublishResult | null> {
      const r = await getJson<MediaList>(fetchImpl, `${base}/${cfg.igUserId}/media?fields=id,caption,permalink,timestamp,media_product_type&limit=25`, { headers: auth }, opts.signal);
      if (!r.body.data) return null;
      const target = post.caption.trim();
      const at = Date.parse(post.scheduledFor);
      const hit = r.body.data.find((m) => (m.caption ?? "").trim() === target && target.length > 0 && (!m.timestamp || Math.abs(Date.parse(m.timestamp) - at) <= 36 * 3_600_000));
      return hit ? { platformPostId: hit.id, platformPostUrl: hit.permalink } : null;
    },
  };
}
