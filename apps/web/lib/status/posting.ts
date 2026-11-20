// F18 posting status: is the worker posting, and did approved posts miss their time? Read-only.
// `worker_status` (settings) is written by the worker's heartbeat; it is parsed defensively here with a
// local type (no import from the worker or core outbox). The missed count is always computed in SQL,
// never taken from the heartbeat. Pure helpers are tested in __tests__/posting.test.ts, the loader in
// __tests__/posting.db.test.ts.
import type { Pool } from "pg";
import { localClock12, localDate } from "@autopilot/core";

/** An approved post this far past its time is "missed" (the worker won't send it; it waits for a Move). */
export const MISSED_GRACE_MS = 60 * 60_000;
/** A heartbeat older than this means the worker isn't running. */
export const STALE_MS = 5 * 60_000;
export const WORKER_STATUS_KEY = "worker_status";

export type PostingState = "live" | "dry-run" | "stale" | "unknown";

/** The heartbeat as far as the web trusts it. Anything malformed becomes null. */
export interface WorkerStatus {
  mode: "live" | "dry-run" | null;
  lastTickAt: string | null;
  startedAt: string | null;
}

export interface PostingStatus {
  state: PostingState;
  /** ISO time of the last heartbeat (tick, else start), null when none. */
  lastTickAt: string | null;
  /** Approved, not Snapchat, in an approved batch, more than an hour past its time. */
  missed: number;
  /** ISO time of the oldest missed post (for the calendar link), null when none. */
  oldestMissedAt: string | null;
  /** ISO time of the newest missed post (to tell whether all of them sit in the viewed range). */
  newestMissedAt?: string | null;
}

const iso = (v: unknown): string | null => {
  if (typeof v !== "string" || v.length > 64) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** Defensive parse of the `worker_status` value (jsonb). Null for anything that isn't an object. */
export function parseWorkerStatus(raw: unknown): WorkerStatus | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const mode = o.mode === "live" || o.mode === "dry-run" ? o.mode : null;
  return { mode, lastTickAt: iso(o.lastTickAt), startedAt: iso(o.startedAt) };
}

/** The four states: unknown = no usable row; stale = last heartbeat older than 5 min; else the mode. */
export function postingState(ws: WorkerStatus | null, now: Date): { state: PostingState; lastTickAt: string | null } {
  const last = ws ? ws.lastTickAt ?? ws.startedAt : null;
  if (!ws || !ws.mode || !last) return { state: "unknown", lastTickAt: last };
  if (now.getTime() - Date.parse(last) > STALE_MS) return { state: "stale", lastTickAt: last };
  return { state: ws.mode, lastTickAt: last };
}

/** Calendar card rule: approved (not yet sent), not Snapchat (shared by hand), more than an hour past its time. */
export function isMissedSlot(i: { status: string; platform: string; scheduledFor: string | null }, now: Date): boolean {
  if (i.status !== "approved" || i.platform === "snapchat" || !i.scheduledFor) return false;
  const t = Date.parse(i.scheduledFor);
  return Number.isFinite(t) && t < now.getTime() - MISSED_GRACE_MS;
}

export const POSTING_SQL = {
  status: `select value from settings where key = $1`,
  missed: `select count(*)::int as n, min(bi.scheduled_for) as oldest, max(bi.scheduled_for) as newest
             from batch_items bi join batches b on b.id = bi.batch_id
            where bi.status = 'approved'
              and b.status = 'approved'
              and bi.platform <> 'snapchat'
              and bi.scheduled_for < $1`,
} as const;

/** `key` is only for tests (an isolated settings row); the app always reads `worker_status`. */
export async function loadPostingStatus(pool: Pick<Pool, "query">, now: Date, opts: { key?: string } = {}): Promise<PostingStatus> {
  const [status, missed] = await Promise.all([
    pool.query(POSTING_SQL.status, [opts.key ?? WORKER_STATUS_KEY]),
    pool.query(POSTING_SQL.missed, [new Date(now.getTime() - MISSED_GRACE_MS)]),
  ]);
  const { state, lastTickAt } = postingState(parseWorkerStatus(status.rows[0]?.value), now);
  const m = missed.rows[0] as { n?: number; oldest?: Date | string | null; newest?: Date | string | null } | undefined;
  const oldest = m?.oldest ? new Date(m.oldest).toISOString() : null;
  const newest = m?.newest ? new Date(m.newest).toISOString() : null;
  return { state, lastTickAt, missed: Number(m?.n ?? 0), oldestMissedAt: oldest, newestMissedAt: newest };
}

// ---------------------------------------------------------------- banner view

export interface PostingNotice {
  tone: "warn" | "danger";
  text: string;
  /** Second, quieter line (how to fix it). */
  detail?: string;
  href?: string;
  linkLabel?: string;
  /** A real button-link beside the text (e.g. "Reschedule all"). */
  action?: { label: string; href: string };
}

export interface PostingBannerView {
  notices: PostingNotice[];
  /** Calendar only, when live and fresh with nothing missed: "Posting is on". */
  quiet: string | null;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9:14 AM" today, "Nov 18, 9:14 AM" another day (creator zone); " UTC" is added when the zone is a fallback. */
export function sinceText(at: string, now: Date, timeZone: string, fallback = false): string {
  const d = new Date(at);
  const day = localDate(d, timeZone);
  const clock = localClock12(d, timeZone);
  const base = day === localDate(now, timeZone) ? clock : `${MON[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${clock}`;
  return fallback ? `${base} UTC` : base;
}

export function postingBanner(
  s: PostingStatus,
  opts: {
    now: Date;
    timeZone: string;
    zoneFallback?: boolean;
    surface: "home" | "calendar";
    /** Calendar: the days on screen (creator-local, inclusive). Missed posts all inside → "marked below", no link. */
    range?: { from: string; to: string };
    /** Where "Reschedule all" goes when the viewed range holds every missed post (the current view + ?reschedule=all). */
    rescheduleHref?: string;
  },
): PostingBannerView {
  const notices: PostingNotice[] = [];
  if (s.state === "dry-run") {
    notices.push({
      tone: "warn",
      text: "Posting is off (dry run). Approved posts won't go out.",
      detail: "Turn it on: set DRY_RUN=false and WORKER_LIVE=1 on the server, then restart the worker.",
    });
  } else if (s.state === "stale") {
    notices.push({
      tone: "danger",
      text: s.lastTickAt
        ? `The worker hasn't checked in since ${sinceText(s.lastTickAt, opts.now, opts.timeZone, opts.zoneFallback)} — nothing is posting.`
        : "The worker hasn't reported yet.",
    });
  } else if (s.state === "unknown") {
    notices.push({ tone: "danger", text: "The worker hasn't reported yet." });
  }
  if (s.missed > 0) {
    const oldestDay = s.oldestMissedAt ? localDate(new Date(s.oldestMissedAt), opts.timeZone) : null;
    const newestDay = s.newestMissedAt ? localDate(new Date(s.newestMissedAt), opts.timeZone) : oldestDay;
    const inRange = !!(opts.range && oldestDay && newestDay && oldestDay >= opts.range.from && newestDay <= opts.range.to);
    const weekHref = oldestDay ? `/calendar?view=week&d=${oldestDay}` : "/calendar";
    if (inRange) {
      notices.push({
        tone: "warn",
        text: s.missed === 1 ? "1 missed post is marked below" : `${s.missed} missed posts are marked below`,
        action: { label: "Reschedule all", href: opts.rescheduleHref ?? `${weekHref}&reschedule=all` },
      });
    } else {
      notices.push({
        tone: "warn",
        text: s.missed === 1 ? "1 approved post missed its time" : `${s.missed} approved posts missed their time`,
        href: weekHref,
        linkLabel: "Open week",
        action: { label: "Reschedule all", href: `${weekHref}&reschedule=all` },
      });
    }
  }
  const quiet = opts.surface === "calendar" && notices.length === 0 && s.state === "live" ? "Posting is on" : null;
  return { notices, quiet };
}
