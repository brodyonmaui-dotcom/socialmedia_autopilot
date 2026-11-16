/**
 * Dev seed: 60 days of account-wide analytics demo rows (0011_account_posts.sql) so the analytics
 * overview and platform pages have data locally. Invented numbers, generic gym/trading captions, no
 * places or names. Deterministic (seeded PRNG, dates anchored on today's UTC date) and idempotent:
 * skipped when account_posts already has rows. About a third of the posts reuse the already-seeded
 * published app items (matched_by 'id'); those items' shared placeholder post id 'demo' is replaced by a
 * unique demo id first (a post id must be unique per platform). The rest are "posted by hand".
 */

interface Client {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}
interface Pool extends Client {
  connect(): Promise<Client & { release(): void }>;
}

const DAY = 86_400_000;
export const ACCOUNT_SEED_DAYS = 60;
export const ACCOUNT_SEED_COUNTS = { instagram: 70, youtube: 45 } as const;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
/** Standard normal from two uniforms (Box–Muller). */
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

const CAPTIONS = {
  gym: [
    "Pull day, slow negatives…",
    "Leg day, no skipping #gym #legday",
    "Just stacking days is all 🙂‍↕️…",
    "Definitely due for a deload…",
    "Same warm-up, heavier top set.",
    "Why your bench stalls?",
    "3 mistakes on back day",
    "Push day, every set #gymbro",
    "My lats are not a fan of this…",
    "Most people don't need more sets. They need better reps.",
  ],
  trading: [
    "Took the 1:1R and walked away. Not financial advice.",
    "Welp, I was the liquidity today 🥀",
    "Red day recap, stuck to the plan. Not financial advice.",
    "Why I stopped trading the open?",
    "Chart check before the session",
  ],
  other: ["Sunday reset ☕", "Weekly meal prep, keeping it simple.", "Q&A: what should I post next?", "Slow morning, long walk."],
} as const;
type Pillar = keyof typeof CAPTIONS;

export interface DemoAccountPost {
  platform: "instagram" | "youtube";
  platformPostId: string;
  permalink: string;
  kind: string | null;
  caption: string;
  title: string | null;
  publishedAt: Date;
  durationS: number | null;
  batchItemId: string | null;
  snapshots: Array<{ at: Date; views: number; likes: number; comments: number; shares: number | null; saves: number | null; reach: number | null; avgWatchS: number | null }>;
}

const igId = (i: number) => `1799${String(10_000_000_000_000 + i).slice(1)}`; // 17-digit numeric, demo range
const ytId = (i: number) => `demoYT${String(i).padStart(5, "0")}`; // 11 chars like a video id
const CODE = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const shortcode = (r: () => number) => Array.from({ length: 11 }, () => CODE[Math.floor(r() * CODE.length)]).join("");

/** Pure builder (tested): the demo posts for an anchor day, given the app items to reuse. */
export function buildDemoAccountPosts(
  todayUtc: Date,
  items: Array<{ id: string; platform: string; platformPostId: string; caption: string; title: string | null; scheduledFor: Date; durationS: number | null; pillar: string | null }>,
): DemoAccountPost[] {
  const r = mulberry32(20261116);
  const now = todayUtc.getTime() + 12 * 3_600_000; // snapshots never after midday of the anchor day
  const start = todayUtc.getTime() - ACCOUNT_SEED_DAYS * DAY;
  const out: DemoAccountPost[] = [];
  for (const platform of ["instagram", "youtube"] as const) {
    const matched = items.filter((it) => it.platform === platform && it.scheduledFor.getTime() < now - 6 * 3_600_000 && it.scheduledFor.getTime() >= start);
    const wantMatched = Math.round(ACCOUNT_SEED_COUNTS[platform] / 3);
    const reuse = matched.filter((_, i) => i % Math.max(1, Math.floor(matched.length / wantMatched)) === 0).slice(0, wantMatched);
    const handCount = ACCOUNT_SEED_COUNTS[platform] - reuse.length;
    const base = platform === "instagram" ? 420 : 260;
    let k = 0;
    const make = (o: { pillar: Pillar | string; caption: string; title: string | null; publishedAt: Date; durationS: number | null; batchItemId: string | null; platformPostId: string | null }) => {
      k++;
      const id = o.platformPostId ?? (platform === "instagram" ? igId(k) : ytId(k));
      const local = o.publishedAt.getUTCHours();
      let mu = Math.log(base);
      if (o.pillar === "gym") mu += 0.35;
      if (o.pillar === "trading") mu -= 0.45;
      const d = o.durationS ?? 30;
      if (d < 15) mu += 0.55;
      else if (d > 60) mu -= 0.4;
      if (local >= 17 && local < 22) mu += 0.3;
      if (/…|\?$/.test(o.caption.split("\n")[0]!)) mu += 0.2;
      let views = Math.exp(mu + 0.65 * gauss(r));
      if (r() < 0.05) views *= 6 + r() * 6; // a few outliers
      const er = 0.04 + r() * 0.05;
      const ageDays = (now - o.publishedAt.getTime()) / DAY;
      const offsets = [1, 3, 7, 21].filter((x) => x <= ageDays);
      const nSnaps = Math.min(offsets.length, 2 + Math.floor(r() * 3)) || 1;
      const picks = offsets.length ? offsets.slice(0, nSnaps) : [Math.max(0.2, ageDays * 0.9)];
      const curve = (dd: number) => 1 - Math.exp(-dd / 2.5);
      const snapshots = picks.map((dd) => {
        const v = Math.round(views * curve(dd));
        return {
          at: new Date(o.publishedAt.getTime() + dd * DAY),
          views: v,
          likes: Math.round(v * er * 0.8),
          comments: Math.round(v * er * 0.06),
          shares: platform === "instagram" ? Math.round(v * er * 0.1) : null, // not in the YouTube Data API
          saves: platform === "instagram" ? Math.round(v * er * 0.08) : null,
          reach: platform === "instagram" ? Math.round(v * 0.78) : null,
          avgWatchS: platform === "instagram" ? Math.round((3 + r() * 5) * 10) / 10 : null,
        };
      });
      out.push({
        platform,
        platformPostId: id,
        permalink: platform === "instagram" ? `https://www.instagram.com/reel/${shortcode(r)}/` : `https://www.youtube.com/watch?v=${id}`,
        kind: platform === "instagram" ? "reels" : null,
        caption: o.caption,
        title: o.title,
        publishedAt: o.publishedAt,
        durationS: o.durationS,
        batchItemId: o.batchItemId,
        snapshots,
      });
    };
    for (const it of reuse) {
      make({
        pillar: it.pillar ?? "other",
        caption: it.caption,
        title: platform === "youtube" ? (it.title ?? it.caption.split("\n")[0]!.slice(0, 60)) : null,
        publishedAt: new Date(it.scheduledFor.getTime() + 60_000),
        durationS: platform === "youtube" ? it.durationS : null, // IG gives no duration; the matched clip's is used
        batchItemId: it.id,
        platformPostId: it.platformPostId,
      });
    }
    for (let i = 0; i < handCount; i++) {
      const roll = r();
      const pillar: Pillar = roll < 0.55 ? "gym" : roll < 0.8 ? "trading" : "other";
      const caps = CAPTIONS[pillar];
      const caption = caps[Math.floor(r() * caps.length)]!;
      const day = Math.floor(r() * ACCOUNT_SEED_DAYS);
      const hour = 6 + Math.floor(r() * 17);
      const publishedAt = new Date(start + day * DAY + hour * 3_600_000 + Math.floor(r() * 60) * 60_000);
      if (publishedAt.getTime() > now - 3_600_000) continue;
      const durationS = platform === "youtube" ? Math.round(6 + Math.exp(Math.log(25) + 0.6 * gauss(r))) : null;
      make({ pillar, caption, title: platform === "youtube" ? caption.split("\n")[0]!.replace(/\s*#\S+/g, "").slice(0, 60) : null, publishedAt, durationS: durationS !== null ? Math.min(durationS, 170) : null, batchItemId: null, platformPostId: null });
    }
  }
  return out;
}

/** Daily account rows: slowly growing followers, cumulative views on YouTube. */
export function buildDemoAccountDaily(todayUtc: Date): Array<{ platform: string; day: string; followers: number; totalViews: number | null; postsCount: number }> {
  const r = mulberry32(7);
  const out: Array<{ platform: string; day: string; followers: number; totalViews: number | null; postsCount: number }> = [];
  let ig = 1180;
  let yt = 290;
  let ytViews = 41_000;
  for (let d = ACCOUNT_SEED_DAYS; d >= 0; d--) {
    const day = new Date(todayUtc.getTime() - d * DAY).toISOString().slice(0, 10);
    ig += Math.round(1 + r() * 4);
    yt += Math.round(r() * 3);
    ytViews += Math.round(250 + r() * 600);
    out.push({ platform: "instagram", day, followers: ig, totalViews: null, postsCount: 120 + Math.floor((ACCOUNT_SEED_DAYS - d) * 1.15) });
    out.push({ platform: "youtube", day, followers: yt, totalViews: ytViews, postsCount: 60 + Math.floor((ACCOUNT_SEED_DAYS - d) * 0.75) });
  }
  return out;
}

/** Writes the demo rows in one transaction. Returns a one-line summary for dev:seed. */
export async function seedAccountPosts(pool: Pool, now = new Date()): Promise<string> {
  const exists = await pool.query("select count(*)::int n from account_posts");
  if (exists.rows[0].n > 0) return `account posts: already seeded (${exists.rows[0].n})`;
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const client = await pool.connect();
  try {
    await client.query("begin");
    const items = (
      await client.query(
        `select bi.id, bi.platform, bi.platform_post_id, bi.caption, bi.title, bi.scheduled_for, m.duration_s, m.pillar
           from batch_items bi join media m on m.id = bi.media_id
          where bi.status = 'published' and bi.platform in ('instagram', 'youtube') and m.content_hash like 'demo-%'
          order by bi.scheduled_for, bi.id`,
      )
    ).rows;
    // Give each reused demo item its own post id (the base seed writes the placeholder 'demo' for all).
    let n = 0;
    for (const it of items) {
      n++;
      if (it.platform_post_id && it.platform_post_id !== "demo") continue;
      it.platform_post_id = it.platform === "instagram" ? `1798${String(10_000_000_000_000 + n).slice(1)}` : `demoAp${String(n).padStart(5, "0")}`;
      await client.query("update batch_items set platform_post_id = $2 where id = $1 and (platform_post_id is null or platform_post_id = 'demo')", [it.id, it.platform_post_id]);
    }
    const posts = buildDemoAccountPosts(
      todayUtc,
      items.map((it) => ({
        id: it.id,
        platform: it.platform,
        platformPostId: it.platform_post_id,
        caption: it.caption ?? "",
        title: it.title ?? null,
        scheduledFor: new Date(it.scheduled_for),
        durationS: it.duration_s === null ? null : Number(it.duration_s),
        pillar: it.pillar ?? null,
      })),
    );
    let snaps = 0;
    for (const p of posts) {
      const row = await client.query(
        `insert into account_posts (platform, platform_post_id, permalink, kind, caption, title, published_at, duration_s, batch_item_id, matched_by, first_seen_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         on conflict (platform, platform_post_id) do nothing returning id`,
        [p.platform, p.platformPostId, p.permalink, p.kind, p.caption, p.title, p.publishedAt.toISOString(), p.durationS, p.batchItemId, p.batchItemId ? "id" : null, p.snapshots[0]!.at.toISOString()],
      );
      const id = row.rows[0]?.id as string | undefined;
      if (!id) continue;
      for (const s of p.snapshots) {
        await client.query(
          `insert into account_post_snapshots (account_post_id, captured_at, views, likes, comments, shares, saves, reach, avg_watch_s)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict do nothing`,
          [id, s.at.toISOString(), s.views, s.likes, s.comments, s.shares, s.saves, s.reach, s.avgWatchS],
        );
        snaps++;
      }
    }
    const daily = buildDemoAccountDaily(todayUtc);
    for (const d of daily) {
      await client.query(
        `insert into account_snapshots (platform, captured_on, followers, total_views, posts_count) values ($1, $2::date, $3, $4, $5) on conflict do nothing`,
        [d.platform, d.day, d.followers, d.totalViews, d.postsCount],
      );
    }
    await client.query("commit");
    const matched = posts.filter((p) => p.batchItemId).length;
    return `account posts: ${posts.length} (${matched} matched, ${posts.length - matched} by hand), ${snaps} snapshots, ${daily.length} account rows`;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
