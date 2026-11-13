import { describe, expect, it } from "vitest";
import { buildCommentSources, commentCredentialsFromEnv } from "../comments/index.js";
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
    expect(commentCredentialsFromEnv({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", YT_REFRESH_TOKEN: "c" }).youtube).toBeUndefined();
    expect(commentCredentialsFromEnv({}).instagram).toBeUndefined();
  });
});
