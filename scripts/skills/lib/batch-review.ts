import type { BatchDraft, DraftCheck } from "./batch-draft.js";

/**
 * The review sheet for a drafted batch: one row per clip with where it lives, the per-platform
 * text, and what the creator still has to answer. Pure: the CLI feeds it clip info from the DB
 * when reachable. Output goes to logs/ (gitignored), next to the draft.
 */

export interface ClipInfo {
  sourcePath: string | null;
  durationS: number | null;
  status: string | null;
}

const PLATFORMS = ["instagram", "tiktok", "youtube"] as const;
const YT_MUSIC_LIMIT_S = 60; // research.md: Shorts over 60 s with licensed music get blocked

/** Folder + file relative to "Ready To Post", or just the last two segments. Never the home dir. */
export function shortSource(p: string | null): string {
  if (!p) return "(not in library / DB not reachable)";
  const parts = p.split(/[\\/]/).filter(Boolean);
  const i = parts.findIndex((s) => /^ready to post/i.test(s));
  const rel = i >= 0 ? parts.slice(i + 1) : parts.slice(-2);
  const file = rel.pop()!;
  return `${rel.join("/")}${rel.length ? "/" : ""}\`${file}\``;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n+/g, " / ").trim() || "—";

export function openQuestions(draft: BatchDraft, check: DraftCheck, idx: number, clip: ClipInfo | undefined): string[] {
  const it = draft.items[idx]!;
  const q: string[] = [];
  const texts = PLATFORMS.flatMap((p) => [it.posts[p]?.caption ?? "", it.posts[p]?.title ?? ""]).join("\n");
  for (const ph of new Set(texts.match(/\{\{[^}]+\}\}/g) ?? [])) q.push(`Fill in ${ph} (real number only).`);
  for (const f of check.findings.filter((f) => f.item === idx)) q.push(`${f.severity === "error" ? "Fix" : "Check"} (${f.platform} ${f.field}): ${f.message}`);
  if (clip?.status === "archived") q.push("Clip is archived (source file missing): pick another clip.");
  if (it.posts.youtube && clip?.durationS != null && clip.durationS > YT_MUSIC_LIMIT_S) {
    q.push(`${Math.round(clip.durationS)} s: if it has licensed music, YouTube blocks Shorts over ${YT_MUSIC_LIMIT_S} s, so trim or drop YT.`);
  }
  if (it.posts.tiktok?.tiktokDraft) q.push("TikTok goes as an inbox draft: finish it (sound) in the TikTok app.");
  const name = clip?.sourcePath?.split(/[\\/]/).pop() ?? "";
  const nums = (name.replace(/\.\w+$/, "").match(/\b\d{2,4}\b/g) ?? []).filter((n) => texts.includes(n));
  for (const n of new Set(nums)) q.push(`The text uses "${n}" from the file name: confirm it's right.`);
  if (it.pillar === "trading" && !/\{\{/.test(texts) && /P\/L|\$\d/.test(texts)) q.push("Confirm the P/L numbers are exactly what you gave.");
  q.push("Watch it once: does the text match what the clip shows? Anything in frame that names a place?");
  return q;
}

export function buildReview(draft: BatchDraft, check: DraftCheck, clips: Map<string, ClipInfo>, now = new Date()): string {
  const lines = [
    `# Batch ${draft.weekStart}: review (draft, check only)`,
    "",
    `Generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC by \`pnpm skill:weekly-batch review\`. ` +
      `Check: **${check.ok ? "OK" : "FAIL"}**, ${check.posts} post(s), ${check.errors} error(s), ${check.warnings} warning(s)` +
      `${check.ok && !check.creatable ? ", no times yet (not creatable)" : ""}. Nothing was created.`,
    "",
    "| # | Clip (folder / file) | Instagram | TikTok | YouTube (title · description) | What I need from you |",
    "|---|---|---|---|---|---|",
  ];
  draft.items.forEach((it, i) => {
    const clip = clips.get(it.mediaId);
    const dur = clip?.durationS != null ? ` (${Math.round(clip.durationS)} s)` : "";
    const yt = it.posts.youtube ? `${it.posts.youtube.title ?? "(no title)"} · ${it.posts.youtube.caption}` : "—";
    lines.push(
      `| ${i + 1} | ${cell(shortSource(clip?.sourcePath ?? null) + dur)}${it.label ? `<br>${cell(it.label)}` : ""} | ${cell(it.posts.instagram?.caption ?? "—")} | ${cell(it.posts.tiktok?.caption ?? "—")} | ${cell(yt)} | ${openQuestions(draft, check, i, clip).map(cell).join("<br>")} |`,
    );
  });
  return lines.join("\n") + "\n";
}

/** logs/batch-2026-11-16.json → logs/batch-2026-11-16-review.md */
export function reviewPathFor(draftPath: string): string {
  return draftPath.replace(/\.json$/i, "") + "-review.md";
}
