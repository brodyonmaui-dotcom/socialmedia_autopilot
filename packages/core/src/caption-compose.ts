/**
 * F26 stream B: deterministic caption composer (no AI, no network). hook (+ body) (+ soft closer) + hashtag tail from
 * hashtags.ts, in the voice of docs/voice.md. Avoids any caption too similar (word-trigram Jaccard >= 0.6) to the
 * platform's recent captions; returns null when nothing fresh is left (the caller leaves the caption empty).
 */
import { CAPTION_BANK, contextTopicFor, type CaptionGroup } from "./caption-templates.js";
import { extractHashtags, pickHashtags } from "./hashtags.js";
import type { Platform } from "./types.js";

export const SIMILAR_WARN = 0.6;
export const SIMILAR_BLOCK = 0.8;

const h32 = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** Caption text without hashtags, lowercased words only. */
export function captionWords(text: string): string[] {
  return text
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Word trigrams (words 1-2 long texts fall back to unigrams so short captions still compare). */
function grams(words: string[]): Set<string> {
  const out = new Set<string>();
  if (words.length < 3) {
    for (const w of words) out.add(w);
    return out;
  }
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/** Word-trigram Jaccard similarity of two captions, hashtags ignored. 0 = nothing shared, 1 = same words. */
export function captionSimilarity(a: string, b: string): number {
  const A = grams(captionWords(a));
  const B = grams(captionWords(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export function maxSimilarity(caption: string, recent: Iterable<string>): number {
  let max = 0;
  for (const r of recent) max = Math.max(max, captionSimilarity(caption, r));
  return max;
}

export interface TemplateCaptionInput {
  group: CaptionGroup;
  platform: Platform;
  /** Folder + file name of the clip ("Upper body sets"); picks body lines only when it names a topic. */
  clipContext?: string | null;
  /** Captions this platform used lately (30 days): similar ones are avoided. */
  recentCaptions?: Iterable<string>;
  /** Tag sets of the platform's last posts. */
  recentHashtagSets?: ReadonlyArray<readonly string[]>;
  seed: string;
}

/** The text part (no tags) for one attempt. */
function compose(i: TemplateCaptionInput, attempt: number, preferFreshHook: Set<string> | null): string {
  const bank = CAPTION_BANK[i.group];
  const topic = contextTopicFor(i.clipContext);
  const base = `${i.seed}|${i.platform}|${attempt}`;
  const pool = preferFreshHook ? bank.hooks.filter((h) => !preferFreshHook.has(h)) : bank.hooks;
  const hooks = pool.length ? pool : bank.hooks;
  const hook = hooks[h32(base + "h") % hooks.length]!;
  if (i.platform === "tiktok" || i.platform === "snapchat") return hook; // one-liner version
  const useTopic = topic && topic.group === i.group && h32(base + "t") % 5 < 3; // 60 % of captions name the topic when the clip says so
  const bodies = useTopic ? topic!.bodies : bank.bodies;
  const body = bodies[h32(base + "b") % bodies.length]!;
  const parts = [hook, body];
  // soft closer on ~1 in 3 Instagram captions, never on YouTube descriptions
  if (i.platform === "instagram" && h32(base + "c") % 3 === 0) parts.push(bank.ctas[h32(base + "k") % bank.ctas.length]!);
  return parts.join("\n");
}

/** Hooks already used in the recent captions (so a fresh hook is preferred on the first pass). */
function usedHooks(group: CaptionGroup, recent: string[]): Set<string> {
  const out = new Set<string>();
  for (const h of CAPTION_BANK[group].hooks) if (recent.some((r) => r.includes(h))) out.add(h);
  return out;
}

/**
 * Deterministic: same input gives the same caption. Hashtags are appended as the tail (`\n\n#a #b #c`), so the first
 * line works alone. null when every attempt was too similar to a recent caption.
 */
export function composeTemplateCaption(i: TemplateCaptionInput): string | null {
  const recent = [...(i.recentCaptions ?? [])];
  const used = usedHooks(i.group, recent);
  const tags = pickHashtags(i.group, i.platform, i.seed, i.recentHashtagSets ?? []);
  const tail = tags.length ? `\n\n${tags.join(" ")}` : "";
  for (const fresh of [true, false]) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const text = compose(i, attempt, fresh ? used : null);
      if (maxSimilarity(text, recent) < SIMILAR_WARN) return text + tail;
    }
  }
  return null;
}

/** Tag sets (`#a #b`) of already-written captions, newest first as given. */
export function hashtagSetsOf(captions: Iterable<string>): string[][] {
  return [...captions].map((c) => extractHashtags(c));
}
