import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CADENCE, localDate, type Platform } from "@autopilot/core";
import { computeWarnings } from "../../batches/warnings.js";
import type { BatchItemView, BatchView, EditorMeta } from "../../batches/types.js";
import { makeBatch, makeItem } from "../../batches/__tests__/fixtures.js";
import { approveRender, planRenderApprove } from "../approve.js";
import { planEdits } from "../move.js";
import { planTomorrow, tomorrowWindow, type SlotItem } from "../slotting.js";
import { approveLabel, approveNote, firstLines, groupRenders, renderChips, slotLabel } from "../view.js";

const NOW = new Date("2026-11-13T12:00:00.000Z"); // a Friday
const TZ = "UTC";
const meta = (flags: EditorMeta["flags"] = []): EditorMeta => ({ source: "CapCut", pillar: "gym", when: "today", earliest: null, approvedInEditor: true, flags });
const ed = (platform: Platform, over: Partial<BatchItemView> = {}) =>
  makeItem({ platform, mediaId: "media-r1", origin: "editor", editor: meta(), scheduledFor: "2026-11-13T18:30:00.000Z", title: platform === "youtube" ? "Morning setup" : null, createdAt: "2026-11-13T10:00:00.000Z", ...over });

function withWarnings(batch: BatchView): BatchView {
  const ws = computeWarnings(batch.items, { now: NOW, cadence: DEFAULT_CADENCE, timeZone: TZ, existing: [], blocklist: [] });
  for (const i of batch.items) i.warnings = ws.get(i.id) ?? [];
  return batch;
}

describe("view", () => {
  it("slotLabel says Today / Tomorrow / a date in the creator zone", () => {
    expect(slotLabel("2026-11-13T18:30:00.000Z", NOW, TZ)).toBe("Today 18:30");
    expect(slotLabel("2026-11-14T09:30:00.000Z", NOW, TZ)).toBe("Tomorrow 09:30");
    expect(slotLabel("2026-11-16T09:30:00.000Z", NOW, TZ)).toBe("Mon 16 Nov 09:30");
    expect(slotLabel(null, NOW, TZ)).toBe("No slot");
    // Late evening UTC is already "tomorrow" further east.
    expect(slotLabel("2026-11-13T23:30:00.000Z", NOW, "Etc/GMT-2")).toBe("Tomorrow 01:30");
  });

  it("firstLines keeps two non-empty lines", () => {
    expect(firstLines("one\n\n two \nthree")).toEqual(["one", "two"]);
    expect(firstLines("")).toEqual([]);
  });

  it("groups one render's platforms, IG first, and only editor drafts", () => {
    const b = withWarnings(makeBatch([ed("tiktok"), ed("instagram"), ed("youtube"), makeItem({ mediaId: "media-r1" }), ed("instagram", { mediaId: "m2", status: "rejected" })]));
    const rs = groupRenders(b.items, NOW, TZ);
    expect(rs).toHaveLength(1);
    expect(rs[0]!.lines.map((l) => l.platform)).toEqual(["instagram", "youtube", "tiktok"]);
    expect(rs[0]!.source).toBe("CapCut");
    expect(rs[0]!.lines[0]!.slot).toBe("Today 18:30");
    expect(approveLabel(rs[0]!)).toBe("Approve & schedule");
  });

  it("chips: block first, merged across platforms, editor wording", () => {
    const b = withWarnings(
      makeBatch([
        ed("instagram", { caption: "", editor: meta(["needs-caption", "add-sound-in-app"]) }),
        ed("tiktok", { caption: "", tiktokDraft: true, editor: meta(["needs-caption", "add-sound-in-app"]) }),
        ed("youtube", { scheduledFor: null, editor: meta(["no-slot"]) }),
      ]),
    );
    const chips = renderChips(b.items);
    expect(chips.map((c) => [c.tone, c.label, c.platforms.join(",")])).toEqual([
      ["danger", "Needs caption", "instagram,tiktok"],
      ["danger", "No free slot today", "youtube"],
      ["warn", "Add sound in app or post as-is", "instagram,tiktok"],
    ]);
    const r = groupRenders(b.items, NOW, TZ)[0]!;
    expect(r.approvableIds).toEqual([]);
    expect(approveLabel(r)).toBeNull();
  });

  it("approveNote names what stayed", () => {
    expect(approveNote(["instagram", "youtube"], [{ platform: "tiktok", reason: "Needs caption" }])).toBe("approved IG, YT · stayed: TT (Needs caption)");
  });
});

describe("Approve & schedule", () => {
  it("approves only the items without a block warning, via planTransition 'approve'", async () => {
    const ig = ed("instagram");
    const yt = ed("youtube");
    const tt = ed("tiktok", { caption: "" });
    const weekly = makeItem();
    const batch = withWarnings(makeBatch([ig, yt, tt, weekly]));
    const apply = vi.fn(async () => {});
    const res = await approveRender({ load: async () => batch, store: { apply } }, batch.id, [ig.id, yt.id, tt.id, weekly.id], "s1", NOW);
    expect(res.approved.map((a) => a.itemId)).toEqual([ig.id, yt.id]);
    expect(res.stayed).toEqual([
      { itemId: tt.id, platform: "tiktok", reason: "Needs caption" },
      { itemId: weekly.id, platform: "instagram", reason: "not an editor draft" },
    ]);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(batch.id, [
      { itemId: ig.id, from: "draft", to: "approved", eventKind: "approve" },
      { itemId: yt.id, from: "draft", to: "approved", eventKind: "approve" },
    ], "approved", "s1", NOW);
    expect(res.note).toBe("approved IG, YT · stayed: TT (Needs caption), IG (not an editor draft)");
  });

  it("applies nothing when every item is blocked", async () => {
    const tt = ed("tiktok", { scheduledFor: null });
    const batch = withWarnings(makeBatch([tt]));
    const apply = vi.fn(async () => {});
    const res = await approveRender({ load: async () => batch, store: { apply } }, batch.id, [tt.id], null, NOW);
    expect(apply).not.toHaveBeenCalled();
    expect(res.stayed[0]!.reason).toBe("No free slot today");
  });

  it("never trusts stale warnings: a past time stays even with warnings: []", () => {
    const past = ed("instagram", { scheduledFor: "2026-11-13T09:00:00.000Z" });
    const batch = makeBatch([past]); // warnings deliberately not computed
    const plan = planRenderApprove(batch, [past.id], NOW);
    expect(plan.changes).toBeNull();
    expect(plan.stayed[0]!.reason).toBe("time is in the past");
  });
});

describe("Move to tomorrow", () => {
  const items = (ps: Platform[]): SlotItem[] => ps.map((p, i) => ({ id: `it-${i}`, platform: p, status: "draft", origin: "editor", earliest: null }));
  const { notBefore, notAfter, date } = tomorrowWindow(NOW, TZ);

  it("re-slots every platform inside tomorrow (creator zone), same day, no stagger", () => {
    const r = planTomorrow(items(["instagram", "youtube", "tiktok"]), { now: NOW, timeZone: TZ, cadence: DEFAULT_CADENCE, existing: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const iso of Object.values(r.slots)) {
      const t = Date.parse(iso);
      expect(t >= notBefore.getTime() && t < notAfter.getTime()).toBe(true);
      expect(localDate(new Date(t), TZ)).toBe(date);
    }
    expect(Object.keys(r.slots)).toHaveLength(3);
  });

  it("refuses (and places nothing) when tomorrow is at the cap for one platform", () => {
    const cadence = { ...DEFAULT_CADENCE, dailyCaps: { ...DEFAULT_CADENCE.dailyCaps, tiktok: 2 } };
    const existing = [
      { platform: "tiktok" as const, scheduledFor: `${date}T10:00:00.000Z` },
      { platform: "tiktok" as const, scheduledFor: `${date}T13:00:00.000Z` },
    ];
    const r = planTomorrow(items(["instagram", "tiktok"]), { now: NOW, timeZone: TZ, cadence, existing });
    expect(r).toEqual({ ok: false, error: "TT is at its daily cap tomorrow; nothing changed" });
  });

  it("respects trial.editor.earliest and refuses non-drafts / weekly items", () => {
    const earliest = `${date}T17:00:00.000Z`;
    const r = planTomorrow([{ id: "a", platform: "instagram", status: "draft", origin: "editor", earliest }], { now: NOW, timeZone: TZ, cadence: DEFAULT_CADENCE, existing: [] });
    expect(r.ok && Date.parse(r.slots.a!) >= Date.parse(earliest)).toBe(true);
    expect(planTomorrow([{ id: "a", platform: "instagram", status: "approved", origin: "editor", earliest: null }], { now: NOW, timeZone: TZ, cadence: DEFAULT_CADENCE, existing: [] }).ok).toBe(false);
    expect(planTomorrow([{ id: "a", platform: "instagram", status: "draft", origin: null, earliest: null }], { now: NOW, timeZone: TZ, cadence: DEFAULT_CADENCE, existing: [] }).ok).toBe(false);
  });

  it("planEdits writes edit {scheduledFor} via planTransition, all or nothing", () => {
    const a = ed("instagram", { scheduledFor: null });
    const b = ed("youtube", { status: "published", platformPostId: "x" });
    const batch = makeBatch([a, b]);
    const ok = planEdits(batch, [{ itemId: a.id, patch: { scheduledFor: "2026-11-14T10:00:00.000Z" } }], NOW);
    expect(ok).toEqual({ ok: true, batchStatus: "approved", changes: [{ itemId: a.id, from: "draft", to: "draft", eventKind: "edit", patch: { scheduled_for: "2026-11-14T10:00:00.000Z" } }] });
    const bad = planEdits(batch, [{ itemId: a.id, patch: { scheduledFor: "2026-11-14T10:00:00.000Z" } }, { itemId: b.id, patch: { scheduledFor: "2026-11-14T11:00:00.000Z" } }], NOW);
    expect(bad.ok).toBe(false);
  });
});
