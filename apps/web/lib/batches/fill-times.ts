import { assignSlots, type CadenceSettings, type Platform, type ScheduleItem } from "@autopilot/core";
import type { ItemChange } from "./transitions.js";
import type { BatchView } from "./types.js";

export interface FillTimesContext {
  cadence: CadenceSettings;
  timeZone: string;
  existing: Array<{ platform: Platform; scheduledFor: string }>;
  now: Date;
}

export interface FillTimesPlan {
  patches: Array<{ itemId: string; scheduledFor: string }>;
  unplaced: Array<{ itemId: string; reason: string }>;
}

/** Times for the untimed drafts, on the cadence grid around everything already timed. Pure. */
export function planFillTimes(batch: BatchView, ctx: FillTimesContext): FillTimesPlan {
  // mediaId → platform → item ids (in batch order)
  const groups = new Map<string, { pillar: string | null; byPlatform: Map<Platform, string[]> }>();
  for (const i of batch.items) {
    if (i.status !== "draft" || i.scheduledFor != null) continue;
    let g = groups.get(i.mediaId);
    if (!g) groups.set(i.mediaId, (g = { pillar: i.media.pillar, byPlatform: new Map() }));
    const ids = g.byPlatform.get(i.platform) ?? [];
    ids.push(i.id);
    g.byPlatform.set(i.platform, ids);
  }
  const patches: FillTimesPlan["patches"] = [];
  const unplaced: FillTimesPlan["unplaced"] = [];
  if (groups.size === 0) return { patches, unplaced };

  const items: ScheduleItem[] = [...groups].map(([mediaId, g]) => ({
    key: mediaId,
    ...(g.pillar ? { pillar: g.pillar } : {}),
    platforms: [...g.byPlatform.keys()],
  }));
  const timed = batch.items
    .filter((i) => i.scheduledFor != null && i.status !== "rejected" && i.status !== "failed")
    .map((i) => ({ platform: i.platform, scheduledFor: i.scheduledFor! }));

  const res = assignSlots({
    weekStart: batch.weekStart,
    items,
    cadence: ctx.cadence,
    timeZone: ctx.timeZone,
    existing: [...ctx.existing, ...timed],
    now: ctx.now,
  });

  const ids = (key: string, platform: Platform) => groups.get(key)?.byPlatform.get(platform) ?? [];
  for (const a of res.assignments) {
    const [first, ...rest] = ids(a.key, a.platform);
    if (first) patches.push({ itemId: first, scheduledFor: a.scheduledFor });
    for (const id of rest) unplaced.push({ itemId: id, reason: `duplicate: same clip already on ${a.platform} in this batch` });
  }
  for (const u of res.unplaced) for (const id of ids(u.key, u.platform)) unplaced.push({ itemId: id, reason: `${u.reason}: ${u.detail}` });
  return { patches, unplaced };
}

/** One draft→draft "edit" change per patch, ready for BatchStore.apply. */
export function fillTimesChanges(batch: BatchView, patches: FillTimesPlan["patches"]): ItemChange[] {
  const byId = new Map(batch.items.map((i) => [i.id, i]));
  return patches
    .filter((p) => byId.get(p.itemId)?.status === "draft")
    .map((p) => ({ itemId: p.itemId, from: "draft", to: "draft", eventKind: "edit", patch: { scheduled_for: p.scheduledFor } }));
}
