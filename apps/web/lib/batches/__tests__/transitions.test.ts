import { describe, expect, it } from "vitest";
import { planTransition } from "../transitions.js";
import type { BatchItemView, ItemStatus, Warning } from "../types.js";
import { makeBatch, makeItem, NOW } from "./fixtures.js";

const block: Warning = { code: "media.no-clean-file", severity: "block", message: "no clean file in storage; run touch-up/ingest first" };
const warn: Warning = { code: "media.qa", severity: "warn", message: "media QA: dark" };

describe("planTransition", () => {
  it("approve: a clean draft becomes approved; batch becomes approved", () => {
    const a = makeItem({ warnings: [warn] });
    const r = planTransition(makeBatch([a]), { kind: "approve", itemIds: [a.id] }, NOW);
    expect(r).toEqual({ ok: true, changes: [{ itemId: a.id, from: "draft", to: "approved", eventKind: "approve" }], batchStatus: "approved", skipped: [] });
  });

  it("approve of a blocked item fails with the block message", () => {
    const a = makeItem();
    const b = makeItem({ warnings: [block, warn] });
    const r = planTransition(makeBatch([a, b]), { kind: "approve", itemIds: [a.id, b.id] }, NOW);
    expect(r).toEqual({ ok: false, reason: block.message, itemId: b.id });
  });

  it("approve refuses a non-draft item", () => {
    const a = makeItem({ status: "approved" });
    const r = planTransition(makeBatch([a]), { kind: "approve", itemIds: [a.id] }, NOW);
    expect(r).toMatchObject({ ok: false, itemId: a.id });
  });

  it("approve-all skips blocked drafts with reasons, approves the rest, ignores non-drafts", () => {
    const ok1 = makeItem();
    const blocked = makeItem({ warnings: [block] });
    const ok2 = makeItem({ warnings: [warn] });
    const published = makeItem({ status: "published", platformPostId: "p1" });
    const rejected = makeItem({ status: "rejected", warnings: [block] });
    const r = planTransition(makeBatch([ok1, blocked, ok2, published, rejected]), { kind: "approve-all" }, NOW);
    expect(r).toEqual({
      ok: true,
      changes: [
        { itemId: ok1.id, from: "draft", to: "approved", eventKind: "approve-all" },
        { itemId: ok2.id, from: "draft", to: "approved", eventKind: "approve-all" },
      ],
      batchStatus: "approved",
      skipped: [{ itemId: blocked.id, reasons: [block.message] }],
    });
  });

  it("approve-all with everything blocked is ok with no changes and batch stays draft", () => {
    const items = [makeItem({ warnings: [block] }), makeItem({ warnings: [block] })];
    const r = planTransition(makeBatch(items), { kind: "approve-all" }, NOW);
    expect(r).toMatchObject({ ok: true, changes: [], batchStatus: "draft" });
    if (r.ok) expect(r.skipped).toHaveLength(2);
  });

  it("edit on an approved item moves it back to draft with a snake-case patch", () => {
    const a = makeItem({ status: "approved", approvedAt: NOW.toISOString() });
    const r = planTransition(makeBatch([a]), { kind: "edit", itemId: a.id, patch: { scheduledFor: "2026-11-19T16:30:00Z", caption: a.caption } }, NOW);
    expect(r).toEqual({
      ok: true,
      changes: [{ itemId: a.id, from: "approved", to: "draft", eventKind: "edit", patch: { scheduled_for: "2026-11-19T16:30:00.000Z" } }],
      batchStatus: "draft",
      skipped: [],
    });
  });

  it("edit on a draft stays draft; title and caption map through", () => {
    const a = makeItem({ platform: "youtube", title: "Old" });
    const r = planTransition(makeBatch([a]), { kind: "edit", itemId: a.id, patch: { caption: "New words.", title: null } }, NOW);
    expect(r).toMatchObject({ ok: true, changes: [{ from: "draft", to: "draft", eventKind: "edit", patch: { caption: "New words.", title: null } }] });
  });

  it("edit refuses a no-op patch and an unparseable time", () => {
    const a = makeItem();
    const b = makeBatch([a]);
    expect(planTransition(b, { kind: "edit", itemId: a.id, patch: {} }, NOW)).toMatchObject({ ok: false });
    expect(planTransition(b, { kind: "edit", itemId: a.id, patch: { scheduledFor: a.scheduledFor } }, NOW)).toMatchObject({ ok: false });
    expect(planTransition(b, { kind: "edit", itemId: a.id, patch: { scheduledFor: "next tuesday" } }, NOW)).toMatchObject({ ok: false, itemId: a.id });
  });

  it("edit on a handed-off item is refused", () => {
    const withId = makeItem({ status: "approved", platformPostId: "yt-123" });
    const publishing = makeItem({ status: "publishing" });
    const b = makeBatch([withId, publishing]);
    for (const i of [withId, publishing]) {
      expect(planTransition(b, { kind: "edit", itemId: i.id, patch: { caption: "changed" } }, NOW)).toMatchObject({ ok: false, itemId: i.id });
    }
  });

  it("unapprove refuses publishing/published/unknown/failed (and draft/rejected)", () => {
    for (const status of ["publishing", "published", "unknown", "failed", "rejected", "draft"] as ItemStatus[]) {
      const i = makeItem({ status });
      const r = planTransition(makeBatch([i]), { kind: "unapprove", itemIds: [i.id] }, NOW);
      expect(r, status).toMatchObject({ ok: false, itemId: i.id });
      if (!r.ok) expect(r.reason).toContain(status);
    }
  });

  it("unapprove allows approved and queued", () => {
    const a = makeItem({ status: "approved" });
    const q = makeItem({ status: "queued" });
    const r = planTransition(makeBatch([a, q]), { kind: "unapprove", itemIds: [a.id, q.id] }, NOW);
    expect(r).toMatchObject({
      ok: true,
      changes: [
        { itemId: a.id, from: "approved", to: "draft", eventKind: "unapprove" },
        { itemId: q.id, from: "queued", to: "draft", eventKind: "unapprove" },
      ],
    });
  });

  it("batchStatus returns to draft when the last approved item is unapproved", () => {
    const a = makeItem({ status: "approved" });
    const d = makeItem();
    const x = makeItem({ status: "rejected" });
    const r = planTransition(makeBatch([a, d, x]), { kind: "unapprove", itemIds: [a.id] }, NOW);
    expect(r).toMatchObject({ ok: true, batchStatus: "draft" });
    const a2 = makeItem({ status: "approved" });
    const r2 = planTransition(makeBatch([a, a2, d]), { kind: "unapprove", itemIds: [a.id] }, NOW);
    expect(r2).toMatchObject({ ok: true, batchStatus: "approved" });
  });

  it("reject is allowed from draft and approved only", () => {
    const allowed: BatchItemView[] = [makeItem(), makeItem({ status: "approved" })];
    const r = planTransition(makeBatch(allowed), { kind: "reject", itemIds: allowed.map((i) => i.id) }, NOW);
    expect(r).toMatchObject({ ok: true, batchStatus: "draft", changes: [{ to: "rejected", eventKind: "reject", from: "draft" }, { to: "rejected", from: "approved" }] });
    for (const status of ["queued", "publishing", "published", "unknown", "failed", "rejected"] as ItemStatus[]) {
      const i = makeItem({ status });
      expect(planTransition(makeBatch([i]), { kind: "reject", itemIds: [i.id] }, NOW), status).toMatchObject({ ok: false, itemId: i.id });
    }
  });

  it("unknown id and empty ids fail", () => {
    const b = makeBatch([makeItem()]);
    expect(planTransition(b, { kind: "approve", itemIds: ["nope"] }, NOW)).toMatchObject({ ok: false, itemId: "nope" });
    expect(planTransition(b, { kind: "reject", itemIds: [] }, NOW)).toMatchObject({ ok: false });
    expect(planTransition(b, { kind: "unapprove", itemIds: ["nope"] }, NOW)).toMatchObject({ ok: false });
    expect(planTransition(b, { kind: "edit", itemId: "nope", patch: { caption: "x" } }, NOW)).toMatchObject({ ok: false, itemId: "nope" });
  });
});
