/** Pure view logic for the Approve-all "judge" chip (stream B result, or the line's warnings until it is wired). */

export type JudgeCheck = { id: string; level: "block" | "warn" | "info" | "ok" | string; message: string };
export type JudgeResult = { score: number; checks: JudgeCheck[] };
type W = { code: string; severity: string; message: string };

export type JudgeChip = { tone: "danger" | "warn" | "neutral"; label: string; detail: string[] };

/**
 * Chip for one line. With a judge result: "Score 82" plus the block/warn messages; tone danger if any block,
 * warn if any warn, else neutral. Without one: derived from `warnings` (block red, warn amber), no score;
 * null when there is nothing to say.
 */
export function judgeChip(judge: JudgeResult | null | undefined, warnings: readonly W[] = []): JudgeChip | null {
  const items = judge
    ? judge.checks.filter((c) => c.level === "block" || c.level === "warn").map((c) => ({ level: c.level, message: c.message }))
    : warnings.filter((w) => w.severity === "block" || w.severity === "warn").map((w) => ({ level: w.severity, message: w.message }));
  const blocks = items.filter((i) => i.level === "block").length;
  const warns = items.length - blocks;
  const tone = blocks ? "danger" : warns ? "warn" : "neutral";
  const parts = [blocks ? `${blocks} block${blocks === 1 ? "" : "s"}` : "", warns ? `${warns} warning${warns === 1 ? "" : "s"}` : ""].filter(Boolean);
  if (judge) {
    const score = `Score ${Math.round(judge.score)}`;
    return { tone, label: parts.length ? `${score} · ${parts.join(", ")}` : score, detail: items.map((i) => i.message) };
  }
  if (!items.length) return null;
  return { tone, label: parts.join(", "), detail: items.map((i) => i.message) };
}
