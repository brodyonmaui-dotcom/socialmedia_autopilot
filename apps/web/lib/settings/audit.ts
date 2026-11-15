import type { AlertSource } from "@autopilot/core";

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * F15 audit row for a Settings edit: alerts kind 'settings-change', inserted already acknowledged so it
 * never shows as open and never pushes (not in PUSH_KINDS_DEFAULT, and pushed only while unacknowledged).
 * batch_item_id is null: unique (kind, batch_item_id) treats NULLs as distinct, so every edit gets a row.
 */
export async function writeSettingsAudit(q: Queryable, message: string, platform: AlertSource = "all"): Promise<void> {
  await q.query(
    `insert into alerts (kind, platform, message, acknowledged_at, pushed_at) values ('settings-change', $1, $2, now(), now())`,
    [platform, message.slice(0, 300)],
  );
}
