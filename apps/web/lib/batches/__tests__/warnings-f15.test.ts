import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE } from "@autopilot/core";
import { planTransition } from "../transitions.js";
import { computeWarnings, type WarningContext } from "../warnings.js";
import type { BatchItemView, EditorMeta, Warning } from "../types.js";
import { parseEditorMeta } from "../types.js";
import { makeBatch, makeItem, NOW } from "./fixtures.js";

const ctx = (): WarningContext => ({ now: NOW, cadence: DEFAULT_CADENCE, timeZone: "UTC", existing: [], blocklist: [] });
const one = (item: BatchItemView): Warning[] => computeWarnings([item], ctx()).get(item.id) ?? [];
const codes = (ws: Warning[]) => ws.map((w) => w.code);
const editor = (flags: EditorMeta["flags"] = []): EditorMeta => ({ source: "CapCut", pillar: null, when: "today", earliest: null, approvedInEditor: true, flags });

describe("F15 warnings", () => {
  it("caption.missing blocks an empty Instagram / TikTok caption", () => {
    for (const platform of ["instagram", "tiktok"] as const) {
      const ws = one(makeItem({ platform, caption: "   " }));
      expect(ws.find((w) => w.code === "caption.missing")).toMatchObject({ severity: "block", field: "caption" });
    }
  });

  it("caption.missing blocks a YouTube item with an empty title or an empty caption", () => {
    const noTitle = one(makeItem({ platform: "youtube", title: "", caption: "Setup notes for the morning." }));
    expect(noTitle.filter((w) => w.code === "caption.missing")).toEqual([expect.objectContaining({ field: "title", severity: "block" })]);
    const noCaption = one(makeItem({ platform: "youtube", title: "Morning setup", caption: "" }));
    expect(noCaption.filter((w) => w.code === "caption.missing")).toEqual([expect.objectContaining({ field: "caption" })]);
  });

  it("never on Snapchat", () => {
    expect(codes(one(makeItem({ platform: "snapchat", caption: "" })))).not.toContain("caption.missing");
  });

  it("caption.missing blocks approve through planTransition (and approve-all skips it)", () => {
    const empty = makeItem({ caption: "", origin: "editor", editor: editor(["needs-caption"]) });
    const ok = makeItem();
    const batch = makeBatch([empty, ok]);
    const ws = computeWarnings(batch.items, ctx());
    for (const i of batch.items) i.warnings = ws.get(i.id) ?? [];
    const plan = planTransition(batch, { kind: "approve", itemIds: [empty.id] }, NOW);
    expect(plan).toMatchObject({ ok: false, reason: "needs a caption", itemId: empty.id });
    const all = planTransition(batch, { kind: "approve-all" }, NOW);
    expect(all.ok && all.changes.map((c) => c.itemId)).toEqual([ok.id]);
    expect(all.ok && all.skipped).toEqual([{ itemId: empty.id, reasons: ["needs a caption"] }]);
  });

  it("sound.in-app is a warn for the editor flag add-sound-in-app (approve still allowed)", () => {
    const item = makeItem({ origin: "editor", editor: editor(["add-sound-in-app"]) });
    const ws = one(item);
    expect(ws.find((w) => w.code === "sound.in-app")).toMatchObject({ severity: "warn" });
    item.warnings = ws;
    expect(planTransition(makeBatch([item]), { kind: "approve", itemIds: [item.id] }, NOW).ok).toBe(true);
  });

  it("tiktok.draft-limit is a warn; editor flags are ignored on weekly items", () => {
    expect(one(makeItem({ platform: "tiktok", origin: "editor", editor: editor(["tiktok-draft-limit"]) })).find((w) => w.code === "tiktok.draft-limit")).toMatchObject({ severity: "warn" });
    expect(codes(one(makeItem({ origin: null, editor: editor(["add-sound-in-app", "tiktok-draft-limit"]) })))).toEqual([]);
  });

  it("time.missing uses the editor wording on editor items only", () => {
    expect(one(makeItem({ scheduledFor: null, origin: "editor", editor: editor(["no-slot"]) })).find((w) => w.code === "time.missing")?.message).toBe(
      "No free slot today — move to tomorrow",
    );
    expect(one(makeItem({ scheduledFor: null })).find((w) => w.code === "time.missing")?.message).toBe("no time set");
  });
});

describe("parseEditorMeta", () => {
  it("reads trial.editor and drops unknown flags", () => {
    expect(parseEditorMeta({ editor: { source: "CapCut", pillar: "gym", when: "today", earliest: null, approvedInEditor: true, flags: ["needs-caption", "nope", "needs-caption"] } })).toEqual({
      source: "CapCut",
      pillar: "gym",
      when: "today",
      earliest: null,
      approvedInEditor: true,
      flags: ["needs-caption"],
    });
  });
  it("accepts the ingest's ISO approval instant as approvedInEditor", () => {
    expect(parseEditorMeta({ editor: { approvedInEditor: "2098-01-01T00:00:00Z", flags: [] } })?.approvedInEditor).toBe(true);
    expect(parseEditorMeta({ editor: { approvedInEditor: false } })?.approvedInEditor).toBe(false);
  });
  it("is null without an editor object", () => {
    expect(parseEditorMeta(null)).toBeNull();
    expect(parseEditorMeta({ tiktokDraft: true })).toBeNull();
    expect(parseEditorMeta({ editor: [] })).toBeNull();
  });
});
