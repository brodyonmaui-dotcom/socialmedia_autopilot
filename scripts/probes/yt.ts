// YouTube probe.
//   pnpm probe:yt --auth            one-time OAuth; writes .secrets/yt.json (gitignored). Run on the laptop.
//   pnpm probe:yt                   read-only: channel, quota-cheap calls
//   DRY_RUN=false pnpm probe:yt --live --file=clip.mp4 [--publish-at=2026-11-12T19:00:00Z] [--title="..."]
//                                   uploads PRIVATE; with --publish-at YouTube publishes it at that time.
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { LIVE, args, argValue, getJson, need, record, startLog, summary } from "./lib.js";

startLog("yt");
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = need("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl", // comments read/reply/moderate
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];
const PORT = 8765;
const redirect = `http://127.0.0.1:${PORT}`;

if (args.has("--auth")) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent" }).toString();
  console.log(`Open this URL, approve, then come back:\n${url}\n`);
  const code = await new Promise<string>((resolve) => {
    // Same machine: the browser redirect lands here. Other machine: paste the address-bar URL into this terminal (not into chat).
    const srv = createServer((req, res) => {
      const c = new URL(req.url ?? "/", redirect).searchParams.get("code");
      res.end(c ? "Done — you can close this tab." : "No code in URL.");
      if (c) { srv.close(); resolve(c); }
    }).listen(PORT);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question("…or paste the full redirected URL here: ").then((line) => {
      const c = new URL(line.trim()).searchParams.get("code");
      if (c) { rl.close(); srv.close(); resolve(c); }
    });
  });
  const t = await getJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  if (t.body?.refresh_token) {
    mkdirSync(".secrets", { recursive: true });
    writeFileSync(".secrets/yt.json", JSON.stringify({ refresh_token: t.body.refresh_token, scope: t.body.scope }, null, 2));
    chmodSync(".secrets/yt.json", 0o600);
  }
  record("oauth", !!t.body?.refresh_token, t.body?.refresh_token ? "refresh token saved to .secrets/yt.json — copy it into YT_REFRESH_TOKEN in .env (VPS too)" : `no refresh token: ${JSON.stringify(t.body?.error_description ?? t.body)}`);
  summary("yt");
}

const refresh = process.env.YT_REFRESH_TOKEN || (existsSync(".secrets/yt.json") ? JSON.parse(readFileSync(".secrets/yt.json", "utf8")).refresh_token : "");
if (!refresh) { console.log("SKIP no YT_REFRESH_TOKEN — run: pnpm probe:yt --auth"); process.exit(2); }
const tok = await getJson("https://oauth2.googleapis.com/token", {
  method: "POST",
  body: new URLSearchParams({ refresh_token: refresh, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, grant_type: "refresh_token" }),
});
const access = tok.body?.access_token;
record("token_refresh", !!access, access ? `ok, expires in ${tok.body.expires_in}s` : JSON.stringify(tok.body?.error_description ?? tok.body?.error));
const granted = String(tok.body?.scope ?? "").split(/\s+/).filter(Boolean).map((u) => u.replace("https://www.googleapis.com/auth/", ""));
if (access) record("scopes", granted.includes("youtube.force-ssl"), `granted: ${granted.join(", ") || "(not reported)"}${granted.includes("youtube.force-ssl") ? "" : " · comment replies need youtube.force-ssl (re-run --auth and tick every box)"}`);
if (!access) summary("yt");
const auth = { Authorization: `Bearer ${access}` };

const ch = await getJson("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,status&mine=true", { headers: auth });
const c = ch.body?.items?.[0];
record("channel", !!c, c ? `${c.snippet.title} · ${c.statistics.subscriberCount} subs · ${c.statistics.videoCount} videos` : JSON.stringify(ch.body?.error?.message));
if (c) {
  // Comment polling for engagement (F3): 1 quota unit, read-only; prints counts only, never text or names.
  const ct = await getJson(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&allThreadsRelatedToChannelId=${c.id}&maxResults=20`, { headers: auth });
  const threads: any[] = ct.body?.items ?? [];
  record("comment_threads", ct.status === 200, ct.status === 200 ? `${threads.length} recent threads · authorChannelId on ${threads.filter((t) => t.snippet?.topLevelComment?.snippet?.authorChannelId?.value).length}/${threads.length}` : `HTTP ${ct.status} ${JSON.stringify(ct.body?.error?.errors?.[0]?.reason ?? ct.body?.error?.message)}`);
}

const file = argValue("file");
if (file) {
  const publishAt = argValue("publish-at");
  const meta = {
    snippet: { title: argValue("title") ?? "probe upload", description: argValue("description") ?? "", categoryId: "22" },
    status: { privacyStatus: "private", selfDeclaredMadeForKids: false, ...(publishAt ? { publishAt } : {}) },
  };
  if (!LIVE) {
    record("upload", true, `dry-run: would upload ${file} (${(statSync(file).size / 1e6).toFixed(1)} MB) private${publishAt ? `, publishAt ${publishAt}` : ""}`);
  } else {
    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json", "X-Upload-Content-Type": "video/*" },
      body: JSON.stringify(meta),
    });
    const loc = init.headers.get("location");
    if (!loc) { record("upload_init", false, `HTTP ${init.status} ${await init.text()}`); summary("yt"); }
    const up = await getJson(loc, { method: "PUT", headers: { "Content-Type": "video/*" }, body: readFileSync(file) });
    record("upload", up.status === 200, up.status === 200 ? `video ${up.body.id} · privacy=${up.body.status?.privacyStatus} · publishAt=${up.body.status?.publishAt ?? "none"}` : `HTTP ${up.status} ${JSON.stringify(up.body?.error?.errors?.[0]?.reason ?? up.body?.error?.message)}`);
  }
}
summary("yt");
