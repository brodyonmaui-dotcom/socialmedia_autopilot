import { createTikTokAdapter, createYouTubeAdapter, type OutboxPost, type PlatformAdapter } from "@autopilot/core";
import type { Pool } from "pg";

export interface OutboxConfig {
  youtube?: { clientId: string; clientSecret: string; refreshToken: string };
  tiktok?: { apiKey: string; accountId: string };
  publicMediaBase: string;
  dryRun: boolean;
  maxAttempts?: number;
}

/** Network/timeout failures mean we don't know if the platform-side action happened — never auto-retry these (non-negotiable #3). */
function isTransient(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch network failure
  const name = (err as { name?: string } | undefined)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Fires approved batch_items for the native-scheduling platforms (YouTube, TikTok): both hold
 * their own publish clock once we hand a post off, so we submit as soon as it's approved rather
 * than waiting for scheduled_for (unlike Instagram's server-fires route).
 *
 * Known gap: YouTube's API has no idempotency key. A crash between a successful upload and our
 * status update could re-upload on retry. Narrow window, not fully closed — flagged for M6
 * hardening rather than solved here.
 */
export async function runOutboxOnce(pool: Pool, cfg: OutboxConfig): Promise<{ processed: number; dryRun: boolean }> {
  const adapters: Partial<Record<string, PlatformAdapter>> = {};
  if (cfg.youtube) adapters.youtube = createYouTubeAdapter(cfg.youtube);
  if (cfg.tiktok) adapters.tiktok = createTikTokAdapter(cfg.tiktok);
  return processApprovedItems(pool, adapters, cfg);
}

/** Separated from runOutboxOnce so tests can inject fake adapters instead of hitting real APIs. */
export async function processApprovedItems(
  pool: Pool,
  adapters: Partial<Record<string, PlatformAdapter>>,
  cfg: Pick<OutboxConfig, "publicMediaBase" | "dryRun" | "maxAttempts">,
): Promise<{ processed: number; dryRun: boolean }> {
  const platforms = Object.keys(adapters);
  if (platforms.length === 0) return { processed: 0, dryRun: cfg.dryRun };

  const maxAttempts = cfg.maxAttempts ?? 3;
  const { rows } = await pool.query(
    `select bi.id, bi.idempotency_key, bi.platform, bi.caption, bi.title, bi.scheduled_for, bi.attempts, m.r2_key
     from batch_items bi join media m on m.id = bi.media_id
     where bi.status = 'approved' and bi.platform = any($1)
     order by bi.scheduled_for asc`,
    [platforms],
  );

  let processed = 0;
  for (const row of rows) {
    const adapter = adapters[row.platform as string];
    if (!adapter) continue;

    if (cfg.dryRun) {
      console.log(`[outbox] dry-run: would publish ${row.platform} item ${row.id} (scheduled_for ${row.scheduled_for})`);
      processed++;
      continue;
    }

    await pool.query("update batch_items set status = 'publishing', updated_at = now() where id = $1", [row.id]);
    const post: OutboxPost = {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      platform: row.platform,
      mediaUrl: `${cfg.publicMediaBase}/${row.r2_key}`,
      caption: row.caption,
      title: row.title ?? undefined,
      scheduledFor: new Date(row.scheduled_for).toISOString(),
      status: "publishing",
      attempts: row.attempts,
    };

    try {
      const result = await adapter.publish(post);
      await pool.query(
        "update batch_items set status = 'published', platform_post_id = $2, platform_post_url = $3, attempts = attempts + 1, updated_at = now() where id = $1",
        [row.id, result.platformPostId, result.platformPostUrl ?? null],
      );
      console.log(`[outbox] published ${row.platform} item ${row.id} -> ${result.platformPostUrl ?? result.platformPostId}`);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      if (isTransient(err)) {
        await pool.query("update batch_items set status = 'unknown', last_error = $2, attempts = attempts + 1, updated_at = now() where id = $1", [row.id, message]);
        console.log(`[outbox] unknown (timeout/network) for ${row.platform} item ${row.id}: ${message} — needs a manual check, won't auto-retry`);
      } else {
        const nextAttempts = row.attempts + 1;
        const nextStatus = nextAttempts >= maxAttempts ? "failed" : "approved";
        await pool.query("update batch_items set status = $2, last_error = $3, attempts = $4, updated_at = now() where id = $1", [row.id, nextStatus, message, nextAttempts]);
        console.log(`[outbox] ${nextStatus} ${row.platform} item ${row.id} (attempt ${nextAttempts}/${maxAttempts}): ${message}`);
      }
    }
    processed++;
  }
  return { processed, dryRun: cfg.dryRun };
}
