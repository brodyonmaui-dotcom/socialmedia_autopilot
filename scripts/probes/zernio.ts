// TikTok-through-Zernio probe. Read-only + Zernio's own dryRun by default.
// Real post: DRY_RUN=false pnpm probe:tiktok --live --video-url=https://... --caption="..." [--draft]
// --draft sends to the TikTok inbox (finish in-app, e.g. to add a trending sound).
import { randomUUID } from "node:crypto";
import { LIVE, args, argValue, getJson, need, record, startLog, summary } from "./lib.js";

startLog("tiktok");
const { ZERNIO_API_KEY } = need("ZERNIO_API_KEY");
const base = "https://zernio.com/api/v1";
const auth = { Authorization: `Bearer ${ZERNIO_API_KEY}` };

const a = await getJson(`${base}/accounts`, { headers: auth });
const accounts: any[] = a.body?.accounts ?? a.body?.data ?? (Array.isArray(a.body) ? a.body : []);
const tt = accounts.find((x) => x.platform === "tiktok" && (!process.env.ZERNIO_TIKTOK_ACCOUNT_ID || (x._id ?? x.id) === process.env.ZERNIO_TIKTOK_ACCOUNT_ID));
const accountId = tt?._id ?? tt?.id;
record("accounts", a.status === 200, `${accounts.length} connected; tiktok: ${tt ? `@${tt.username ?? tt.displayName ?? "?"} ZERNIO_TIKTOK_ACCOUNT_ID=${accountId}` : "none — connect it in the Zernio dashboard"}`);
if (!accountId) summary("tiktok");

const ci = await getJson(`${base}/accounts/${accountId}/tiktok/creator-info?mediaType=video`, { headers: auth });
const levels = (ci.body?.privacyLevels ?? ci.body?.privacy_level_options ?? []).map((l: any) => l.value ?? l);
record("creator_info", ci.status === 200, `privacy levels: ${levels.join(",") || "?"} · canPostMore=${ci.body?.creator?.canPostMore}`);

const videoUrl = argValue("video-url") ?? "https://example.com/probe.mp4";
const draft = args.has("--draft");
const body = {
  content: argValue("caption") ?? "",
  mediaItems: [{ type: "video", url: videoUrl }],
  platforms: [
    {
      platform: "tiktok",
      accountId,
      platformSpecificData: {
        tiktokSettings: {
          privacy_level: "PUBLIC_TO_EVERYONE",
          allow_comment: true,
          allow_duet: false,
          allow_stitch: false,
          content_preview_confirmed: true,
          express_consent_given: true,
          ...(draft ? { draft: true } : {}),
        },
      },
    },
  ],
};

if (!LIVE) {
  const d = await getJson(`${base}/posts`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, dryRun: true }) });
  record("dry_run", d.status === 200, `canPublish=${d.body?.canPublish} ${JSON.stringify(d.body?.tiktok?.[0]?.reason ?? "")}`);
} else {
  const key = randomUUID(); // one logical post = one key; reuse on retry
  const p = await getJson(`${base}/posts`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ ...body, publishNow: true }),
  });
  const plat = p.body?.post?.platforms?.[0] ?? p.body?.platforms?.[0];
  record("publish", p.status < 300, `HTTP ${p.status} status=${plat?.status} url=${plat?.platformPostUrl ?? "(none yet)"} idempotency=${key}`);
  record("verify_public", true, "MANUAL: open the URL logged-out (private window) and confirm it plays");
}
summary("tiktok");
