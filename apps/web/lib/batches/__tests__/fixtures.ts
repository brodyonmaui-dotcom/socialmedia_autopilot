import { countByStatus, deriveFlags, type BatchItemView, type BatchView } from "../types.js";

/** A fixed "now" for tests; default item times sit a few days after it. */
export const NOW = new Date("2026-11-13T12:00:00.000Z");

export type ItemOverrides = Partial<Omit<BatchItemView, "media">> & { media?: Partial<BatchItemView["media"]> };

let seq = 0;

/** A clean, approvable draft. `editable`/`handedOff` follow status + platformPostId unless overridden. */
export function makeItem(overrides: ItemOverrides = {}): BatchItemView {
  seq++;
  const { media, ...rest } = overrides;
  const base: Omit<BatchItemView, "editable" | "handedOff"> = {
    id: `item-${seq}`,
    batchId: "batch-1",
    mediaId: `media-${seq}`,
    platform: "instagram",
    caption: `Quiet morning session, notes on the setup ${seq}.`,
    title: null,
    scheduledFor: "2026-11-18T15:00:00.000Z",
    status: "draft",
    tiktokDraft: false,
    platformPostId: null,
    approvedAt: null,
    warnings: [],
    ...rest,
    media: { label: `clip ${seq}`, durationS: 30, pillar: null, hasCleanFile: true, qaWarnings: [], ...media },
  };
  return { ...deriveFlags(base), ...base, ...pick(rest) };
}

function pick(o: Partial<BatchItemView>): Partial<Pick<BatchItemView, "editable" | "handedOff">> {
  const out: Partial<Pick<BatchItemView, "editable" | "handedOff">> = {};
  if (o.editable !== undefined) out.editable = o.editable;
  if (o.handedOff !== undefined) out.handedOff = o.handedOff;
  return out;
}

export function makeBatch(items: BatchItemView[], overrides: Partial<Omit<BatchView, "items" | "counts">> = {}): BatchView {
  const status = items.some((i) => i.status !== "draft" && i.status !== "rejected") ? "approved" : "draft";
  return { id: "batch-1", weekStart: "2026-11-16", status, approvedAt: null, ...overrides, items, counts: countByStatus(items) };
}
