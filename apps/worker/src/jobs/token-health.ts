import { checkTokenHealth, formatTokenHealth, type TokenHealthConfig } from "@autopilot/adapters";
import type PgBoss from "pg-boss";
import { QUEUES } from "../queue.js";
import type { OutboxPool } from "./outbox.js";

/** Env → token-health config. Values are never logged; cloud/dry-run sessions simply have none. */
export function tokenHealthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TokenHealthConfig {
  return {
    meta: env.META_APP_ID && env.META_APP_SECRET && env.META_ACCESS_TOKEN ? { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, accessToken: env.META_ACCESS_TOKEN, graphVersion: env.META_GRAPH_VERSION } : undefined,
    youtube: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.YT_REFRESH_TOKEN ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken: env.YT_REFRESH_TOKEN } : undefined,
    zernio: env.ZERNIO_API_KEY ? { apiKey: env.ZERNIO_API_KEY, tiktokAccountId: env.ZERNIO_TIKTOK_ACCOUNT_ID } : undefined,
  };
}

/**
 * Daily read-only check. A warn/fail writes one alert row per service (kind 'token-health', no item),
 * deduped by replacing the previous row for that service so the dashboard shows the latest state.
 */
export async function runTokenHealthOnce(pool: OutboxPool, cfg: TokenHealthConfig, log: (line: string) => void = console.log): Promise<string> {
  const report = await checkTokenHealth(cfg);
  for (const r of report) {
    if (r.level !== "warn" && r.level !== "fail") continue;
    await pool.query("delete from alerts where kind = 'token-health' and platform = $1 and acknowledged_at is null", [r.service]);
    await pool.query("insert into alerts (kind, batch_item_id, platform, message, created_at) values ('token-health', null, $1, $2, $3)", [r.service, `${r.level}: ${r.summary}`, r.checkedAt]);
  }
  const line = `[token-health] ${formatTokenHealth(report)}`;
  log(line);
  return line;
}

export async function registerTokenHealthJob(boss: PgBoss, pool: OutboxPool, cfg: TokenHealthConfig): Promise<void> {
  await boss.createQueue(QUEUES.tokenHealth);
  await boss.work(QUEUES.tokenHealth, async () => {
    await runTokenHealthOnce(pool, cfg);
  });
  await boss.schedule(QUEUES.tokenHealth, "17 6 * * *"); // once a day, off the hour
}
