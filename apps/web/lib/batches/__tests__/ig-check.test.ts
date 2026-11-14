import { describe, expect, it, vi } from "vitest";
import { checkInstagram } from "../ig-check.js";

const ig = {
  id: "00000000-0000-4000-8000-000000000001",
  platform: "instagram" as const,
  caption: "a caption",
  scheduledFor: "2099-01-06T10:00:00.000Z",
  status: "failed" as const,
  attempts: 4,
};

describe("checkInstagram", () => {
  it("non-IG items are n/a and never call an adapter", async () => {
    const findExisting = vi.fn();
    expect(await checkInstagram({ ...ig, platform: "youtube" }, { adapter: { findExisting } })).toEqual({ result: "n/a" });
    expect(await checkInstagram({ ...ig, platform: "tiktok" }, { adapter: { findExisting } })).toEqual({ result: "n/a" });
    expect(findExisting).not.toHaveBeenCalled();
  });

  it("no IG credentials → error (env without the token)", async () => {
    expect(await checkInstagram(ig, { env: {} })).toEqual({ result: "error" });
    expect(await checkInstagram(ig, { adapter: null })).toEqual({ result: "error" });
  });

  it("adapter throws → error, logged without the raw token", async () => {
    const lines: string[] = [];
    const findExisting = vi.fn().mockRejectedValue(new Error("GET https://graph.example/media?access_token=EAAsecret123456789 failed"));
    expect(await checkInstagram(ig, { adapter: { findExisting }, log: (l) => lines.push(l) })).toEqual({ result: "error" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("EAAsecret123456789");
  });

  it("no time or empty caption → error (a miss would mean nothing)", async () => {
    const findExisting = vi.fn().mockResolvedValue(null);
    expect(await checkInstagram({ ...ig, scheduledFor: null }, { adapter: { findExisting } })).toEqual({ result: "error" });
    expect(await checkInstagram({ ...ig, caption: "  " }, { adapter: { findExisting } })).toEqual({ result: "error" });
    expect(findExisting).not.toHaveBeenCalled();
  });

  it("miss → not-found; hit → found with the permalink", async () => {
    expect(await checkInstagram(ig, { adapter: { findExisting: vi.fn().mockResolvedValue(null) } })).toEqual({ result: "not-found" });
    const findExisting = vi.fn().mockResolvedValue({ platformPostId: "1789", platformPostUrl: "https://www.instagram.com/reel/abc/" });
    expect(await checkInstagram(ig, { adapter: { findExisting } })).toEqual({ result: "found", url: "https://www.instagram.com/reel/abc/", platformPostId: "1789" });
    const [post, opts] = findExisting.mock.calls[0]!;
    expect(post).toMatchObject({ caption: "a caption", scheduledFor: ig.scheduledFor, platform: "instagram" });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});
