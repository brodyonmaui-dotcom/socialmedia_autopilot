import { NonRetryableError } from "@autopilot/core";
import { describe, expect, it } from "vitest";
import { createTikTokCommentSource } from "../comments/tiktok.js";

describe("createTikTokCommentSource", () => {
  it("fetchRecent returns nothing and keeps the cursor (a poll never errors)", async () => {
    await expect(createTikTokCommentSource().fetchRecent({ since: "x" })).resolves.toEqual({ comments: [], cursor: { since: "x" } });
  });
  it("reply, hide and fetchThread throw NonRetryableError", async () => {
    const src = createTikTokCommentSource();
    await expect(src.reply!("c1", "hi", { idempotencyKey: "k" })).rejects.toBeInstanceOf(NonRetryableError);
    await expect(src.reply!("c1", "hi", { idempotencyKey: "k" })).rejects.toThrow("tiktok comments disabled: free Zernio plan; replies are manual");
    await expect(src.hide!("c1")).rejects.toBeInstanceOf(NonRetryableError);
    await expect(src.fetchThread("c1")).rejects.toBeInstanceOf(NonRetryableError);
  });
});
