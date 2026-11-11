import { afterEach, describe, expect, it, vi } from "vitest";
import { createYouTubeAdapter } from "../youtube.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init, headers: { "content-type": "application/json", ...init.headers } });
}

afterEach(() => vi.unstubAllGlobals());

describe("createYouTubeAdapter", () => {
  it("refreshes the token, uploads private+publishAt, and returns the watch URL", async () => {
    const calls: string[] = [];
    const fakeFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "fake-access-token" });
      }
      if (u.includes("/upload/youtube/v3/videos")) {
        expect(JSON.parse(init!.body as string).status.publishAt).toBe("2026-12-01T09:00:00Z");
        return new Response("", { status: 200, headers: { location: "https://upload.example/session123" } });
      }
      if (u === "https://media.example/clip.mp4") {
        return new Response("fake-bytes", { status: 200, headers: { "content-length": "10" } });
      }
      if (u === "https://upload.example/session123") {
        return jsonResponse({ id: "abc123" });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fakeFetch);

    const adapter = createYouTubeAdapter({ clientId: "id", clientSecret: "secret", refreshToken: "refresh" });
    const result = await adapter.publish({
      id: "1",
      idempotencyKey: "key-1",
      platform: "youtube",
      mediaUrl: "https://media.example/clip.mp4",
      caption: "desc",
      title: "A title",
      scheduledFor: "2026-12-01T09:00:00Z",
      status: "approved",
      attempts: 0,
    });

    expect(result).toEqual({ platformPostId: "abc123", platformPostUrl: "https://www.youtube.com/watch?v=abc123" });
    expect(calls[0]).toContain("oauth2.googleapis.com/token");
  });

  it("throws with the reason when the upload is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "t" });
        if (u.includes("/upload/youtube/v3/videos")) return new Response("", { status: 200, headers: { location: "https://upload.example/s" } });
        if (u === "https://media.example/clip.mp4") return new Response("x", { status: 200 });
        return jsonResponse({ error: { message: "quota exceeded" } }, { status: 403 });
      }),
    );
    const adapter = createYouTubeAdapter({ clientId: "id", clientSecret: "secret", refreshToken: "refresh" });
    await expect(
      adapter.publish({
        id: "1",
        idempotencyKey: "key-1",
        platform: "youtube",
        mediaUrl: "https://media.example/clip.mp4",
        caption: "desc",
        scheduledFor: "2026-12-01T09:00:00Z",
        status: "approved",
        attempts: 0,
      }),
    ).rejects.toThrow(/quota exceeded/);
  });
});
