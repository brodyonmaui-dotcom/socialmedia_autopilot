/** Deterministic rotation so the same comment always gets the same pick (replays, tests, shadow vs live). */

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 seeded from fnv1a(seed): values in [0, 1). */
export function seededRng(seed: string): () => number {
  let a = fnv1a(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RotationHistory {
  /** Last 3 replies sent on the platform. */
  recent: string[];
  /** Replies sent to this author in the last 30 days. */
  toAuthor: string[];
  /** Texts used more than twice in the last 24 h. */
  overused: Set<string>;
}

export const normaliseReply = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

export function pickReply(candidates: string[], history: RotationHistory, seed: string): string | null {
  const excluded = new Set<string>([...history.recent, ...history.toAuthor, ...history.overused].map(normaliseReply));
  const seen = new Set<string>();
  const left: string[] = [];
  for (const c of candidates) {
    const key = normaliseReply(c);
    if (!key || excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    left.push(c.trim());
  }
  if (left.length === 0) return null;
  const i = Math.floor(seededRng(seed)() * left.length);
  return left[Math.min(i, left.length - 1)] ?? null;
}
