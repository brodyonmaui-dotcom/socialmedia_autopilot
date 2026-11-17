import type { SnapshotPost } from "../brief.js";
import { adaptLane, PATTERN_LABEL, type AdaptLane, type AutoPattern } from "./patterns.js";

/**
 * Code-written notes for an idea (no AI, zero cost). "About" says what the reference is, quoting only
 * its hook line. "Adapt" keeps the reference's structure and swaps the substance for his own, in the
 * calm voice of docs/voice.md. Trading lines stay on his process and psychology: no tickers, setups,
 * calls or results.
 */

const KIND: Record<SnapshotPost["mediaType"], string> = { reel: "A reel", video: "A video", carousel: "A carousel", image: "A post" };

const times = (ratio: number) => `${ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10}×`;

export function aboutFromCode(
  media: { kind: SnapshotPost["mediaType"] | string | null; hookLine: string; ratio: number; pattern: AutoPattern },
  creator: { handle: string; displayName?: string | null },
): string {
  const kind = KIND[(media.kind ?? "image") as SnapshotPost["mediaType"]] ?? "A post";
  const who = creator.displayName?.trim() || `@${creator.handle}`;
  const stop = /[.!?…]$/u.test(media.hookLine) ? "" : "."; // no “…red.”. double stop
  return `${kind} by ${who} that opens with a ${PATTERN_LABEL[media.pattern]} hook: “${media.hookLine}”${stop} It got ${times(media.ratio)} their usual engagement.`;
}

const ADAPT: Record<AutoPattern, Record<AdaptLane, string>> = {
  question: {
    gym: "Open with your own question about training that your viewer already half-believes, like whether more volume really beats better reps. Answer it from your own sessions this month. Don't reuse their wording or example.",
    trading:
      "Open with a question about trading psychology your viewer already half-believes, like why the plan feels easy until a trade is open. Answer it from your own journal week, process only, no setups or numbers. Don't reuse their wording or example.",
    other:
      "Open with a question about routine or balancing college and training that your viewer already half-believes. Answer it plainly from your own week. Don't reuse their wording or example.",
  },
  list: {
    gym: "Keep the number-first structure: a small, honest count (three things, two mistakes) from your own training, one short line each. Pick items you actually changed, not a generic list. Don't reuse their items.",
    trading:
      "Keep the number-first structure: two or three rules or mistakes from your own process, one line each, with the honest reason you have them. No setups, tickers or results. Don't reuse their items.",
    other: "Keep the number-first structure: a short count of habits from your own week, one line each, the boring ones included. Don't reuse their items.",
  },
  contrarian: {
    gym: "Use the same calm push-back shape: name a gym habit most people take for granted, then say plainly what you do instead and why. No dunking on anyone. Don't reuse their claim.",
    trading:
      "Use the same calm push-back shape: name a belief about discipline or emotions in trading, then say what you've found in your own journal instead. Your process only, never a call. Don't reuse their claim.",
    other: "Use the same calm push-back shape: name a common belief about motivation or routine, then say quietly what has worked for you instead. Don't reuse their claim.",
  },
  "how-to": {
    gym: "Keep the how-to frame but make it your own method: one cue or fix you actually use, shown once, explained in one or two plain sentences. Don't copy their steps.",
    trading:
      "Keep the how-to frame for your process, not a setup: how you prep, journal or step away after a loss, in one or two plain sentences. Don't copy their steps.",
    other: "Keep the how-to frame with one small thing from your own routine, like how you fit training around classes, said in one or two plain sentences. Don't copy their steps.",
  },
  story: {
    gym: "Tell a short story from your own training in the same shape: what you used to do, the moment it changed, what you do now. One honest beat each, self-roast welcome. Don't borrow their story.",
    trading:
      "Tell a short story from your own trading in the same shape: the mistake you used to repeat, the day it clicked, what you do now. Psychology only, no numbers you don't have. Don't borrow their story.",
    other: "Tell a short story from your own week in the same shape: before, the moment, after. Keep it understated and true. Don't borrow their story.",
  },
  challenge: {
    gym: "Use the day-N frame only for something you are really doing: start your own small training challenge, say the rules on day one, and report honestly, including the bad days. Don't copy their challenge.",
    trading:
      "Use the day-N frame only for a process habit you are really practicing, like journaling every session. Say the rule, then check in honestly. No results promised. Don't copy their challenge.",
    other: "Use the day-N frame only for a habit you are really starting. Day one is the rules; later days are honest check-ins. Don't copy their challenge.",
  },
  "result-first": {
    gym: "Lead with a real result of your own (only a number you actually have), then the unglamorous process behind it. If you don't have the number yet, leave a placeholder and fill it in. Don't reuse their result.",
    trading:
      "Lead with a process result, never money: a week of following every rule, or the first time you stepped away on time. Then say what made it possible. Don't reuse their result.",
    other: "Lead with a small real outcome from your own routine, then the boring steps that got you there. Only facts you actually have. Don't reuse their result.",
  },
  pov: {
    gym: "Use the POV frame for a moment every lifter knows from your own sessions, played straight and a little dry. Don't reuse their scenario.",
    trading: "Use the POV frame for a feeling every trader knows, like watching a trade you planned to close, from your own experience. No setups. Don't reuse their scenario.",
    other: "Use the POV frame for an everyday moment from balancing college and training. Keep it dry. Don't reuse their scenario.",
  },
  statement: {
    gym: "Keep the one-line deadpan shape: an honest, understated statement about your own training, maybe with a quiet self-roast. Don't reuse their line.",
    trading: "Keep the one-line deadpan shape: an honest statement about your own trading mindset, no numbers you don't have, no calls. Don't reuse their line.",
    other: "Keep the one-line deadpan shape: an honest, understated line about your own day. Don't reuse their line.",
  },
};

export function adaptFromCode(pattern: AutoPattern, pillar: string | null | undefined): string {
  return ADAPT[pattern][adaptLane(pillar)];
}

/** The fill-in structure stored on hooks rows (hooks.template). Square brackets = his words. */
export const HOOK_TEMPLATES: Record<AutoPattern, string> = {
  question: "Why does [thing people believe] feel true until you [moment it breaks]?",
  list: "[Small number] [things/mistakes] I [changed/stopped] in [my training/my process].",
  contrarian: "Most people don't need more [thing]. They need better [thing].",
  "how-to": "How I [do one specific thing] without [the usual pain].",
  story: "I used to [old habit]. Then [moment]. Now I [new habit].",
  challenge: "Day [N] of [habit I'm really doing]: [honest check-in].",
  "result-first": "[Real result I have], and the boring part nobody films.",
  pov: "POV: [moment every lifter/trader knows].",
  statement: "[Honest, understated line about today]…",
};

export const ALL_ADAPT_TEXTS = (): string[] => Object.values(ADAPT).flatMap((r) => Object.values(r));
