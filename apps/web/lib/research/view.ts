/** Pure view logic for the /research pages (labels, tones, hero, tabs). No I/O. */

type Line = { text: string; style: "solid" | "stroke" | "serif" };
type Tone = "neutral" | "accent" | "warn" | "danger";

export type ResearchCounts = { ideas: number; hooks: number; creators: number; activeCreators: number };
export type ResearchTab = "overview" | "creators" | "ideas" | "hooks";

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const two = (n: number) => String(Math.max(0, n)).padStart(2, "0");

/** "Research / this *week* / 03" with the idea count as the big number. */
export function heroLines(c: ResearchCounts): Line[] {
  return [
    { text: "Research", style: "stroke" },
    { text: "this week", style: "serif" },
    { text: two(c.ideas), style: "solid" },
  ];
}

export function heroNote(c: ResearchCounts): string {
  return `${plural(c.ideas, "idea")} · ${plural(c.hooks, "hook")} · ${c.activeCreators}/${plural(c.creators, "creator")} active`;
}

export function researchTabs(current: ResearchTab) {
  return [
    { href: "/research", label: "Overview", active: current === "overview" },
    { href: "/research/creators", label: "Creators", active: current === "creators" },
    { href: "/research/ideas", label: "Ideas", active: current === "ideas" },
    { href: "/research/hooks", label: "Hooks", active: current === "hooks" },
  ];
}

const STAGE: Record<string, { label: string; tone: Tone }> = {
  idea: { label: "Idea", tone: "neutral" },
  scripted: { label: "Scripted", tone: "accent" },
  filmed: { label: "Filmed", tone: "accent" },
  posted: { label: "Posted", tone: "neutral" },
  dropped: { label: "Dropped", tone: "neutral" },
};

/** Stage as a Badge (no green; scripted/filmed = ready to move = accent). */
export function stageBadge(stage: string): { label: string; tone: Tone } {
  return STAGE[stage] ?? { label: stage, tone: "neutral" };
}

/** Mono meta line for a RevealList row (caps happens in the row). */
export function ideaMeta(i: { pillar: string | null; hook: string }): string {
  const hook = i.hook.trim();
  return [i.pillar ?? "no pillar", hook ? `"${hook}"` : null].filter(Boolean).join(" · ").toUpperCase();
}

export function hookMeta(h: { pillar: string | null; timesUsed: number; source: string }, patterns: string[]): string {
  return [h.pillar ?? "no pillar", patterns.join("+") || null, `used ${h.timesUsed}×`, h.source === "own" ? "mine" : "creator pattern"]
    .filter(Boolean)
    .join(" · ")
    .toUpperCase();
}

export function creatorSubtitle(c: { pillar: string | null; followers: number | null; notes: string }): string {
  return [c.pillar ?? "no pillar", c.followers !== null ? c.followers.toLocaleString("en-US") : null, c.notes || null].filter(Boolean).join(" · ");
}

export const creatorPlatform = (p: string): "instagram" | "youtube" | "tiktok" | "snapchat" =>
  p === "youtube" || p === "tiktok" || p === "snapchat" ? p : "instagram";
