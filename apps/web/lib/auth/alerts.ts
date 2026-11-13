import type { Queryable } from "@autopilot/db";

/**
 * Auth alerts (rate limit tripped). alerts.platform is `text not null` with no CHECK (0005), and an
 * auth alert belongs to no platform, so it is stored as 'web'.
 */
export async function writeAuthAlert(db: Queryable, message: string): Promise<void> {
  await db.query("insert into alerts (kind, platform, message) values ('auth', 'web', $1)", [message]);
}
