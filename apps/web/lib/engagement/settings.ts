import type { Pool } from "pg";
import { getSetting } from "@autopilot/db";
import { normalizeEngagement } from "@autopilot/engagement/src/settings.js";
import type { EngagementPlatform, EngagementSettings, Mode } from "@autopilot/engagement";

const KEY = "engagement";
type Overlay = Record<string, unknown>;
const isObj = (v: unknown): v is Overlay => typeof v === "object" && v !== null && !Array.isArray(v);

/** The 'engagement' settings row merged over DEFAULT_ENGAGEMENT. */
export async function loadEngagement(pool: Pool): Promise<EngagementSettings> {
  return normalizeEngagement(await getSetting<unknown>(pool, KEY));
}

/**
 * Read-modify-write of the stored overlay under a row lock, so a kill from the worker and a mode
 * change from the inbox can't overwrite each other. Only the overlay is stored (never the merged
 * defaults), so later default changes in code still apply. Returns the merged settings before/after.
 */
export async function updateEngagement(pool: Pool, mutate: (overlay: Overlay) => Overlay): Promise<{ before: EngagementSettings; after: EngagementSettings }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`insert into settings (key, value, updated_at) values ($1, '{}'::jsonb, now()) on conflict (key) do nothing`, [KEY]);
    const { rows } = await client.query("select value from settings where key = $1 for update", [KEY]);
    const raw: unknown = rows[0]?.value;
    const overlay: Overlay = isObj(raw) ? structuredClone(raw) : {};
    const next = mutate(overlay);
    await client.query("update settings set value = $2::jsonb, updated_at = now() where key = $1", [KEY, JSON.stringify(next)]);
    await client.query("commit");
    return { before: normalizeEngagement(raw), after: normalizeEngagement(next) };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function setMode(pool: Pool, platform: EngagementPlatform, mode: Mode) {
  return updateEngagement(pool, (o) => ({ ...o, mode: { ...(isObj(o.mode) ? o.mode : {}), [platform]: mode } }));
}

export function setKilled(pool: Pool, killed: boolean, reason?: string) {
  return updateEngagement(pool, (o) => {
    const { killedReason: _previous, ...rest } = o;
    return killed && reason ? { ...rest, killed, killedReason: reason } : { ...rest, killed };
  });
}
