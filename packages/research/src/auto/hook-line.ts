import { lintText } from "../voice-lint.js";

export const HOOK_LINE_MAX = 140;

/**
 * The only text we keep from another creator: the first sentence/line of the caption, cleaned of
 * hashtags, @mentions, links and emoji runs, at most 140 chars. null when nothing usable is left, or
 * when the line fails the location lint (we never store a place name, not even someone else's).
 */
export function hookLine(caption: string | null | undefined, blocklist?: string[]): string | null {
  if (!caption) return null;
  const line = caption.split(/\r?\n/).find((l) => l.trim()) ?? "";
  let t = line
    .replace(/https?:\/\/\S+|\bwww\.\S+/gi, " ")
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ")
    .replace(/(^|\s)@[\w.]+/gu, " ")
    // emoji runs (incl. ZWJ sequences, skin tones and variation selectors)
    .replace(/(?:[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️])+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // first sentence: cut after the first . ! ? (or …) that is followed by more text
  const m = t.match(/^(.+?[.!?…])\s+\S/u);
  if (m) t = m[1]!;
  t = t.replace(/^[\s\-–—:|,.]+|[\s\-–—:|,]+$/gu, "").trim();
  if ([...t].length > HOOK_LINE_MAX) t = [...t].slice(0, HOOK_LINE_MAX - 1).join("").trimEnd() + "…";
  if (!/[\p{L}]{2,}/u.test(t)) return null;
  if (t.split(/\s+/).length < 2) return null;
  const privacy = lintText({ text: t, kind: "hook", blocklist }).issues.some((i) => i.rule.startsWith("privacy."));
  return privacy ? null : t;
}
