// Demo rows for the v3 shell + Home (run-4 shell task): a few open alerts (Notifications pop-over and page)
// and two editor drafts in the newest draft week (Home "From your editors"). Local demo DB only (seed.ts
// guards the URL). Idempotent: alerts are matched by message, drafts by ingest_key. Nothing is removed.

interface Q {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

const ALERTS: Array<{ kind: string; platform: string; message: string; hoursAgo: number }> = [
  { kind: "token-health", platform: "meta", message: "Demo: the Instagram token expires in 6 days. Reconnect in Settings before then.", hoursAgo: 2 },
  { kind: "final-failure", platform: "youtube", message: "Demo: a YouTube upload failed after 3 tries (quota). It was not posted; retry from the calendar.", hoursAgo: 5 },
  { kind: "metrics-health", platform: "instagram", message: "Demo: yesterday's Instagram numbers didn't arrive. The next sync tries again tonight.", hoursAgo: 26 },
];

/** Returns a one-line summary for the seed log. */
export async function seedShellDemo(db: Q): Promise<string> {
  let alerts = 0;
  for (const a of ALERTS) {
    const r = await db.query(
      `insert into alerts (kind, platform, message, created_at, pushed_at)
       select $1, $2, $3, now() - make_interval(hours => $4), now()
        where not exists (select 1 from alerts where message = $3)`,
      [a.kind, a.platform, a.message, a.hoursAgo],
    );
    alerts += r.rowCount ?? 0;
  }

  let drafts = 0;
  const batch = (await db.query("select id, week_start::text as ws from batches where status = 'draft' order by week_start desc limit 1")).rows[0] as { id: string; ws: string } | undefined;
  const media = (await db.query("select id, content_hash from media where content_hash like 'demo-%' order by content_hash offset 3 limit 2")).rows as Array<{ id: string; content_hash: string }>;
  if (batch && media.length === 2) {
    const clips = [
      { m: media[0]!, caption: "Three warm-up moves before squats.\n#gym #legday", title: "3 warm-up moves before squats", day: 1, pillar: "gym" },
      { m: media[1]!, caption: "What I check before opening a trade.\n#trading", title: "My pre-trade checklist", day: 2, pillar: "trading" },
    ];
    for (const [n, c] of clips.entries()) {
      for (const platform of ["instagram", "youtube"]) {
        const at = new Date(`${batch.ws}T${platform === "instagram" ? "17" : "18"}:30:00Z`);
        at.setUTCDate(at.getUTCDate() + c.day);
        const r = await db.query(
          `insert into batch_items (batch_id, media_id, platform, caption, title, scheduled_for, status, origin, ingest_key, trial)
           values ($1, $2, $3, $4, $5, $6, 'draft', 'editor', $7, $8)
           on conflict (ingest_key) where ingest_key is not null do nothing`,
          [batch.id, c.m.id, platform, c.caption, platform === "youtube" ? c.title : null, at, `demo-shell-editor-${n}-${platform}`, JSON.stringify({ editor: { source: "Demo editor", pillar: c.pillar } })],
        );
        drafts += r.rowCount ?? 0;
      }
    }
  }
  return `shell demo: +${alerts} alerts, +${drafts} editor drafts`;
}
