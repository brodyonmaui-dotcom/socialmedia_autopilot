import { lintText } from "../voice-lint.js";
import type { Pillar } from "../types.js";

/**
 * Optional AI notes (decisions.md §4 addendum 2026-11-16): Haiku rewrites "what it's about" and "how to
 * adapt it" in his voice. Off by default; needs the setting research.aiNotes AND env RESEARCH_AI_NOTES=1,
 * and stays inside a monthly token budget counted in ai_token_usage. Anything that fails the checks
 * below is discarded and the code-written notes stay.
 */

export const AI_NOTES_PURPOSE = "research-notes";
/** Default monthly budget. At Haiku 5.5's $0.10 in / $0.50 out per M tokens (docs/research.md) even all-output is $0.15. */
export const DEFAULT_AI_MONTHLY_TOKENS = 300_000;
/** Rough per-idea cost used for the pre-check (system prompt + inputs + two short paragraphs). */
export const AI_NOTE_ESTIMATE_TOKENS = 1_500;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** True when `estimate` more tokens still fit in `budget` this month. A non-positive budget never spends. */
export function canSpend(usage: TokenUsage, budget: number, estimate: number): boolean {
  if (!Number.isFinite(budget) || budget <= 0) return false;
  return usage.inputTokens + usage.outputTokens + Math.max(0, estimate) <= budget;
}

export interface NoteRequest {
  kind: string | null;
  creatorHandle: string;
  pillar: Pillar | null;
  pattern: string;
  /** The only text from the other creator the model ever sees or may quote. */
  hookLine: string;
  ratio: number;
  codeAbout: string;
  codeAdapt: string;
}
export interface NoteResult extends TokenUsage {
  about: string;
  adapt: string;
}
export interface NoteWriter {
  /** null = refused / unparsed / error (the caller keeps the code notes; tokens may still be reported). */
  write(req: NoteRequest): Promise<{ notes: NoteResult | null; usage: TokenUsage }>;
}

const QUOTED = /[“"]([^”"]{3,})[”"]/g;

/** Returns why AI notes must be discarded, or null when they're fine to store. */
export function checkAiNotes(req: NoteRequest, out: { about: string; adapt: string }, blocklist?: string[]): string | null {
  for (const [name, text] of [
    ["about", out.about],
    ["adapt", out.adapt],
  ] as const) {
    const t = text.trim();
    if (!t) return `${name}: empty`;
    if ([...t].length > 600) return `${name}: too long`;
    const lint = lintText({ text: t, kind: "caption", pillar: req.pillar, blocklist });
    const bad = lint.issues.find((i) => i.severity === "error");
    if (bad) return `${name}: ${bad.rule}`;
    // No quoting beyond the hook line: every quoted span must come from it.
    for (const m of t.matchAll(QUOTED)) {
      if (!req.hookLine.toLowerCase().includes(m[1]!.trim().toLowerCase())) return `${name}: quotes text that isn't the hook line`;
    }
  }
  return null;
}

/** Test/dev writer: echoes the code notes with a light rewrite and fixed token counts. */
export function createFakeNoteWriter(opts: { about?: (r: NoteRequest) => string; adapt?: (r: NoteRequest) => string; tokens?: TokenUsage } = {}): NoteWriter & { calls: NoteRequest[] } {
  const calls: NoteRequest[] = [];
  return {
    calls,
    async write(req) {
      calls.push(req);
      const usage = opts.tokens ?? { inputTokens: 700, outputTokens: 150 };
      return { notes: { about: opts.about?.(req) ?? req.codeAbout, adapt: opts.adapt?.(req) ?? `In your words: ${req.codeAdapt}`, ...usage }, usage };
    },
  };
}

export const firstOfMonthUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
