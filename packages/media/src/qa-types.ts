/**
 * QA issue + fix-op shapes, shared with the web app. This file must have NO imports at all: the web app
 * deep-imports it (`@autopilot/media/src/qa-types.js`) and must never pull in `exec.ts`/`probe.ts`
 * (node:child_process, node:fs). `qa.ts` and `fix.ts` re-export these names; a guard test enforces it.
 */

export interface Segment {
  start: number;
  end: number;
}

export type QaSeverity = "fix" | "info";

export type QaIssueCode =
  | "frozen-head"
  | "frozen-tail"
  | "frozen-middle"
  | "black-head"
  | "black-tail"
  | "black-middle"
  | "no-sound"
  | "loudness"
  | "silence-gaps"
  | "format"
  | "rotation"
  | "aspect"
  | "landscape"
  | "square"
  | "tall"
  | "metadata"
  | "too-long"
  /** Legacy rows only (web mapper): an old count without positions, waiting for media-recheck. */
  | "recheck";

export interface QaIssue {
  code: QaIssueCode;
  severity: QaSeverity;
  fixable: boolean;
  /** One plain sentence for the creator, no jargon. */
  detail: string;
  segments?: Segment[];
}

export type FixOp = "trim" | "remove-gaps" | "reencode" | "pad" | "loudness" | "strip";

/** Canonical order of ops in a plan (and in media_fixes.ops). */
export const FIX_OP_ORDER: readonly FixOp[] = ["trim", "remove-gaps", "reencode", "pad", "loudness", "strip"];

/** Which op fixes which issue. Issues missing here are never auto-fixed. */
export const OP_FOR_CODE: Partial<Record<QaIssueCode, FixOp>> = {
  "frozen-head": "trim",
  "frozen-tail": "trim",
  "black-head": "trim",
  "black-tail": "trim",
  "silence-gaps": "remove-gaps",
  format: "reencode",
  rotation: "reencode",
  aspect: "pad",
  loudness: "loudness",
  metadata: "strip",
};

/** Ops a bulk "Fix all" leaves off unless asked for by name (removing gaps changes the pacing). */
export const OPT_IN_OPS: readonly FixOp[] = ["remove-gaps"];
