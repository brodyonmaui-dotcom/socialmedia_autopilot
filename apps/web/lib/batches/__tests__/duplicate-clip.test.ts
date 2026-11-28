import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE, type ClipSibling } from "@autopilot/core";
import { approveAllView, groupEntries, lineState } from "../../calendar/model.js";
import { planApproveSome } from "../../calendar/plan.js";
import { planTransition } from "../transitions.js";
import { computeWarnings, type WarningContext } from "../warnings.js";
import type { BatchItemView, Warning } from "../types.js";
import { makeBatch, makeItem, NOW } from "./fixtures.js";

const ctx = (over: Partial<WarningContext> = {}): WarningContext => ({
  now: NOW,
  cadence: { ...DEFAULT_CADENCE, dailyCaps: { ...DEFAULT_CADENCE.dailyCaps, instagram: 4, youtube: 4, tiktok: 4 } },
  timeZone: "UTC",
  existing: [],
  blocklist: [],
  ...over,
});
const dupOf = (ws: Warning[] | undefined) => (ws ?? []).filter((w) => w.code === "duplicate.clip");

// The shape that slipped through: the same clip on TikTok, approved Thu Nov 26 09:00 and drafted again Fri Nov 27.
const nov26 = () => makeItem({ mediaId: "m-dup", platform: "tiktok", status: "approved", scheduledFor: "2026-11-26T09:00:00.000Z" });
const nov27 = () => makeItem({ mediaId: "m-dup", platform: "tiktok", status: "draft", scheduledFor: "2026-11-27T15:00:00.000Z" });

describe("duplicate.clip warning (F26 A: duplicate guard v2)", () => {
  const SCHED = "This video is already scheduled on TikTok for Thu Nov 26";

  it("Nov 26 TikTok approved + Nov 27 TikTok draft → block on the draft, naming the other post's day", () => {
    const a = nov26();
    const b = nov27();
    const map = computeWarnings([a, b], ctx());
    expect(dupOf(map.get(b.id))).toEqual([{ code: "duplicate.clip", severity: "block", message: SCHED, itemId: a.id }]);
    expect(dupOf(map.get(a.id))).toHaveLength(1); // both lines show it; either can be dropped
    expect(map.get(b.id)!.some((w) => w.code === "duplicate.media")).toBe(false); // not shown twice
    // It can't be approved, one by one or with Approve all.
    const batch = makeBatch([a, b]);
    for (const i of batch.items) i.warnings = map.get(i.id)!;
    expect(planTransition(batch, { kind: "approve", itemIds: [b.id] }, NOW)).toMatchObject({ ok: false, reason: SCHED });
    const all = planTransition(batch, { kind: "approve-all" }, NOW);
    expect(all.ok && all.changes).toEqual([]);
    expect(planApproveSome(batch, [b.id], NOW).approved).toEqual([]);
  });

  it("the sibling can come from another batch (the loader's clipSiblings), in the creator zone", () => {
    const b = nov27();
    const other: ClipSibling = { id: "other-1", mediaId: "m-dup", platform: "tiktok", status: "approved", scheduledFor: "2026-11-27T03:00:00.000Z" };
    const ws = computeWarnings([b], ctx({ clipSiblings: [other], timeZone: "America/New_York" })).get(b.id);
    expect(dupOf(ws)[0]?.message).toBe(SCHED); // Nov 26, 10 PM in New York
  });

  it("published within 90 days blocks: 'This video was already posted on Instagram on Fri Nov 20'", () => {
    const b = makeItem({ mediaId: "m-dup", platform: "instagram", status: "draft", scheduledFor: "2027-02-10T15:00:00.000Z" });
    const pub: ClipSibling = { id: "p1", mediaId: "m-dup", platform: "instagram", status: "published", scheduledFor: "2026-11-20T18:00:00.000Z", publishedAt: "2026-11-20T18:00:00.000Z" };
    const ws = computeWarnings([b], ctx({ clipSiblings: [pub] })).get(b.id);
    expect(dupOf(ws)).toEqual([{ code: "duplicate.clip", severity: "block", message: "This video was already posted on Instagram on Fri Nov 20", itemId: "p1" }]);
  });

  it("over 90 days apart → a warning, not a block", () => {
    const b = makeItem({ mediaId: "m-dup", platform: "instagram", status: "draft", scheduledFor: "2027-03-01T15:00:00.000Z" });
    const pub: ClipSibling = { id: "p1", mediaId: "m-dup", platform: "instagram", status: "published", scheduledFor: "2026-11-20T18:00:00.000Z" };
    const ws = computeWarnings([b], ctx({ clipSiblings: [pub] })).get(b.id)!;
    expect(dupOf(ws)).toEqual([]);
    expect(ws.find((w) => w.code === "duplicate.footage")).toEqual({ code: "duplicate.footage", severity: "warn", message: "This video was already posted on Instagram on Fri Nov 20 (over 90 days apart)", itemId: "p1" });
  });

  it("an already-posted reject counts as posted at its time; a plain reject, a failure, another platform or clip don't", () => {
    const b = nov27();
    const posted: ClipSibling = { id: "r1", mediaId: "m-dup", platform: "tiktok", status: "rejected", alreadyPosted: true, scheduledFor: "2026-10-01T09:00:00.000Z" };
    expect(dupOf(computeWarnings([b], ctx({ clipSiblings: [posted] })).get(b.id))[0]?.message).toBe("This video was already posted on TikTok on Thu Oct 1");
    const others: ClipSibling[] = [
      { id: "o1", mediaId: "m-dup", platform: "instagram", status: "approved", scheduledFor: "2026-11-26T09:00:00.000Z" },
      { id: "o2", mediaId: "m-dup", platform: "tiktok", status: "rejected", scheduledFor: "2026-11-26T09:00:00.000Z" },
      { id: "o3", mediaId: "m-dup", platform: "tiktok", status: "failed", scheduledFor: "2026-11-26T09:00:00.000Z" },
      { id: "o4", mediaId: "m-other", platform: "tiktok", status: "approved", scheduledFor: "2026-11-27T15:00:00.000Z" },
    ];
    expect((computeWarnings([b], ctx({ clipSiblings: others })).get(b.id) ?? []).filter((w) => w.code.startsWith("duplicate."))).toEqual([]);
    // This batch's own already-posted line counts too.
    const own = makeItem({ mediaId: "m-dup", platform: "tiktok", status: "rejected", rejectReason: "already-posted", scheduledFor: "2026-11-20T09:00:00.000Z" });
    expect(dupOf(computeWarnings([b, own], ctx()).get(b.id))[0]?.message).toBe("This video was already posted on TikTok on Fri Nov 20");
  });

  it("a different media row that is the same video (videoFamilies: fixed copy, re-upload) blocks; derived footage warns", () => {
    const b = makeItem({ mediaId: "m-reupload", platform: "instagram", status: "draft", scheduledFor: "2026-11-27T15:00:00.000Z" });
    const pub: ClipSibling = { id: "p1", mediaId: "m-orig", platform: "instagram", status: "published", scheduledFor: "2026-11-20T18:00:00.000Z" };
    const fam = (relation: "same" | "derived") => new Map([["m-reupload", new Map([["m-reupload", { relation: "same" as const, why: "same-clip" as const }], ["m-orig", { relation, why: "fingerprint" as const }]])]]);
    expect(dupOf(computeWarnings([b], ctx({ clipSiblings: [pub], videoFamilies: fam("same") })).get(b.id))[0]?.message).toBe("This video was already posted on Instagram on Fri Nov 20");
    // Without the family (an old loader) only the same media id matches.
    expect(dupOf(computeWarnings([b], ctx({ clipSiblings: [pub] })).get(b.id))).toEqual([]);
    const ws = computeWarnings([b], ctx({ clipSiblings: [pub], videoFamilies: fam("derived") })).get(b.id)!;
    expect(dupOf(ws)).toEqual([]);
    expect(ws.find((w) => w.code === "duplicate.footage")?.message).toBe("Uses footage you posted on Instagram on Fri Nov 20 · not as a trial reel (trials need new content)");
  });

  it("a planned move re-checks against the new time (this batch's items win over the loader's copy)", () => {
    const a = nov26();
    const b = nov27();
    const stale: ClipSibling = { id: a.id, mediaId: "m-dup", platform: "tiktok", status: "approved", scheduledFor: "2026-11-26T09:00:00.000Z" };
    const moved = { ...a, scheduledFor: "2027-03-10T09:00:00.000Z" };
    expect(dupOf(computeWarnings([moved, b], ctx({ clipSiblings: [stale] })).get(b.id))).toEqual([]);
  });
});

describe("Already posted on <Platform>: drop it", () => {
  const withWarnings = (items: BatchItemView[]) => {
    const map = computeWarnings(items, ctx());
    for (const i of items) i.warnings = map.get(i.id)!;
    return makeBatch(items);
  };

  it("is the reject transition with detail {reason: already-posted}, from draft or approved", () => {
    const d = makeItem({ status: "draft" });
    const a = makeItem({ status: "approved", approvedAt: NOW.toISOString() });
    const plan = planTransition(withWarnings([d, a]), { kind: "reject", itemIds: [d.id, a.id], reason: "already-posted" }, NOW);
    expect(plan).toMatchObject({ ok: true, batchStatus: "draft" });
    expect(plan.ok && plan.changes).toEqual([
      { itemId: d.id, from: "draft", to: "rejected", eventKind: "reject", detail: { reason: "already-posted" } },
      { itemId: a.id, from: "approved", to: "rejected", eventKind: "reject", detail: { reason: "already-posted" } },
    ]);
    // A plain reject keeps its old shape (no detail).
    const x = makeItem();
    const plain = planTransition(withWarnings([x]), { kind: "reject", itemIds: [x.id] }, NOW);
    expect(plain.ok && plain.changes).toEqual([{ itemId: x.id, from: "draft", to: "rejected", eventKind: "reject" }]);
  });

  it("refuses queued, publishing, published, failed and unknown lines, and an unknown reason", () => {
    for (const status of ["queued", "publishing", "published", "failed", "unknown"] as const) {
      const i = makeItem({ status, platformPostId: status === "published" ? "pp1" : null });
      const plan = planTransition(makeBatch([i]), { kind: "reject", itemIds: [i.id], reason: "already-posted" }, NOW);
      expect(plan.ok, status).toBe(false);
    }
    const d = makeItem();
    expect(planTransition(makeBatch([d]), { kind: "reject", itemIds: [d.id], reason: "nope" as "already-posted" }, NOW)).toMatchObject({ ok: false });
  });

  it("a rejected line whose latest reject says already-posted reads 'Already posted'; plain rejects stay 'Rejected'", () => {
    const posted = makeItem({ status: "rejected", rejectReason: "already-posted" });
    const plain = makeItem({ status: "rejected", rejectReason: null });
    expect(lineState(posted, NOW).state).toBe("already-posted");
    expect(lineState(plain, NOW).state).toBe("rejected");
    const shown = groupEntries([posted], { timeZone: "UTC", now: NOW, showRejected: true });
    expect(shown[0]!.platforms[0]).toMatchObject({ statusLabel: "Already posted", tone: "neutral", canDropPosted: false, dropInline: null });
    expect(groupEntries([posted], { timeZone: "UTC", now: NOW })).toEqual([]); // hidden unless Show rejected
    expect(approveAllView(shown)).toMatchObject({ total: 0, notIncluded: [] }); // never counts toward Approve all
  });

  it("an empty-caption line offers the drop inline, next to its needs-a-fix reason; a clean line only in the menu", () => {
    const empty = makeItem({ caption: "", mediaId: "m-empty" });
    const clean = makeItem({ mediaId: "m-clean" });
    const [eEmpty, eClean] = ((b) => [groupEntries([b.items[0]!], { timeZone: "UTC", now: NOW })[0]!, groupEntries([b.items[1]!], { timeZone: "UTC", now: NOW })[0]!])(
      withWarnings([empty, clean]),
    );
    expect(eEmpty.platforms[0]).toMatchObject({ state: "needs-fix", fix: "needs a caption", canDropPosted: true, dropInline: "needs a caption" });
    expect(eClean.platforms[0]).toMatchObject({ state: "needs-approval", canDropPosted: true, dropInline: null });
  });

  it("a duplicate-clip line offers it inline too (draft: needs a fix; approved: the warning text)", () => {
    const a = nov26();
    const b = nov27();
    withWarnings([a, b]);
    const lines = groupEntries([a, b], { timeZone: "UTC", now: NOW }).flatMap((e) => e.platforms);
    const msg = "This video is already scheduled on TikTok for Thu Nov 26";
    expect(lines.find((p) => p.itemId === b.id)).toMatchObject({ state: "needs-fix", dropInline: msg });
    expect(lines.find((p) => p.itemId === a.id)).toMatchObject({ state: "approved", canDropPosted: true });
    expect(lines.find((p) => p.itemId === a.id)!.dropInline).toMatch(/^This video is already scheduled on TikTok /);
  });
});
