import type { Pool } from "pg";
import { CAP_LIMITS, DEFAULT_CADENCE, normalizeCadence, PLATFORMS, type Platform } from "@autopilot/core";
import { getSetting, loadCadence } from "@autopilot/db";
import { writeSettingsAudit } from "./audit.js";

const KEY = "cadence";
type Overlay = Record<string, unknown>;
const isObj = (v: unknown): v is Overlay => typeof v === "object" && v !== null && !Array.isArray(v);

export type Caps = Record<Platform, number>;

export interface CapsView {
  /** Effective caps: the stored cadence over DEFAULT_CADENCE (loadCadence). */
  effective: Caps;
  /** Platforms whose cap is stored in the settings row (else the code default applies). */
  stored: Partial<Caps>;
  defaults: Caps;
  limits: Caps;
}

/** Read-only, for the Settings page. */
export async function loadCaps(pool: Pool): Promise<CapsView> {
  const [cadence, raw] = await Promise.all([loadCadence(pool), getSetting<unknown>(pool, KEY)]);
  const storedRaw = isObj(raw) && isObj(raw.dailyCaps) ? raw.dailyCaps : {};
  const stored: Partial<Caps> = {};
  for (const p of PLATFORMS) if (typeof storedRaw[p] === "number") stored[p] = storedRaw[p] as number;
  return { effective: { ...cadence.dailyCaps }, stored, defaults: { ...DEFAULT_CADENCE.dailyCaps }, limits: { ...CAP_LIMITS } };
}

/**
 * Pure: the form's per-platform values (`cap-<platform>`) → caps, or the first problem. Whole numbers
 * from 0 up to CAP_LIMITS only. A missing field means "leave as is" (not in the result).
 */
export function parseCapsForm(get: (name: string) => string | null): { ok: true; caps: Partial<Caps> } | { ok: false; error: string } {
  const caps: Partial<Caps> = {};
  for (const p of PLATFORMS) {
    const raw = get(`cap-${p}`);
    if (raw == null) continue;
    const t = raw.trim();
    if (!/^\d{1,3}$/.test(t)) return { ok: false, error: `${p}: enter a whole number from 0 to ${CAP_LIMITS[p]}` };
    const n = Number(t);
    if (n > CAP_LIMITS[p]) return { ok: false, error: `${p}: at most ${CAP_LIMITS[p]} a day (platform limit)` };
    caps[p] = n;
  }
  return { ok: true, caps };
}

/** "cap instagram 4→5, tiktok 5→6" for the changed platforms, or "" when nothing changed. */
export function capsChangeMessage(before: Caps, after: Caps): string {
  const parts = PLATFORMS.filter((p) => before[p] !== after[p]).map((p) => `${p} ${before[p]}→${after[p]}`);
  return parts.length ? `cap ${parts.join(", ")}` : "";
}

/**
 * Row-locked read-modify-write of the 'cadence' overlay (same shape as updateEngagement): only the
 * changed platforms are written into dailyCaps, so untouched ones keep following the code default.
 * The merged result is validated by normalizeCadence (throws > CAP_LIMITS); the audit row goes in the
 * same transaction. Scheduled posts are not touched: the caps apply to the next slotting.
 */
export async function updateCaps(pool: Pool, caps: Partial<Caps>): Promise<{ before: Caps; after: Caps; message: string }> {
  for (const p of PLATFORMS) {
    const v = caps[p];
    if (v === undefined) continue;
    if (!Number.isInteger(v) || v < 0 || v > CAP_LIMITS[p]) throw new RangeError(`cap ${p}: 0..${CAP_LIMITS[p]}`);
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`insert into settings (key, value, updated_at) values ($1, '{}'::jsonb, now()) on conflict (key) do nothing`, [KEY]);
    const { rows } = await client.query("select value from settings where key = $1 for update", [KEY]);
    const raw: unknown = rows[0]?.value;
    const overlay: Overlay = isObj(raw) ? structuredClone(raw) : {};
    const before = normalizeCadence(overlay).dailyCaps;
    const dailyCaps: Overlay = isObj(overlay.dailyCaps) ? { ...overlay.dailyCaps } : {};
    for (const p of PLATFORMS) {
      const v = caps[p];
      if (v !== undefined && v !== before[p]) dailyCaps[p] = v;
    }
    const next: Overlay = { ...overlay, dailyCaps };
    const after = normalizeCadence(next).dailyCaps; // validates; throws on anything out of range
    const message = capsChangeMessage(before, after);
    if (message) {
      await client.query("update settings set value = $2::jsonb, updated_at = now() where key = $1", [KEY, JSON.stringify(next)]);
      const changed = PLATFORMS.filter((p) => before[p] !== after[p]);
      await writeSettingsAudit(client, message, changed.length === 1 ? changed[0]! : "all");
    }
    await client.query("commit");
    return { before: { ...before }, after: { ...after }, message };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
