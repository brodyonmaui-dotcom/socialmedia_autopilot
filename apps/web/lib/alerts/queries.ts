// Server only: the /alerts page reads and acknowledges alerts here. Acknowledge is a timestamp + the
// session that did it (migration 0008); rows are never removed.
import type { Pool } from "pg";
import { ALERT_KINDS, isAlertKind, type AlertKind, type AlertSource } from "@autopilot/core";

export type AlertState = "open" | "acknowledged";

export interface AlertView {
  id: string;
  kind: AlertKind;
  source: AlertSource;
  /** As stored: writers sanitise at write time. Rendered as text only. */
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
  batchId: string | null;
  batchItemId: string | null;
}

/** The Acknowledged tab looks this far back (by acknowledged_at). */
export const ACK_WINDOW_DAYS = 30;
/** Most cards one page shows (and so the most "Acknowledge all shown" can touch). */
export const LIST_LIMIT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A ?kind= value from the URL → a known kind, or undefined (= unfiltered). Never reaches SQL unvalidated. */
export function parseKind(raw: unknown): AlertKind | undefined {
  return isAlertKind(raw) ? raw : undefined;
}

export function parseState(raw: unknown): AlertState {
  return raw === "acknowledged" ? "acknowledged" : "open";
}

/** Only well-formed, de-duplicated uuids, capped at LIST_LIMIT. */
export function cleanIds(raw: unknown[]): string[] {
  const out = new Set<string>();
  for (const x of raw) {
    if (typeof x === "string" && UUID.test(x)) out.add(x.toLowerCase());
    if (out.size >= LIST_LIMIT) break;
  }
  return [...out];
}

const ackSince = (now: Date) => new Date(now.getTime() - ACK_WINDOW_DAYS * 86_400_000);

/** The where clause for a tab (pushes its own params). */
function stateWhere(state: AlertState, now: Date, params: unknown[]): string {
  if (state === "open") return "a.acknowledged_at is null";
  params.push(ackSince(now));
  return `a.acknowledged_at >= $${params.length}`;
}

export async function listAlerts(pool: Pool, opts: { state: AlertState; kind?: AlertKind; now?: Date }): Promise<AlertView[]> {
  const now = opts.now ?? new Date();
  const kind = parseKind(opts.kind);
  const params: unknown[] = [];
  let where = stateWhere(opts.state, now, params);
  if (kind) {
    params.push(kind);
    where += ` and a.kind = $${params.length}`;
  }
  params.push(LIST_LIMIT);
  const order = opts.state === "open" ? "a.created_at desc, a.id" : "a.acknowledged_at desc, a.id";
  const { rows } = await pool.query(
    `select a.id, a.kind, a.platform, a.message, a.created_at, a.acknowledged_at, a.batch_item_id, bi.batch_id
       from alerts a left join batch_items bi on bi.id = a.batch_item_id
      where ${where}
      order by ${order}
      limit $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as AlertKind,
    source: r.platform as AlertSource,
    message: r.message as string,
    createdAt: new Date(r.created_at as Date | string).toISOString(),
    acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at as Date | string).toISOString() : null,
    batchId: (r.batch_id as string | null) ?? null,
    batchItemId: (r.batch_item_id as string | null) ?? null,
  }));
}

/** Per-kind counts for a tab's chips. Unknown kinds in the DB (free text) are left out. */
export async function countByKind(pool: Pool, state: AlertState, now: Date = new Date()): Promise<Partial<Record<AlertKind, number>>> {
  const params: unknown[] = [];
  const where = stateWhere(state, now, params);
  const { rows } = await pool.query(`select a.kind, count(*)::int as n from alerts a where ${where} group by a.kind`, params);
  const out: Partial<Record<AlertKind, number>> = {};
  for (const r of rows as Array<{ kind: string; n: number }>) if (isAlertKind(r.kind)) out[r.kind] = r.n;
  return out;
}

export function countOpenByKind(pool: Pool): Promise<Partial<Record<AlertKind, number>>> {
  return countByKind(pool, "open");
}

/** Acknowledges the given open alerts; already-acknowledged rows are left as they are. Returns how many changed. */
export async function acknowledge(pool: Pool, ids: string[], sessionId: string, now: Date = new Date()): Promise<number> {
  const clean = cleanIds(ids);
  if (clean.length === 0) return 0;
  const { rowCount } = await pool.query(
    `update alerts set acknowledged_at = $2, acknowledged_session = $3
      where id = any($1::uuid[]) and acknowledged_at is null`,
    [clean, now, sessionId],
  );
  return rowCount ?? 0;
}

/** Acknowledges every open alert (of one kind, when given). An unknown kind acknowledges nothing. Returns how many changed. */
export async function acknowledgeAll(pool: Pool, sessionId: string, kind?: AlertKind, now: Date = new Date()): Promise<number> {
  const k = parseKind(kind);
  if (kind !== undefined && !k) return 0; // a bad filter must not widen to "all open"
  const { rowCount } = await pool.query(
    `update alerts set acknowledged_at = $1, acknowledged_session = $2
      where acknowledged_at is null and ($3::text is null or kind = $3)`,
    [now, sessionId, k ?? null],
  );
  return rowCount ?? 0;
}

const KIND_LABEL: Record<AlertKind, string> = {
  "final-failure": "Failed",
  "unknown-outcome": "Unknown outcome",
  "cap-breach": "Cap reached",
  duplicate: "Duplicate",
  "token-health": "Token health",
  auth: "Login",
  "engagement-kill": "Engagement stopped",
  "engagement-failure": "Engagement failed",
  "engagement-unknown": "Engagement unknown",
  "engagement-mode": "Engagement mode",
  "metrics-health": "Metrics",
  config: "Configuration",
  "ready-for-approval": "Ready for approval",
  "settings-change": "Settings change",
};

export function kindLabel(kind: AlertKind): string {
  return KIND_LABEL[kind];
}

/** Chip order: the kinds as declared in core. */
export const KIND_ORDER: readonly AlertKind[] = ALERT_KINDS;

const SOURCE_LABEL: Record<AlertSource, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  web: "Login",
  meta: "Meta",
  zernio: "Zernio",
  all: "All platforms",
};

/** Free text in the DB: anything unexpected shows as "other", never echoed. */
export function sourceLabel(source: string): string {
  return (SOURCE_LABEL as Record<string, string>)[source] ?? "other";
}
