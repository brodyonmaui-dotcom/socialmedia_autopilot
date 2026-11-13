import { normalizeCadence, type CadenceSettings } from "@autopilot/core";
import { getSetting } from "./settings.js";

/** Just the query method (pg.Pool, a client, or a test fake). Rows are loose so callers' fakes fit. */
export interface CadencePool {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

/** Cadence = posting_windows (0002) + the cadence overrides (0005), validated against the core defaults. */
export async function loadCadence(pool: CadencePool): Promise<CadenceSettings> {
  const windows = await getSetting<CadenceSettings["windows"]>(pool, "posting_windows");
  const overrides = (await getSetting<Partial<CadenceSettings>>(pool, "cadence")) ?? {};
  return normalizeCadence({ ...overrides, ...(windows?.length ? { windows } : {}) });
}
