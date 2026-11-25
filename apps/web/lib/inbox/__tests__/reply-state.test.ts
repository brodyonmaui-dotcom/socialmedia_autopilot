// The Inbox shows the true reply state from the row (not just "queued"), and the test-reply button copy.
import { describe, expect, it } from "vitest";
import type { InboxListRow } from "../list.js";
import { canTestReply, cardPlan, itemPlan, replyLink, replyStateView, resultNotice, testReplyConfirm, TEST_REPLY_TEXT } from "../view.js";
import { queuedMessage } from "../item.js";
import type { PlatformReplyStatus } from "@autopilot/engagement/src/status.js";

const row = (p: Partial<InboxListRow> = {}): InboxListRow => ({
  kind: "comment", id: "00000000-0000-4000-8000-000000000001", platform: "tiktok", authorName: "@fan", authorHandle: "fan", at: "2026-11-25T10:00:00.000Z", age: "2 h ago",
  text: "fire", bucket: "simple_positive", reason: null, draftedReply: "thanks!", replyStatus: "planned", href: "/inbox/item/x", actions: ["open"], ...p,
});

describe("reply state", () => {
  it("planned with a reason: Waiting (warn) + the reason in plain words", () => {
    const v = replyStateView({ status: "planned", lastError: "YouTube replies are switched off on the server (YT_COMMENT_REPLIES=1 needed)" });
    expect(v.status).toEqual({ label: "Waiting", tone: "warn" });
    expect(v.note).toBe("Waiting: YouTube replies are switched off on the server (YT_COMMENT_REPLIES=1 needed)");
    expect(cardPlan(row({ replyLastError: "Worker is in dry run (it sends only with DRY_RUN=false and the live start)" }), "sent")).toMatchObject({
      status: { label: "Waiting", tone: "warn" },
      note: expect.stringMatching(/^Waiting: Worker is in dry run/),
    });
  });
  it("planned without a reason: Sending; sent: Sent ✓ <time> with a link; failed: Failed: <why>", () => {
    expect(replyStateView({ status: "planned", lastError: null }).status?.label).toBe("Sending");
    const sent = replyStateView({ status: "sent", lastError: "old reason", sentAgo: "3 min ago", url: "https://www.youtube.com/watch?v=abc&lc=r1" });
    expect(sent.status).toEqual({ label: "Sent ✓ 3 min ago", tone: "accent" });
    expect(sent.link).toEqual({ href: "https://www.youtube.com/watch?v=abc&lc=r1", label: "See it on the platform" });
    expect(sent.note).toBeNull();
    expect(replyStateView({ status: "failed", lastError: "HTTP 403" })).toMatchObject({ status: { tone: "danger" }, note: "Failed: HTTP 403" });
    expect(cardPlan(row({ replyStatus: "sent", replySentAgo: "just now", replyUrl: "https://www.tiktok.com/@c/video/1" }), "sent")).toMatchObject({
      status: { label: "Sent ✓ just now" },
      link: { href: "https://www.tiktok.com/@c/video/1" },
    });
  });
  it("item page uses the row too", () => {
    const T = { bucket: "flag" as const, reasons: [], confidence: null, model: null, decidedAt: "", handledAt: "x", notSpamAt: null };
    const reply = { actionId: "a", status: "planned" as const, origin: "manual" as const, text: "👍", sentAt: null, lastError: "TikTok thread couldn't be read: HTTP 404" };
    expect(itemPlan({ platform: "tiktok", state: "queued", draftedReply: "👍", triage: T, reply, isOwn: false })).toMatchObject({
      primary: "none",
      status: { label: "Waiting", tone: "warn" },
      note: "Waiting: TikTok thread couldn't be read: HTTP 404",
    });
  });
  it("links: YouTube straight to the reply; others the stored post URL; nothing unsafe", () => {
    expect(replyLink("youtube", null, "dQw4w9WgXcQ", "UgxReply.1")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&lc=UgxReply.1");
    expect(replyLink("tiktok", "https://www.tiktok.com/@c/video/7301", "7301", "7301:1:2")).toBe("https://www.tiktok.com/@c/video/7301");
    expect(replyLink("instagram", "javascript:alert(1)", null, "x")).toBeNull();
    expect(replyLink("tiktok", null, "7301", "7301:1:2")).toBeNull();
  });
});

describe("approve message from the worker's engagement_status", () => {
  const ready: PlatformReplyStatus = { source: true, canReply: true, live: true, killed: false, lastSentAt: null, lastHeldReason: null, lastError: null };
  it("worker live and able: queued, even when the WEB env says dry run", () => {
    expect(queuedMessage("tiktok", ready, true, false)).toEqual({ dryRun: false, message: expect.stringMatching(/^queued:/) });
  });
  it("worker in dry run: dry run, even when the web env says live", () => {
    expect(queuedMessage("tiktok", { ...ready, live: false }, false, false)).toMatchObject({ dryRun: true, message: expect.stringMatching(/^dry run: the worker is in dry run/) });
  });
  it("worker can't reply: waiting + what's missing (shown as a warning)", () => {
    const m = queuedMessage("youtube", { ...ready, canReply: false, replyUnavailableReason: "YouTube replies are switched off on the server (YT_COMMENT_REPLIES=1 needed)" }, false, false);
    expect(m.message).toBe("waiting: YouTube replies are switched off on the server (YT_COMMENT_REPLIES=1 needed)");
    expect(resultNotice({ note: m.message })).toEqual({ tone: "warn", text: "Approved, but it can't go out yet: YouTube replies are switched off on the server (YT_COMMENT_REPLIES=1 needed). It sends once that's fixed." });
  });
  it("no report yet: falls back to the web env", () => {
    expect(queuedMessage("tiktok", null, true, false).message).toMatch(/^dry run/);
    expect(queuedMessage("tiktok", null, false, false).message).toMatch(/^queued/);
    expect(queuedMessage("tiktok", ready, true, true).message).toBe("already queued");
  });
});

describe("test reply (👍)", () => {
  it("only where the creator can still approve and the platform can reply", () => {
    expect(canTestReply({ primary: "approve" }, true)).toBe(true);
    expect(canTestReply({ primary: "write" }, true)).toBe(true);
    expect(canTestReply({ primary: "approve" }, false)).toBe(false);
    expect(canTestReply({ primary: "approve" }, undefined)).toBe(false);
    expect(canTestReply({ primary: "none" }, true)).toBe(false);
  });
  it("confirm copy names the person and the platform", () => {
    expect(TEST_REPLY_TEXT).toBe("👍");
    expect(testReplyConfirm("tiktok", "@fan")).toBe("This posts 👍 as a public reply to @fan on TikTok. Use it once to prove replies work.");
  });
});
