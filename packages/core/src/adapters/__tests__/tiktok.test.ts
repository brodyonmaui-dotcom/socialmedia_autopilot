import { afterEach, describe, expect, it, vi } from "vitest";
import { createTikTokAdapter } from "../tiktok.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

const samplePost = {
  id: "1",
  idempotencyKey: "idem-1",
  platform: "tiktok" as const,
  mediaUrl: "https://media.example/clip.mp4",
  caption: "caption #gym",
  scheduledFor: "2026-12-01T09:00:00Z",
  status: "approved" as const,
  attempts: 0,
};

describe("createTikTokAdapter", () => {
  it("sends scheduledFor/timezone at the top level and the Idempotency-Key header", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let capturedHeaders: HeadersInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(init!.body as string);
        capturedHeaders = init!.headers;
        return jsonResponse({
          post: { platforms: [{ status: "scheduled", platformPostId: "tt123", platformPostUrl: "https://www.tiktok.com/@x/video/tt123" }] },
        });
      }),
    );

    const adapter = createTikTokAdapter({ apiKey: "key", accountId: "acct1" });
    const result = await adapter.publish(samplePost);

    expect(result).toEqual({ platformPostId: "tt123", platformPostUrl: "https://www.tiktok.com/@x/video/tt123" });
    expect(capturedBody?.scheduledFor).toBe("2026-12-01T09:00:00Z");
    expect(capturedBody?.timezone).toBe("UTC");
    expect((capturedBody?.platforms as unknown[])[0]).not.toHaveProperty("scheduledFor");
    expect((capturedHeaders as Record<string, string>)["Idempotency-Key"]).toBe("idem-1");
  });

  it("throws with the platform's rejection reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ post: { platforms: [{ status: "failed", reason: "unaudited_client_can_only_post_to_private_accounts" }] } })),
    );
    const adapter = createTikTokAdapter({ apiKey: "key", accountId: "acct1" });
    await expect(adapter.publish(samplePost)).rejects.toThrow(/unaudited_client/);
  });
});
