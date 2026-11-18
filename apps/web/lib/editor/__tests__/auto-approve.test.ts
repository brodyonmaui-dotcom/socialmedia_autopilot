// Fable to review
// "Editor approval counts" gate (lib/editor/auto-approve.ts). Test-first: one test per gate condition, each
// flipping exactly one condition from the all-pass fixture, plus fast-check properties (default-deny).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PLATFORMS, type Platform } from "@autopilot/core";
import { makeItem } from "../../batches/__tests__/fixtures.js";
import { ITEM_STATUSES, type BatchItemView, type EditorMeta, type Warning, type WarningCode } from "../../batches/types.js";
import { hasBlock } from "../../batches/warnings.js";
import { AUTO_APPROVE_LEAD_MS, autoApproveDecision } from "../auto-approve.js";

const NOW = new Date("2026-11-13T12:00:00.000Z");
const ON = { approvalCounts: true, now: NOW };

const meta = (over: Partial<EditorMeta> = {}): EditorMeta => ({
  source: "trade-recaps",
  pillar: "trading",
  when: "today",
  earliest: null,
  approvedInEditor: true,
  approvedInEditorAt: "2026-11-13T11:00:00.000Z",
  unknownFlags: 0,
  flags: [],
  ...over,
});

/** Every gate passes: editor draft, approved in the editor at an ISO instant, an hour ahead, IG, clean. */
const pass = (over: Partial<BatchItemView> = {}, editor: Partial<EditorMeta> = {}): BatchItemView =>
  makeItem({ platform: "instagram", origin: "editor", editor: meta(editor), scheduledFor: "2026-11-13T13:00:00.000Z", caption: "Recap of the session.", ...over });

const block: Warning = { code: "lint.error", severity: "block", message: "names a place", field: "caption" };
const warn: Warning = { code: "lint.warn", severity: "warn", message: "0 hashtags", field: "caption" };

const no = (d: ReturnType<typeof autoApproveDecision>) => {
  expect(d.approve).toBe(false);
  if (!d.approve) expect(d.reason).toMatch(/\S/);
};

describe("autoApproveDecision", () => {
  it("approves when every gate passes", () => {
    expect(autoApproveDecision(pass(), [], ON)).toEqual({ approve: true });
    expect(autoApproveDecision(pass({}, { source: "workout-assembly" }), [], ON)).toEqual({ approve: true });
    for (const p of ["instagram", "youtube", "tiktok"] as const) {
      expect(autoApproveDecision(pass({ platform: p, title: p === "youtube" ? "A title" : null }), [], ON).approve).toBe(true);
    }
  });

  it("setting off → no", () => no(autoApproveDecision(pass(), [], { approvalCounts: false, now: NOW })));
  it("setting not exactly true → no", () => no(autoApproveDecision(pass(), [], { approvalCounts: "yes" as unknown as boolean, now: NOW })));
  it("invalid clock → no", () => no(autoApproveDecision(pass(), [], { approvalCounts: true, now: new Date(Number.NaN) })));

  it("not an editor item (origin null) → no", () => no(autoApproveDecision(pass({ origin: null }), [], ON)));
  it("editor meta missing → no", () => no(autoApproveDecision(pass({ editor: null }), [], ON)));

  for (const s of ITEM_STATUSES.filter((s) => s !== "draft")) {
    it(`status ${s} → no`, () => no(autoApproveDecision(pass({ status: s }), [], ON)));
  }
  it("handed off (platform post id) → no", () => no(autoApproveDecision(pass({ platformPostId: "123" }), [], ON)));

  it("source manual → no", () => no(autoApproveDecision(pass({}, { source: "manual" }), [], ON)));
  it("source missing → no", () => no(autoApproveDecision(pass({}, { source: null }), [], ON)));
  it("source a near miss → no", () => {
    for (const s of ["Trade-Recaps", "trade-recaps ", "workout", "CapCut", ""]) no(autoApproveDecision(pass({}, { source: s }), [], ON));
  });

  it("approvedInEditor true but no instant → no", () => no(autoApproveDecision(pass({}, { approvedInEditorAt: null }), [], ON)));
  it("approvedInEditor instant missing (undefined) → no", () => no(autoApproveDecision(pass({}, { approvedInEditorAt: undefined }), [], ON)));
  it("approvedInEditor not a date → no", () => {
    for (const s of ["yes", "true", "1", "2026-13-45T00:00:00Z", " ", "2026-11-13"]) no(autoApproveDecision(pass({}, { approvedInEditorAt: s }), [], ON));
  });
  it("approvedInEditor false → no", () => no(autoApproveDecision(pass({}, { approvedInEditor: false }), [], ON)));

  it("a block warning → no", () => no(autoApproveDecision(pass(), [block], ON)));
  it("a block warning on the item view → no", () => no(autoApproveDecision(pass({ warnings: [block] }), [], ON)));
  it("any warning at all → no (the setting promises zero warnings)", () => no(autoApproveDecision(pass(), [warn], ON)));

  for (const f of ["lint-error", "needs-caption", "no-slot", "add-sound-in-app", "tiktok-draft-limit"] as const) {
    it(`editor flag ${f} → no`, () => no(autoApproveDecision(pass({}, { flags: [f] }), [], ON)));
  }
  it("an unknown editor flag (location, QA, …) → no", () => no(autoApproveDecision(pass({}, { unknownFlags: 1 }), [], ON)));
  it("unknown-flag count missing → no", () => no(autoApproveDecision(pass({}, { unknownFlags: undefined }), [], ON)));
  it("media QA warnings → no", () => no(autoApproveDecision(pass({ media: { label: "x", durationS: 30, pillar: null, hasCleanFile: true, qaWarnings: ["gps found"] } }), [], ON)));
  it("no clean file → no", () => no(autoApproveDecision(pass({ media: { label: "x", durationS: 30, pillar: null, hasCleanFile: false, qaWarnings: [] } }), [], ON)));
  it("TikTok inbox draft (sound in app) → no", () => no(autoApproveDecision(pass({ platform: "tiktok", tiktokDraft: true }), [], ON)));

  it("no time → no", () => no(autoApproveDecision(pass({ scheduledFor: null }), [], ON)));
  it("unparseable time → no", () => no(autoApproveDecision(pass({ scheduledFor: "soon" }), [], ON)));
  it("time in the past → no", () => no(autoApproveDecision(pass({ scheduledFor: "2026-11-13T11:00:00.000Z" }), [], ON)));
  it("time exactly now + 2 min → no; one ms later → yes", () => {
    no(autoApproveDecision(pass({ scheduledFor: new Date(NOW.getTime() + AUTO_APPROVE_LEAD_MS).toISOString() }), [], ON));
    expect(autoApproveDecision(pass({ scheduledFor: new Date(NOW.getTime() + AUTO_APPROVE_LEAD_MS + 1).toISOString() }), [], ON).approve).toBe(true);
  });

  it("snapchat (assisted) → no", () => no(autoApproveDecision(pass({ platform: "snapchat" }), [], ON)));
  it("an unknown platform → no", () => no(autoApproveDecision(pass({ platform: "myspace" as Platform }), [], ON)));
  it("garbage shapes → no (never throws)", () => {
    no(autoApproveDecision(null as unknown as BatchItemView, [], ON));
    no(autoApproveDecision({} as BatchItemView, [], ON));
    no(autoApproveDecision(pass(), null as unknown as Warning[], ON));
    no(autoApproveDecision(pass(), [{} as Warning], ON));
    no(autoApproveDecision(pass(), [], null as unknown as typeof ON));
    no(autoApproveDecision(pass({}, { flags: "lint-error" as unknown as EditorMeta["flags"] }), [], ON));
  });
});

// ---- properties ----

const CODES: WarningCode[] = [
  "lint.error", "lint.warn", "placeholder", "time.past", "time.missing", "cap.breach", "duplicate.caption", "duplicate.media",
  "media.qa", "media.no-clean-file", "tiktok.needs-sound", "yt.over-60s", "caption.missing", "sound.in-app", "tiktok.draft-limit",
];
const warningArb = (severity?: Warning["severity"]): fc.Arbitrary<Warning> =>
  fc.record({ code: fc.constantFrom(...CODES), severity: severity ? fc.constant(severity) : fc.constantFrom<Warning["severity"]>("block", "warn"), message: fc.string() });

/** Each breaker flips exactly one gate from the all-pass fixture. */
const BREAKERS: Array<(i: BatchItemView) => BatchItemView> = [
  (i) => ({ ...i, origin: null }),
  (i) => ({ ...i, editor: null }),
  (i) => ({ ...i, status: "approved" }),
  (i) => ({ ...i, status: "rejected" }),
  (i) => ({ ...i, platformPostId: "p1" }),
  (i) => ({ ...i, platform: "snapchat" }),
  (i) => ({ ...i, scheduledFor: null }),
  (i) => ({ ...i, scheduledFor: new Date(NOW.getTime() - 60_000).toISOString() }),
  (i) => ({ ...i, scheduledFor: new Date(NOW.getTime() + 60_000).toISOString() }),
  (i) => ({ ...i, tiktokDraft: true }),
  (i) => ({ ...i, media: { ...i.media, hasCleanFile: false } }),
  (i) => ({ ...i, media: { ...i.media, qaWarnings: ["q"] } }),
  (i) => ({ ...i, editor: { ...i.editor!, source: "manual" } }),
  (i) => ({ ...i, editor: { ...i.editor!, approvedInEditor: false } }),
  (i) => ({ ...i, editor: { ...i.editor!, approvedInEditorAt: null } }),
  (i) => ({ ...i, editor: { ...i.editor!, flags: ["lint-error"] } }),
  (i) => ({ ...i, editor: { ...i.editor!, unknownFlags: 2 } }),
];

/** An item that passes every gate, with arbitrary harmless variation (platform, caption, time far enough ahead). */
const passingItemArb = fc
  .record({
    platform: fc.constantFrom<Platform>("instagram", "youtube", "tiktok"),
    caption: fc.string({ minLength: 1 }),
    aheadMs: fc.integer({ min: AUTO_APPROVE_LEAD_MS + 1, max: 30 * 86_400_000 }),
    source: fc.constantFrom("trade-recaps", "workout-assembly"),
    approvedAtMs: fc.integer({ min: Date.parse("2020-01-01T00:00:00Z"), max: Date.parse("2030-01-01T00:00:00Z") }),
  })
  .map(({ platform, caption, aheadMs, source, approvedAtMs }) =>
    pass({ platform, caption, title: platform === "youtube" ? "T" : null, scheduledFor: new Date(NOW.getTime() + aheadMs).toISOString() }, { source, approvedInEditorAt: new Date(approvedAtMs).toISOString() }),
  );

describe("autoApproveDecision properties", () => {
  it("the passing arbitrary really passes (sanity)", () => {
    fc.assert(fc.property(passingItemArb, (item) => autoApproveDecision(item, [], ON).approve === true));
  });

  it("at least one block warning → never approve", () => {
    fc.assert(
      fc.property(passingItemArb, fc.array(warningArb()), warningArb("block"), fc.array(warningArb()), (item, before, b, after) => {
        return autoApproveDecision(item, [...before, b, ...after], ON).approve === false;
      }),
    );
  });

  it("any single gate failing → never approve", () => {
    fc.assert(
      fc.property(passingItemArb, fc.integer({ min: 0, max: BREAKERS.length - 1 }), fc.array(warningArb()), (item, k, ws) => {
        return autoApproveDecision(BREAKERS[k]!(item), ws, ON).approve === false;
      }),
    );
  });

  it("setting off → never approve, whatever the item", () => {
    fc.assert(fc.property(passingItemArb, (item) => autoApproveDecision(item, [], { approvalCounts: false, now: NOW }).approve === false));
  });

  it("approve ⇒ !hasBlock(warnings), over random warning lists and items", () => {
    fc.assert(
      fc.property(passingItemArb, fc.array(warningArb(), { maxLength: 6 }), fc.constantFrom(...PLATFORMS), (item, ws, platform) => {
        const d = autoApproveDecision({ ...item, platform }, ws, ON);
        return !d.approve || !hasBlock(ws);
      }),
    );
  });
});
