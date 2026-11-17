// Calendar demo rows (run-4 calendar task): makes the current week believable: approved posts still to go
// out, drafts from the editor, one failed and one "check it" post, and a daily Snapchat share. Local demo DB
// only (seed.ts guards the URL). Idempotent via ingest_key; nothing is updated or removed.

interface Q {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

type Row = { day: number; hhmm: string; platform: string; status: string; clip: number; caption: string; title?: string; editor?: boolean; error?: string; attempts?: number };

const ROWS: Row[] = [
  // Approved, still to go out (Wed–Fri).
  { day: 2, hhmm: "17:00", platform: "instagram", status: "approved", clip: 0, caption: "Five-minute mobility before every lift.\n#gym" },
  { day: 2, hhmm: "18:00", platform: "youtube", status: "approved", clip: 0, caption: "Five-minute mobility before every lift.", title: "5-minute mobility routine" },
  { day: 3, hhmm: "17:30", platform: "instagram", status: "approved", clip: 1, caption: "How I size a position before the open.\n#trading" },
  { day: 3, hhmm: "19:00", platform: "tiktok", status: "approved", clip: 1, caption: "How I size a position before the open." },
  { day: 4, hhmm: "17:00", platform: "youtube", status: "approved", clip: 2, caption: "Meal prep for a busy week.", title: "Sunday meal prep in 20 minutes" },
  // Drafts from the editor (need approval).
  { day: 3, hhmm: "12:30", platform: "instagram", status: "draft", clip: 3, caption: "Deadlift cues that fixed my back.\n#gym", editor: true },
  { day: 3, hhmm: "13:00", platform: "tiktok", status: "draft", clip: 3, caption: "", editor: true },
  { day: 5, hhmm: "10:00", platform: "instagram", status: "draft", clip: 4, caption: "Weekend long run, easy pace.\n#running", editor: true },
  // One failed, one unknown (today).
  { day: 0, hhmm: "08:00", platform: "instagram", status: "failed", clip: 5, caption: "Morning routine, no phone for an hour.", error: "media processing timed out (demo)", attempts: 3 },
  { day: 0, hhmm: "09:00", platform: "youtube", status: "unknown", clip: 6, caption: "Chart review: three setups I skip.", title: "Three setups I skip", error: "upload timed out; outcome unknown (demo)", attempts: 1 },
  // Snapchat daily (shared by hand).
  ...[1, 2, 3, 4, 5, 6].map((d) => ({ day: d, hhmm: "12:00", platform: "snapchat", status: "approved", clip: 7 + d, caption: "" })),
];

const mondayOf = (d: Date) => {
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
};

/** Returns a one-line summary for the seed log. */
export async function seedCalendarDemo(db: Q, now: Date = new Date()): Promise<string> {
  const mon = mondayOf(now);
  const week = mon.toISOString().slice(0, 10);
  // The current week's batch: the approved one if present, else any; created (approved) when missing.
  let batch = (await db.query("select id from batches where week_start = $1 order by (status = 'approved') desc, created_at limit 1", [week])).rows[0]?.id as string | undefined;
  if (!batch) batch = (await db.query("insert into batches (week_start, status, approved_at) values ($1, 'approved', now()) returning id", [week])).rows[0].id as string;
  const media = (await db.query("select id from media where content_hash like 'demo-%' order by content_hash offset 20 limit 16")).rows as Array<{ id: string }>;
  if (media.length < 14) return "calendar demo: skipped (need 34 demo clips)";
  let added = 0;
  for (const [n, r] of ROWS.entries()) {
    const at = new Date(mon.getTime() + r.day * 86_400_000);
    const [h, m] = r.hhmm.split(":").map(Number) as [number, number];
    at.setUTCHours(h, m, 0, 0);
    const res = await db.query(
      `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, origin, ingest_key, trial, last_error, attempts, approved_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, case when $7 in ('approved', 'failed', 'unknown') then now() end)
       on conflict (ingest_key) where ingest_key is not null do nothing`,
      [
        batch,
        media[r.clip % media.length]!.id,
        r.platform,
        r.caption,
        r.title ?? null,
        at,
        r.status,
        r.editor ? "editor" : null,
        `demo-cal-${week}-${n}`,
        r.editor ? JSON.stringify({ editor: { source: "Demo editor" } }) : null,
        r.error ?? null,
        r.attempts ?? 0,
      ],
    );
    added += res.rowCount ?? 0;
  }
  return `calendar demo: +${added} posts this week`;
}
