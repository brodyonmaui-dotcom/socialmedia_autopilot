// Instagram probe (Facebook Login token, graph.facebook.com; falls back to Instagram Login on graph.instagram.com).
// Read-only by default. Real trial-reel post only with:  DRY_RUN=false pnpm probe:ig --live --video-url=https://... --caption="..."
// Optional: --creator=<public pro username> to test Business Discovery.
import { LIVE, argValue, getJson, need, record, sleep, startLog, summary } from "./lib.js";

startLog("ig");
const { META_ACCESS_TOKEN } = need("META_ACCESS_TOKEN");
const isIgLogin = META_ACCESS_TOKEN.startsWith("IG");
const ver = process.env.META_GRAPH_VERSION ? `/${process.env.META_GRAPH_VERSION}` : "";
const host = isIgLogin ? "https://graph.instagram.com" : "https://graph.facebook.com";
const api = (path: string) => `${host}${ver}${path}`;
const auth = { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` } };
record("token_type", true, isIgLogin ? "Instagram Login (no Business Discovery)" : "Facebook Login");

// 1. Find the IG professional account (IG_USER_ID from connect-meta, else discover via the user token)
let igId = process.env.IG_USER_ID ?? "";
if (isIgLogin) {
  const r = await getJson(api("/me?fields=user_id,username,account_type,followers_count,media_count"), auth);
  igId ||= r.body?.user_id ?? r.body?.id ?? "";
  record("account", r.status === 200, r.status === 200 ? `@${r.body.username} · ${r.body.followers_count} followers · ${r.body.account_type}` : JSON.stringify(r.body?.error?.message));
} else {
  if (!igId) {
    const r = await getJson(api("/me/accounts?fields=name,instagram_business_account{id}"), auth);
    igId = (r.body?.data ?? []).find((p: any) => p.instagram_business_account)?.instagram_business_account?.id ?? "";
  }
  const a = igId ? await getJson(api(`/${igId}?fields=username,followers_count,media_count`), auth) : { status: 0, body: {} as any };
  record("account", a.status === 200, a.status === 200 ? `@${a.body.username} · ${a.body.followers_count} followers · ${a.body.media_count} posts` : `no IG account (${a.body?.error?.message ?? "run connect-meta"})`);
  // Scopes via debug_token on the user token (page tokens inherit them)
  const { META_APP_ID, META_APP_SECRET, META_USER_TOKEN } = process.env;
  if (META_APP_ID && META_APP_SECRET && META_USER_TOKEN) {
    const d = await getJson(api(`/debug_token?input_token=${encodeURIComponent(META_USER_TOKEN)}&access_token=${encodeURIComponent(`${META_APP_ID}|${META_APP_SECRET}`)}`));
    const granted: string[] = d.body?.data?.scopes ?? [];
    const wanted = ["instagram_basic", "instagram_content_publish", "instagram_manage_comments", "instagram_manage_insights", "instagram_manage_messages", "pages_show_list", "pages_read_engagement"];
    const missing = wanted.filter((w) => !granted.includes(w));
    record("scopes", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : `all ${wanted.length} present`);
  }
}
if (!igId) summary("ig");

// 2. Publishing quota
const q = await getJson(api(`/${igId}/content_publishing_limit?fields=config,quota_usage`), auth);
const ql = q.body?.data?.[0];
record("publish_quota", q.status === 200, ql ? `${ql.quota_usage}/${ql.config?.quota_total} used in 24h` : JSON.stringify(q.body?.error?.message));

// 3. Recent media + comments in one call (the polling design for comments)
const m = await getJson(api(`/${igId}/media?fields=id,media_type,media_product_type,timestamp,comments_count,like_count,comments.limit(3){id,text,username,timestamp}&limit=5`), auth);
const media: any[] = m.body?.data ?? [];
record("media_and_comments_poll", m.status === 200, `${media.length} recent posts, ${media.reduce((n, x) => n + (x.comments?.data?.length ?? 0), 0)} comments fetched in 1 call`);

// 3b. Comment shape for engagement (F3): which author fields come back in Development mode. Read-only; prints counts only, never text or names.
const cs = await getJson(api(`/${igId}/media?fields=id,comments.limit(25){id,timestamp,parent_id,hidden,from,username,replies{id,from,username}}&limit=10`), auth);
const comments: any[] = (cs.body?.data ?? []).flatMap((x: any) => x.comments?.data ?? []);
const replies: any[] = comments.flatMap((c) => c.replies?.data ?? []);
const share = (arr: any[], f: (c: any) => unknown) => `${arr.filter(f).length}/${arr.length}`;
record("comment_fields", cs.status === 200, cs.status === 200
  ? `top-level ${comments.length}: from.id ${share(comments, (c) => c.from?.id)} · username ${share(comments, (c) => c.username || c.from?.username)} · hidden field ${share(comments, (c) => typeof c.hidden === "boolean")} | replies ${replies.length}: from.id ${share(replies, (c) => c.from?.id)}`
  : JSON.stringify(cs.body?.error?.message));

// 3c. DM read access for drafts (F3): list conversations only (no message text). Read-only.
if (!isIgLogin) {
  const dm = await getJson(api(`/me/conversations?platform=instagram&fields=id,updated_time&limit=3`), auth);
  record("dm_read", dm.status === 200, dm.status === 200 ? `${dm.body?.data?.length ?? 0} recent conversations readable` : `HTTP ${dm.status} code ${dm.body?.error?.code ?? "?"}: ${dm.body?.error?.message ?? ""}`);
}

// 4. Reel insights: which metric names this API version accepts
const reel = media.find((x) => x.media_product_type === "REELS");
if (reel) {
  const metrics = ["views", "reach", "saved", "shares", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time", "reels_skip_rate", "reposts", "follows", "profile_visits"];
  const ok: string[] = [];
  const bad: string[] = [];
  for (const metric of metrics) {
    const r = await getJson(api(`/${reel.id}/insights?metric=${metric}`), auth);
    (r.status === 200 ? ok : bad).push(metric);
  }
  record("reel_insights", ok.length > 0, `ok: ${ok.join(",")} | rejected: ${bad.join(",") || "none"}`);
} else record("reel_insights", true, "no reel in last 5 posts — skipped");

// 5. Business Discovery (Facebook Login only)
const creator = argValue("creator");
if (creator && !isIgLogin) {
  const r = await getJson(api(`/${igId}?fields=business_discovery.username(${encodeURIComponent(creator)}){followers_count,media_count,media.limit(3){timestamp,like_count,comments_count,view_count}}`), auth);
  const bd = r.body?.business_discovery;
  record("business_discovery", !!bd, bd ? `@${creator}: ${bd.followers_count} followers, ${bd.media?.data?.length ?? 0} posts read` : JSON.stringify(r.body?.error?.message));
}

// 6. Trial reel (LIVE only), with the decided fallback: refused trial -> plain reel + flag.
// Ineligible accounts are expected to refuse the trial; that refusal is the fallback signal, not a failure.
const videoUrl = argValue("video-url");
if (videoUrl) {
  if (!LIVE) {
    record("trial_reel", true, "dry-run: would create REELS container with trial_params.graduation_strategy=MANUAL, falling back to a plain reel if refused (add --live and DRY_RUN=false)");
  } else {
    const baseFields = {
      media_type: "REELS",
      video_url: videoUrl,
      caption: argValue("caption") ?? "",
      share_to_feed: "true",
    };
    let containerId: string | undefined;
    let fellBack = false;

    const trial = await getJson(api(`/${igId}/media`), {
      method: "POST",
      body: new URLSearchParams({ ...baseFields, trial_params: JSON.stringify({ graduation_strategy: "MANUAL" }) }),
      ...auth,
    });
    containerId = trial.body?.id;
    record("trial_container", !!containerId, containerId ? `container ${containerId}` : `refused: ${trial.body?.error?.message} (code ${trial.body?.error?.code}/${trial.body?.error?.error_subcode})`);

    if (!containerId) {
      // Decided fallback (decisions.md #5): ineligible for trials -> post as a regular reel, and flag it.
      const plain = await getJson(api(`/${igId}/media`), { method: "POST", body: new URLSearchParams(baseFields), ...auth });
      containerId = plain.body?.id;
      fellBack = true;
      record("fallback_reel_container", !!containerId, containerId ? `container ${containerId} (FLAG: posted as a regular reel, not a trial)` : `rejected: ${plain.body?.error?.message}`);
    }

    if (containerId) {
      let status = "IN_PROGRESS";
      for (let i = 0; i < 10 && status === "IN_PROGRESS"; i++) {
        await sleep(30_000);
        const s = await getJson(api(`/${containerId}?fields=status_code,status`), auth);
        status = s.body?.status_code ?? "ERROR";
      }
      record("container_status", status === "FINISHED", status);
      if (status === "FINISHED") {
        const p = await getJson(api(`/${igId}/media_publish`), { method: "POST", body: new URLSearchParams({ creation_id: containerId }), ...auth });
        record("publish", !!p.body?.id, p.body?.id ? `media ${p.body.id}${fellBack ? " (FLAG: regular reel, trial refused)" : " (trial, MANUAL)"}` : `publish rejected: ${p.body?.error?.message}`);
      }
    }
  }
}
summary("ig");
