// cross-post-backfill skill: which Instagram reels aren't on YouTube / TikTok yet, and a paced catch-up draft.
//   pnpm skill:backfill snapshot                       read-only: lists IG reels, YT uploads, TikTok posts (Zernio),
//                                                      plus our own outbox/batches if DATABASE_URL is set → logs/
//   pnpm skill:backfill diff <snapshot.json> [--youtube-per-day 5] [--tiktok-per-day 4]
//                                                      report + queue → logs/backfill-report-<date>.md
//   pnpm skill:backfill draft <snapshot.json> [same pace flags]
//                                                      → logs/batch-backfill-<date>.json (weekly-batch draft shape)
// Never posts, never schedules, never approves. The draft goes through `weekly-batch check/review/create`
// and the creator's tap on the phone like every other batch. Prints one line; details go to logs/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CADENCE, generateCatchUpSlots } from "../../packages/core/src/index.js";
import { arg, loadEnv, writeLog } from "./lib/io.js";
import { buildQueue, diff, formatReport, summarize, type Pace, type Snapshot, type SourcePost, type TargetPost } from "./lib/backfill.js";
import { draftFromQueue } from "./lib/backfill-draft.js";

loadEnv();
const argv = process.argv.slice(2);
const [mode, file] = argv;
const today = new Date().toISOString().slice(0, 10);

function pace(): Pace {
  const n = (k: string, d: number) => {
    const v = Number(arg(argv, k) ?? d);
    if (!Number.isInteger(v) || v < 1 || v > 12) throw new Error(`--${k} must be 1-12`);
    return v;
  };
  return { perDay: { youtube: n("youtube-per-day", 5), tiktok: n("tiktok-per-day", 4) } };
}

async function get(url: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { headers });
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

/** Error text without echoing URLs (they can carry tokens) or bodies. */
const why = (r: { status: number; body: any }) => `HTTP ${r.status}${r.body?.error?.message ? ` ${String(r.body.error.message).slice(0, 80)}` : ""}`;

async function fetchInstagram(): Promise<SourcePost[]> {
  const token = process.env.META_ACCESS_TOKEN;
  const igId = process.env.IG_USER_ID;
  if (!token || !igId) throw new Error("META_ACCESS_TOKEN and IG_USER_ID are needed (run on the VPS)");
  const host = token.startsWith("IG") ? "https://graph.instagram.com" : "https://graph.facebook.com";
  const ver = process.env.META_GRAPH_VERSION ? `/${process.env.META_GRAPH_VERSION}` : "";
  const auth = { Authorization: `Bearer ${token}` };
  let url: string | null = `${host}${ver}/${igId}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,media_url&limit=50`;
  const out: SourcePost[] = [];
  for (let page = 0; url && page < 40; page++) {
    const r = await get(url, auth);
    if (r.status !== 200) throw new Error(`instagram media list: ${why(r)}`);
    for (const m of r.body?.data ?? []) {
      if (m.media_type !== "VIDEO") continue; // reels only
      out.push({ id: m.id, caption: m.caption ?? "", timestamp: m.timestamp, permalink: m.permalink, licensedAudio: !m.media_url });
    }
    url = r.body?.paging?.next ?? null;
  }
  return out;
}

async function fetchYouTube(): Promise<TargetPost[]> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !YT_REFRESH_TOKEN) throw new Error("GOOGLE_CLIENT_ID/SECRET and YT_REFRESH_TOKEN are needed");
  const t = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ refresh_token: YT_REFRESH_TOKEN, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, grant_type: "refresh_token" }),
  });
  const access = (await t.json().catch(() => ({})))?.access_token;
  if (!access) throw new Error(`youtube token refresh failed (HTTP ${t.status})`);
  const auth = { Authorization: `Bearer ${access}` };
  const ch = await get("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true", auth);
  const uploads = ch.body?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`youtube uploads playlist: ${why(ch)}`);
  const out: TargetPost[] = [];
  let pageToken = "";
  for (let page = 0; page < 40; page++) {
    // 1 quota unit per page of 50; includes private and scheduled uploads (we're the owner).
    const r = await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(uploads)}${pageToken ? `&pageToken=${pageToken}` : ""}`, auth);
    if (r.status !== 200) throw new Error(`youtube playlistItems: ${why(r)}`);
    for (const it of r.body?.items ?? []) {
      const s = it.snippet ?? {};
      out.push({ id: s.resourceId?.videoId ?? it.id, text: `${s.title ?? ""}\n${s.description ?? ""}`, timestamp: s.publishedAt, via: "platform" });
    }
    pageToken = r.body?.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return out;
}

async function fetchTikTok(): Promise<{ posts: TargetPost[]; coverageFrom?: string; notes: string[] }> {
  const key = process.env.ZERNIO_API_KEY;
  const accountId = process.env.ZERNIO_TIKTOK_ACCOUNT_ID;
  if (!key || !accountId) throw new Error("ZERNIO_API_KEY and ZERNIO_TIKTOK_ACCOUNT_ID are needed");
  const base = "https://zernio.com/api/v1";
  const auth = { Authorization: `Bearer ${key}` };
  const posts: TargetPost[] = [];
  const notes: string[] = [];
  const pick = (p: any) => p.platforms?.find((x: any) => x.platform === "tiktok") ?? p.platforms?.[0] ?? {};

  // 1. Synced history: posts made outside Zernio too (TikTok app), ~12 months (docs: GET /v1/posts source=external).
  let externalOk = true;
  for (let page = 1; page <= 20; page++) {
    const r = await get(`${base}/posts?source=external&accountId=${encodeURIComponent(accountId)}&page=${page}&limit=50`, auth);
    if (r.status !== 200) { externalOk = false; notes.push(`external history: ${why(r)}`); break; }
    const rows: any[] = r.body?.posts ?? [];
    for (const p of rows) posts.push({ id: pick(p).platformPostId ?? p._id, text: p.content ?? "", timestamp: pick(p).publishedAt ?? p.createdAt, via: "platform" });
    if (rows.length < 50) break;
  }
  // 2. Live: the 25 most recent posts straight from TikTok (catches anything the sync hasn't picked up).
  const live = await get(`${base}/accounts/${encodeURIComponent(accountId)}/posts`, auth);
  if (live.status === 200) {
    const rows: any[] = live.body?.posts ?? [];
    for (const p of rows) posts.push({ id: p.id, text: p.message ?? "", timestamp: p.createdTime, via: "platform" });
    if (!externalOk && rows.length >= 25) {
      const oldest = rows.map((p) => p.createdTime).sort()[0];
      notes.push(`only the 25 most recent TikToks were listed; IG reels before ${String(oldest).slice(0, 10)} are "check"`);
      return { posts: await withQueue(), coverageFrom: oldest, notes };
    }
  } else notes.push(`live list: ${why(live)}`);
  return { posts: await withQueue(), notes };

  // 3. Zernio's own queue: scheduled / held / draft posts not on TikTok yet.
  async function withQueue(): Promise<TargetPost[]> {
    for (let page = 1; page <= 20; page++) {
      const r = await get(`${base}/posts?accountId=${encodeURIComponent(accountId!)}&page=${page}&limit=50&view=summary`, auth);
      if (r.status !== 200) { notes.push(`zernio queue: ${why(r)}`); break; }
      const rows: any[] = r.body?.posts ?? [];
      for (const p of rows) {
        if (p.status === "failed" || pick(p).status === "failed") continue;
        posts.push({ id: p._id, text: p.content ?? "", timestamp: p.scheduledFor ?? p.createdAt, via: "zernio-queue" });
      }
      if (rows.length < 50) break;
    }
    return posts;
  }
}

async function fetchOutbox(): Promise<{ youtube: TargetPost[]; tiktok: TargetPost[] } | null> {
  if (!process.env.DATABASE_URL) return null;
  const { createPool } = await import("../../packages/db/src/client.js");
  const pool = createPool(process.env.DATABASE_URL);
  pool.on("error", () => {});
  try {
    const { rows } = await pool.query(
      `select id, platform, coalesce(title, '') as title, caption, scheduled_for from batch_items
       where platform in ('youtube','tiktok') and status not in ('failed','rejected','cancelled')`,
    );
    const out = { youtube: [] as TargetPost[], tiktok: [] as TargetPost[] };
    for (const r of rows) out[r.platform as "youtube" | "tiktok"].push({ id: r.id, text: `${r.title}\n${r.caption}`, timestamp: new Date(r.scheduled_for).toISOString(), via: "outbox" });
    return out;
  } finally {
    await pool.end();
  }
}

function writeJson(name: string, data: unknown): string {
  mkdirSync("logs", { recursive: true });
  const path = join("logs", `${name}-${today}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

try {
  if (mode === "snapshot") {
    const [instagram, youtube, tiktok, outbox] = await Promise.all([fetchInstagram(), fetchYouTube(), fetchTikTok(), fetchOutbox()]);
    const snap: Snapshot = {
      takenAt: new Date().toISOString(),
      instagram,
      youtube: [...youtube, ...(outbox?.youtube ?? [])],
      tiktok: [...tiktok.posts, ...(outbox?.tiktok ?? [])],
      ...(tiktok.coverageFrom ? { coverageFrom: { tiktok: tiktok.coverageFrom } } : {}),
    };
    const path = writeJson("backfill-snapshot", snap);
    const extra = [outbox ? "outbox included" : "no DATABASE_URL: outbox not checked", ...tiktok.notes].join("; ");
    console.log(`backfill snapshot: PASS ${instagram.length} IG reels, ${youtube.length} YT uploads, ${tiktok.posts.length} TikTok rows (${extra}) → ${path}`);
  } else if ((mode === "diff" || mode === "draft") && file) {
    const snap = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
    const p = pace();
    const results = diff(snap);
    const queue = buildQueue(results, p);
    const sum = summarize(results, queue);
    const report = writeLog("backfill-report", formatReport(snap, results, queue, p));
    const line = `YT missing ${sum.byTarget.youtube.missing} / check ${sum.byTarget.youtube.check} (${sum.daysToClear.youtube} days at +${p.perDay.youtube}), TikTok missing ${sum.byTarget.tiktok.missing} / check ${sum.byTarget.tiktok.check} (${sum.daysToClear.tiktok} days at +${p.perDay.tiktok})`;
    if (mode === "diff") {
      console.log(`backfill diff: PASS ${line} → ${report}`);
    } else {
      const tz = process.env.TZ_CREATOR;
      const start = arg(argv, "start") ? new Date(`${arg(argv, "start")}T00:00:00Z`) : new Date();
      const slotsFor = tz
        ? (target: "youtube" | "tiktok", days: number) =>
            generateCatchUpSlots({ count: days * p.perDay[target], slotsPerDay: p.perDay[target], windows: DEFAULT_CADENCE.windows, timeZone: tz, startFrom: start })
        : null;
      const draft = draftFromQueue(queue, { weekStart: today, slotsFor, perDay: p.perDay });
      const path = writeJson("batch-backfill", draft);
      console.log(`backfill draft: PASS ${draft.items.length} item(s), ${line}${tz ? "" : "; no TZ_CREATOR, times left empty"} → ${path} (mediaIds still to match; then weekly-batch check/review)`);
    }
  } else {
    console.log("backfill: FAIL usage: backfill snapshot | diff <snapshot.json> | draft <snapshot.json> [--youtube-per-day N] [--tiktok-per-day N] [--start YYYY-MM-DD]");
    process.exitCode = 1;
  }
} catch (err) {
  const path = writeLog("backfill-error", `# backfill ${mode}\n\n${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  console.log(`backfill ${mode}: FAIL ${err instanceof Error ? err.message : err} (details: ${path})`);
  process.exitCode = 1;
}
