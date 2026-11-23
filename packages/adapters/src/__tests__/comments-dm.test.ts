import { describe, expect, it } from "vitest";
import { buildCommentSources, clearYouTubeChannelIdCache, commentCredentialsFromEnv, prepareCommentSources } from "../comments/index.js";
import { createInstagramDmSource } from "../comments/dm-instagram.js";
import { fixture, json, router, type Route } from "./helpers.js";

const cfg = { accessToken: "EAAB-secret", igUserId: "1784" };
const routes: Route[] = [
  [(u, i) => (i?.method ?? "GET") === "GET" && u === "https://graph.facebook.com/v25.0/1784/conversations?platform=instagram&fields=id,participants,updated_time", () => json(fixture("ig-conversations"))],
  [(u, i) => (i?.method ?? "GET") === "GET" && u === "https://graph.facebook.com/v25.0/aWdfZAG06conv1?fields=messages{id,from,to,message,created_time}", () => json(fixture("ig-conversation-messages"))],
];

describe("createInstagramDmSource", () => {
  it("parses threads; direction by IG_USER_ID; messages oldest first; GET only", async () => {
    const r = router(routes);
    const { threads, cursor } = await createInstagramDmSource({ ...cfg, fetch: r.fetch }).fetchThreads(undefined);
    expect(threads).toEqual([
      {
        platformThreadId: "aWdfZAG06conv1",
        participantId: "7001",
        handle: "brand_x",
        messages: [
          { id: "m_1", dir: "in", text: "hi! interested in a collab", at: "2026-11-12T12:00:00.000Z" },
          { id: "m_2", dir: "out", text: "hey, thanks for reaching out", at: "2026-11-12T13:00:00.000Z" },
          { id: "m_3", dir: "in", text: "what is your rate?", at: "2026-11-12T14:00:00.000Z" },
        ],
      },
    ]);
    expect(cursor).toEqual({ since: "2026-11-12T14:00:00.000Z" });
    expect(r.calls.every((c) => c.method === "GET" && c.headers.authorization === "Bearer EAAB-secret" && !c.url.includes("EAAB"))).toBe(true);
  });

  it("skips threads not updated since the cursor (no message fetch)", async () => {
    const r = router(routes);
    const { threads } = await createInstagramDmSource({ ...cfg, fetch: r.fetch }).fetchThreads({ since: "2026-11-13T00:00:00.000Z" });
    expect(threads).toEqual([]);
    expect(r.calls).toHaveLength(1);
  });

  it("is read-only: the only key is fetchThreads (no send path)", () => {
    expect(Object.keys(createInstagramDmSource(cfg))).toEqual(["fetchThreads"]);
  });
});

describe("buildCommentSources / commentCredentialsFromEnv", () => {
  it("builds only what has credentials; YT replies only with YT_COMMENT_REPLIES=1", () => {
    const env = { META_ACCESS_TOKEN: "t", IG_USER_ID: "1784", GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", YT_REFRESH_TOKEN: "c", YT_CHANNEL_ID: "UCours" };
    const off = buildCommentSources(commentCredentialsFromEnv(env));
    expect([...off.keys()].sort()).toEqual(["instagram", "tiktok", "youtube"]);
    expect(off.get("youtube")!.reply).toBeUndefined();
    expect(off.get("youtube")!.hide).toBeUndefined();
    const on = buildCommentSources(commentCredentialsFromEnv({ ...env, YT_COMMENT_REPLIES: "1" }));
    expect(typeof on.get("youtube")!.reply).toBe("function");
    expect(commentCredentialsFromEnv({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" }).youtube).toBeUndefined();
    expect(commentCredentialsFromEnv({}).instagram).toBeUndefined();
  });

  it("TikTok: Zernio keys → the Zernio source (reply, no hide); none → the stub", () => {
    expect(commentCredentialsFromEnv({}).tiktok).toBe(true);
    const creds = commentCredentialsFromEnv({ ZERNIO_API_KEY: "k", ZERNIO_TIKTOK_ACCOUNT_ID: "acct" });
    expect(creds.tiktok).toEqual({ apiKey: "k", accountId: "acct" });
    const tt = buildCommentSources(creds).get("tiktok")!;
    expect(typeof tt.reply).toBe("function");
    expect(tt.hide).toBeUndefined();
    expect(typeof buildCommentSources({ tiktok: true }).get("tiktok")!.hide).toBe("function"); // the stub refuses everything
  });
});

describe("prepareCommentSources: YouTube without YT_CHANNEL_ID", () => {
  const env = { GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", YT_REFRESH_TOKEN: "rtok-prep" };
  const token: Route = [(u) => u === "https://oauth2.googleapis.com/token", () => json(fixture("yt-token"))];
  const channels: Route = [(u) => u === "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true", () => json(fixture("yt-channels-mine"))];

  it("resolves the channel with channels.list?part=id&mine=true once per process and polls with it", async () => {
    clearYouTubeChannelIdCache();
    const r = router([token, channels, [(u) => u.includes("/commentThreads?"), () => json({ items: [] })]]);
    const lines: string[] = [];
    const creds = { ...commentCredentialsFromEnv(env), fetch: r.fetch };
    expect(creds.youtube?.channelId).toBeUndefined();
    expect(buildCommentSources(creds).has("youtube")).toBe(false); // the sync builder can't resolve
    const sources = await prepareCommentSources(creds, (l) => lines.push(l));
    expect(sources.has("youtube")).toBe(true);
    await sources.get("youtube")!.fetchRecent(undefined);
    expect(r.calls.find((c) => c.url.includes("/commentThreads?"))!.url).toContain("allThreadsRelatedToChannelId=UCfakeChannelId000000000");
    expect(lines).toEqual(["[engage] youtube comments: channel id resolved from the OAuth account (set YT_CHANNEL_ID to skip this lookup)"]);
    await prepareCommentSources(creds, () => {});
    expect(r.calls.filter((c) => c.url.includes("/channels?"))).toHaveLength(1); // cached
  });

  it("lookup fails → one log line, YouTube skipped, the others still built; no secrets in the line", async () => {
    clearYouTubeChannelIdCache();
    const r = router([[(u) => u === "https://oauth2.googleapis.com/token", () => json(fixture("yt-invalid-grant"), 400)]]);
    const lines: string[] = [];
    const sources = await prepareCommentSources({ ...commentCredentialsFromEnv({ ...env, META_ACCESS_TOKEN: "t", IG_USER_ID: "1784" }), fetch: r.fetch }, (l) => lines.push(l));
    expect([...sources.keys()].sort()).toEqual(["instagram", "tiktok"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[engage\] youtube comments skipped: channel lookup failed \(/);
    expect(lines[0]).not.toContain("rtok-prep");
  });

  it("no channel on the account → skipped", async () => {
    clearYouTubeChannelIdCache();
    const r = router([token, [(u) => u.includes("/channels?"), () => json({ items: [] })]]);
    const lines: string[] = [];
    const sources = await prepareCommentSources({ ...commentCredentialsFromEnv(env), fetch: r.fetch }, (l) => lines.push(l));
    expect(sources.has("youtube")).toBe(false);
    expect(lines[0]).toContain("no channel");
  });

  it("YT_CHANNEL_ID set → no lookup at all", async () => {
    const r = router([]);
    const sources = await prepareCommentSources({ ...commentCredentialsFromEnv({ ...env, YT_CHANNEL_ID: "UCours" }), fetch: r.fetch }, () => {});
    expect(sources.has("youtube")).toBe(true);
    expect(r.calls).toEqual([]);
  });
});
