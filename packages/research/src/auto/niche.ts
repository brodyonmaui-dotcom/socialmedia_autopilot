import nicheData from "../../data/niche-prompts.json" with { type: "json" };
import type { Pillar } from "../types.js";
import { adaptLane, type AdaptLane } from "./patterns.js";

export interface NichePrompt {
  key: string;
  title: string;
  hook: string;
  about: string;
  adapt: string;
}
export type NichePrompts = Record<AdaptLane, NichePrompt[]>;

export interface NicheIdea extends NichePrompt {
  sourceKey: string;
  lane: AdaptLane;
  /** The pillar stored on the idea ("other" → lifestyle). */
  pillar: Pillar;
}

/** packages/research/data/niche-prompts.json (bundled with the package). */
export function loadNichePrompts(): NichePrompts {
  return { gym: nicheData.gym, trading: nicheData.trading, other: nicheData.other };
}

export const nicheSourceKey = (lane: AdaptLane, key: string) => `niche-${lane}-${key}`;

/** FNV-1a, so the rotation is stable across runs and machines. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Deterministic rotation: each lane's list is started at an offset derived from `weekSeed`, the lanes
 * take turns, and any prompt whose source_key is already present is skipped, so a run never repeats an
 * idea and the same seed + same DB state always picks the same ones. Returns up to `count` (default 3).
 */
export function nicheIdeas(
  pillars: ReadonlyArray<Pillar | AdaptLane | string>,
  weekSeed: string,
  existingKeys: ReadonlySet<string>,
  opts: { count?: number; prompts?: NichePrompts } = {},
): NicheIdea[] {
  const prompts = opts.prompts ?? loadNichePrompts();
  const count = opts.count ?? 3;
  const lanes = [...new Set(pillars.map((p) => adaptLane(p)))];
  const queues = lanes.map((lane) => {
    const list = prompts[lane] ?? [];
    const start = list.length ? hash(`${weekSeed}:${lane}`) % list.length : 0;
    return { lane, items: list.map((_, i) => list[(start + i) % list.length]!).filter((p) => !existingKeys.has(nicheSourceKey(lane, p.key))) };
  });
  const out: NicheIdea[] = [];
  for (let round = 0; out.length < count && queues.some((q) => q.items.length > round); round++) {
    for (const q of queues) {
      const p = q.items[round];
      if (!p || out.length >= count) continue;
      out.push({ ...p, lane: q.lane, pillar: q.lane === "other" ? "lifestyle" : q.lane, sourceKey: nicheSourceKey(q.lane, p.key) });
    }
  }
  return out;
}
