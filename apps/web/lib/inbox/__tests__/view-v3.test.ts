import { describe, expect, it } from "vitest";
import type { InboxListRow } from "../list.js";
import {
  cardPlan,
  dmWindowText,
  emptyFor,
  filterOptions,
  inboxHref,
  itemPlan,
  kindTabs,
  parseFilter,
  promoReasonText,
  reasonChip,
  replyStatusSentence,
  resultNotice,
  returnTab,
} from "../view.js";

const COUNTS = { "needs-you": 15, drafted: 18, sent: 3, ignored: 8 };

function row(p: Partial<InboxListRow> = {}): InboxListRow {
  return {
    kind: "comment",
    id: "00000000-0000-4000-8000-000000000001",
    platform: "instagram",
    authorName: "@gym_fan_22",
    authorHandle: "gym_fan_22",
    at: "2026-11-16T10:00:00.000Z",
    age: "2 h ago",
    text: "what's your split?",
    bucket: "flag",
    reason: "question",
    draftedReply: null,
    replyStatus: null,
    href: "/inbox/item/00000000-0000-4000-8000-000000000001",
    actions: ["open", "reply", "done", "ignore-account"],
    ...p,
  };
}

describe("filters and URLs", () => {
  it("reads ?filter= and the legacy ?tab= the actions redirect to", () => {
    expect(parseFilter({})).toBe("needs-you");
    expect(parseFilter({ filter: "ignored" })).toBe("ignored");
    expect(parseFilter({ filter: "nope" })).toBe("needs-you");
    expect(parseFilter({ tab: "shadow" })).toBe("drafted");
    expect(parseFilter({ tab: "sent" })).toBe("sent");
    expect(parseFilter({ tab: "flagged" })).toBe("needs-you");
    expect(parseFilter({ filter: "sent", tab: "shadow" })).toBe("sent");
  });

  it("builds hrefs per kind with an optional cursor", () => {
    expect(inboxHref("comments", "needs-you")).toBe("/inbox");
    expect(inboxHref("comments", "drafted")).toBe("/inbox?filter=drafted");
    expect(inboxHref("dms", "needs-you")).toBe("/inbox/dms");
    expect(inboxHref("dms", "ignored", "a|b")).toBe("/inbox/dms?filter=ignored&cursor=a%7Cb");
  });

  it("names the hidden tab field the actions understand", () => {
    expect(returnTab("comments", "needs-you")).toBe("flagged");
    expect(returnTab("comments", "drafted")).toBe("shadow");
    expect(returnTab("comments", "sent")).toBe("sent");
    expect(returnTab("comments", "ignored")).toBe("flagged");
    expect(returnTab("dms", "drafted")).toBe("dms");
  });

  it("dropdown options carry counts and mark the current one", () => {
    const o = filterOptions("comments", COUNTS, "drafted");
    expect(o.map((x) => x.label)).toEqual(["Needs you · 15", "Drafted · 18", "Sent · 3", "Ignored · 8"]);
    expect(o.find((x) => x.current)?.href).toBe("/inbox?filter=drafted");
    expect(o.filter((x) => x.current)).toHaveLength(1);
  });

  it("Comments | DMs segments keep the filter and show what needs you", () => {
    const t = kindTabs("dms", "drafted", 15, 3);
    expect(t).toEqual([
      { href: "/inbox?filter=drafted", label: "Comments", count: 15, active: false },
      { href: "/inbox/dms?filter=drafted", label: "DMs", count: 3, active: true },
    ]);
  });
});

describe("reply status sentence", () => {
  const L = (ig: string, yt: string, tt: string) =>
    [
      { platform: "instagram", label: ig, line: "" },
      { platform: "youtube", label: yt, line: "" },
      { platform: "tiktok", label: tt, line: "" },
    ] as unknown as Parameters<typeof replyStatusSentence>[0];
  it("one plain line", () => {
    expect(replyStatusSentence(L("drafts only", "drafts only", "drafts only"))).toBe("Replies are drafts only");
    expect(replyStatusSentence(L("drafts only", "drafts only", "off"))).toBe("Replies are drafts only on Instagram and YouTube");
    expect(replyStatusSentence(L("auto", "drafts only", "off"))).toBe("Auto-reply is on for Instagram");
    expect(replyStatusSentence(L("auto", "auto", "off"))).toBe("Auto-reply is on for Instagram and YouTube");
    expect(replyStatusSentence(L("held (killed)", "drafts only", "off"))).toBe("Replies are paused for every platform");
    expect(replyStatusSentence(L("off", "off", "off"))).toBe("Replies are off");
  });
});

describe("reason words", () => {
  it("one chip, the most important reason first", () => {
    expect(reasonChip("flag", "question; location/schedule")).toEqual({ label: "Asks where you are", tone: "warn" });
    expect(reasonChip("flag", "question; brand/business")).toEqual({ label: "Business", tone: "neutral" });
    expect(reasonChip("flag", "question")).toEqual({ label: "Question", tone: "neutral" });
    expect(reasonChip("hide_flag", "threat")).toEqual({ label: "Threat", tone: "danger" });
    expect(reasonChip("negative", "mockery")).toEqual({ label: "Mockery", tone: "neutral" });
    expect(reasonChip("simple_positive", "plain praise")).toEqual({ label: "Praise", tone: "neutral" });
    expect(reasonChip("flag", "low confidence")).toEqual({ label: "Not sure", tone: "neutral" });
    expect(reasonChip("flag", "something new")).toEqual({ label: "Something new", tone: "neutral" });
    expect(reasonChip("flag", null)).toBeNull();
    expect(reasonChip("spam_promo", "promo:s4s")).toBeNull();
  });

  it("promo rules in plain words", () => {
    expect(promoReasonText("promo:send-to")).toBe("Looks like a promo account: asks you to send the clip to another page");
    expect(promoReasonText("promo:list")).toBe("On your always-ignore list");
    expect(promoReasonText("promo:mystery")).toBe("Looks like a promo account");
    expect(promoReasonText(null)).toBe("Looks like a promo account");
  });
});

describe("result notice", () => {
  it("says what happened in plain words", () => {
    expect(resultNotice({ note: "dry run: recorded what would be sent; the worker will not send it while DRY_RUN is on" })).toEqual({
      tone: "info",
      text: "Dry run: nothing was sent. The reply is saved as approved.",
    });
    expect(resultNotice({ note: "queued: the worker sends it on its next tick (kill switch, limits and the thread check still apply)" })?.text).toBe(
      "Approved. It goes out within a few minutes.",
    );
    expect(resultNotice({ note: "already sent" })?.text).toBe("Already sent.");
    expect(resultNotice({ note: "already queued" })?.text).toBe("Already approved. It's on its way.");
    expect(resultNotice({ error: "the reply has a link" })).toEqual({ tone: "danger", text: "Not sent: the reply has a link." });
    expect(resultNotice({ error: "auto-replies are killed: resume first" })?.text).toBe("Not sent: replies are paused. Resume them in Settings.");
    expect(resultNotice({ note: "marked done" })?.text).toBe("Marked done.");
    expect(resultNotice({})).toBeNull();
  });
});

describe("card plan", () => {
  it("flagged without a draft: write your own", () => {
    const p = cardPlan(row(), "needs-you");
    expect(p.primary).toBe("write");
    expect(p.canDismiss).toBe(true);
  });
  it("flagged with a draft, and drafted: approve", () => {
    expect(cardPlan(row({ draftedReply: "thanks!", actions: ["open", "approve", "done"] }), "needs-you").primary).toBe("approve");
    expect(cardPlan(row({ bucket: "simple_positive", draftedReply: "thanks!", replyStatus: "shadow" }), "drafted").primary).toBe("approve");
  });
  it("abusive: no reply, hide on Instagram only", () => {
    const ig = cardPlan(row({ bucket: "hide_flag", reason: "threat", actions: ["open", "hide", "done"] }), "needs-you");
    expect(ig.primary).toBe("none");
    expect(ig.canHide).toBe(true);
    expect(ig.note).toMatch(/no reply/i);
    expect(cardPlan(row({ platform: "youtube", bucket: "hide_flag", actions: ["open", "done"] }), "needs-you").canHide).toBe(false);
  });
  it("TikTok replies are not supported from here", () => {
    const p = cardPlan(row({ platform: "tiktok", draftedReply: "thanks!" }), "drafted");
    expect(p.primary).toBe("none");
    expect(p.note).toMatch(/TikTok/);
  });
  it("sent shows the state, no buttons", () => {
    const p = cardPlan(row({ draftedReply: "thanks!", replyStatus: "planned" }), "sent");
    expect(p.primary).toBe("none");
    expect(p.status).toEqual({ label: "Queued", tone: "neutral" });
    expect(cardPlan(row({ replyStatus: "unknown" }), "sent").status?.tone).toBe("warn");
    expect(p.canDismiss).toBe(false);
  });
  it("ignored: not spam, nothing else", () => {
    const p = cardPlan(row({ bucket: "spam_promo", reason: "promo:s4s", actions: ["open", "not-spam"] }), "ignored");
    expect(p).toMatchObject({ primary: "none", canNotSpam: true, canIgnoreAccount: true, canDismiss: false });
    expect(p.rule).toBe("Looks like a promo account: asks for a shoutout swap");
    expect(cardPlan(row({ bucket: "spam_promo", reason: "promo:list", actions: ["open", "not-spam"] }), "ignored").canIgnoreAccount).toBe(false);
  });
  it("DMs: copy the draft", () => {
    const dm = row({ kind: "dm", draftedReply: "hey, thanks", draftId: "d1", href: null, actions: ["copy", "done", "ignore-account"] });
    expect(cardPlan(dm, "drafted").primary).toBe("copy");
    expect(cardPlan({ ...dm, draftId: undefined, draftedReply: null, actions: ["done", "ignore-account"] }, "needs-you").primary).toBe("none");
  });
});

describe("dm window", () => {
  it("one plain line", () => {
    expect(dmWindowText({ open: true, msLeft: 5 * 3_600_000 + 7 * 60_000 })).toBe("Reply window closes in 5 h 7 min");
    expect(dmWindowText({ open: true, msLeft: 30_000 })).toBe("Reply window closes in under a minute");
    expect(dmWindowText({ open: false, msLeft: 0 })).toMatch(/closed/);
  });
});

describe("empty states", () => {
  it("name the next action with one link", () => {
    expect(emptyFor("comments", "needs-you").action.href).toBe("/inbox?filter=drafted");
    expect(emptyFor("dms", "needs-you").action.href).toBe("/settings");
    expect(emptyFor("comments", "ignored").title).toBe("Nothing ignored");
  });
});

describe("item plan", () => {
  const T = { bucket: "flag" as const, reasons: ["question"], confidence: null, model: null, decidedAt: "", handledAt: null, notSpamAt: null };
  const I = { platform: "instagram" as const, state: "needs-you" as const, draftedReply: null, triage: T, reply: null, isOwn: false };
  it("one solid action while it waits", () => {
    expect(itemPlan(I).primary).toBe("write");
    expect(itemPlan({ ...I, state: "drafted", draftedReply: "thanks!" }).primary).toBe("approve");
    expect(itemPlan({ ...I, platform: "tiktok", state: "drafted", draftedReply: "x" }).primary).toBe("none");
    expect(itemPlan({ ...I, triage: { ...T, bucket: "hide_flag" } })).toMatchObject({ primary: "none", canHide: true });
  });
  it("after the fact: state, no button", () => {
    expect(itemPlan({ ...I, state: "sent" })).toMatchObject({ primary: "none", status: { label: "Sent", tone: "accent" } });
    expect(itemPlan({ ...I, state: "queued" }).status?.label).toBe("Queued");
    expect(itemPlan({ ...I, state: "done" }).note).toMatch(/without a reply/);
    expect(itemPlan({ ...I, state: "ignored", triage: { ...T, bucket: "spam_promo", reasons: ["promo:growth"] } })).toMatchObject({
      canNotSpam: true,
      rule: "Looks like a promo account: sells followers or growth",
    });
  });
});
