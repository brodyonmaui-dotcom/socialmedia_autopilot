// F20: what the Inbox holds right now, per platform, for the notifications pop-over and /notifications.
// Read-only; the same where-clauses as the Inbox lists, so a row here always has matching items there.
import type { Pool } from "pg";
import type { EngagementPlatform } from "@autopilot/engagement";
import { COMMENT_FROM, COMMENT_WHERE, DM_FROM, DM_WHERE, INBOX_PLATFORMS } from "./list.js";

export interface InboxGroupItem {
  id: string;
  authorHandle: string | null;
  text: string;
  /** ISO */
  at: string;
}

export interface InboxGroup {
  platform: EngagementPlatform;
  /** Comments with a drafted reply waiting for one tap. */
  drafted: number;
  /** Flagged comments with no draft. */
  needsYou: number;
  /** DM threads open (needs you or drafted). */
  dmsOpen: number;
  /** Newest open comment (drafted or needs you); null when none. */
  newest: InboxGroupItem | null;
  /** Newest open DM thread (id = thread id); null when none. */
  newestDm: InboxGroupItem | null;
}

const TEXT_MAX = 80;
const clip = (s: unknown) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX - 1)}…` : t;
};
const iso = (v: unknown) => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** Platforms with something open, in platform order; empty platforms are left out. */
export async function loadInboxGroups(pool: Pick<Pool, "query">): Promise<InboxGroup[]> {
  const open = `(${COMMENT_WHERE["needs-you"]}) or (${COMMENT_WHERE.drafted})`;
  const dmOpen = `(${DM_WHERE["needs-you"]}) or (${DM_WHERE.drafted})`;
  const [counts, newest, dmCounts, dmNewest] = await Promise.all([
    pool.query(
      `select c.platform, count(*) filter (where ${COMMENT_WHERE.drafted})::int as drafted, count(*) filter (where ${COMMENT_WHERE["needs-you"]})::int as needs_you
         ${COMMENT_FROM} group by c.platform`,
    ),
    pool.query(
      `select distinct on (c.platform) c.platform, c.id, c.author_handle, c.text, c.commented_at as at
         ${COMMENT_FROM} and (${open}) order by c.platform, c.commented_at desc, c.id desc`,
    ),
    pool.query(`select t.platform, count(*)::int as n ${DM_FROM} and (${dmOpen}) group by t.platform`),
    pool.query(
      `select distinct on (t.platform) t.platform, t.id, t.participant_handle as author_handle, coalesce(t.last_inbound_at, now()) as at,
              (select m.text from dm_messages m where m.thread_id = t.id and m.direction = 'in' order by m.sent_at desc limit 1) as text
         ${DM_FROM} and (${dmOpen}) order by t.platform, coalesce(t.last_inbound_at, now()) desc, t.id desc`,
    ),
  ]);
  const item = (r: Record<string, any>): InboxGroupItem => ({ id: r.id, authorHandle: r.author_handle ?? null, text: clip(r.text), at: iso(r.at) });
  const by = <T extends Record<string, any>>(rows: T[]) => new Map(rows.map((r) => [r.platform as string, r]));
  const c = by(counts.rows), n = by(newest.rows), d = by(dmCounts.rows), dn = by(dmNewest.rows);
  const out: InboxGroup[] = [];
  for (const platform of INBOX_PLATFORMS) {
    const g: InboxGroup = {
      platform,
      drafted: Number(c.get(platform)?.drafted ?? 0),
      needsYou: Number(c.get(platform)?.needs_you ?? 0),
      dmsOpen: Number(d.get(platform)?.n ?? 0),
      newest: n.has(platform) ? item(n.get(platform)!) : null,
      newestDm: dn.has(platform) ? item(dn.get(platform)!) : null,
    };
    if (g.drafted + g.needsYou + g.dmsOpen > 0) out.push(g);
  }
  return out;
}
