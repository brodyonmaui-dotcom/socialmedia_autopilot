/**
 * Pure view logic for the v3 Research screens (Ideas, Hooks, Creators, Already used). No I/O.
 * Pages pass loader rows in; components get display-ready strings out.
 */
import { allowedMoves, IDEA_STAGES, PILLARS, type IdeaStage, type Pillar } from "@autopilot/research";

export type ResearchTabId = "ideas" | "hooks" | "creators" | "used";
export type SourceFilter = "creator" | "niche" | "script" | "manual";

/** The subset of IdeaCard the view needs (keeps tests free of DB shapes). */
export interface IdeaLike {
  id: string;
  title: string;
  source: string;
  stage: string;
  pillar: string | null;
  hook: string;
  about: string;
  adapt: string;
  script: string;
  referenceUrl: string | null;
  creatorHandle: string | null;
  usedAt: string | null;
}

export interface HookLike {
  id: string;
  text: string;
  template: string;
  source: string;
  pillar: string | null;
  referenceUrl: string | null;
  creatorHandle: string | null;
  usedAt: string | null;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------- tabs and filters ----------

export const TAB_HREF: Record<ResearchTabId, string> = {
  ideas: "/research",
  hooks: "/research/hooks",
  creators: "/research/creators",
  used: "/research/used",
};

export function researchTabs(current: ResearchTabId, counts: { ideas: number; hooks: number; creators: number; used: number }) {
  const label: Record<ResearchTabId, string> = { ideas: "Ideas", hooks: "Hooks", creators: "Creators", used: "Already used" };
  return (Object.keys(TAB_HREF) as ResearchTabId[]).map((id) => ({ href: TAB_HREF[id], label: label[id], count: counts[id], active: id === current }));
}

const SOURCE_LABEL: Record<SourceFilter, string> = { creator: "From creators", niche: "Your niche", script: "Your scripts", manual: "Added by you" };

export function parseSource(v: unknown): SourceFilter | null {
  return v === "creator" || v === "niche" || v === "script" || v === "manual" ? v : null;
}

export function parsePillar(v: unknown): Pillar | null {
  return typeof v === "string" && (PILLARS as readonly string[]).includes(v) ? (v as Pillar) : null;
}

/** A filtered list URL. Only known values survive; extra keys (dialogs) are added by the caller. */
export function listHref(base: string, f: { source?: SourceFilter | null; pillar?: Pillar | null }, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  if (f.source) q.set("source", f.source);
  if (f.pillar) q.set("pillar", f.pillar);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** Source chips: "All" then each source that has ideas (the current one always shows). */
export function sourceChips(current: SourceFilter | null, pillar: Pillar | null, bySource: Record<SourceFilter, number>) {
  const total = Object.values(bySource).reduce((s, n) => s + n, 0);
  const order: SourceFilter[] = ["creator", "niche", "script", "manual"];
  return [
    { label: "All", count: total, href: listHref("/research", { pillar }), current: current === null },
    ...order
      .filter((s) => bySource[s] > 0 || s === current)
      .map((s) => ({ label: SOURCE_LABEL[s], count: bySource[s], href: listHref("/research", { source: s, pillar }), current: s === current })),
  ];
}

export const pillarWord = (p: string) => p[0]!.toUpperCase() + p.slice(1);

/** Pillar Dropdown options (links). */
export function pillarOptions(base: string, source: SourceFilter | null, current: Pillar | null) {
  return [
    { label: "All topics", href: listHref(base, { source }), current: current === null },
    ...PILLARS.map((p) => ({ label: pillarWord(p), href: listHref(base, { source, pillar: p }), current: p === current })),
  ];
}

/** Return paths posted by our forms: /research or a sub-page, with only known filter keys. Anything else → fallback. */
export function safeReturn(raw: unknown, fallback = "/research"): string {
  if (typeof raw !== "string") return fallback;
  const [path, query = ""] = raw.split("?", 2);
  if (!/^\/research(\/(hooks|creators|used))?$/.test(path ?? "")) return fallback;
  const q = new URLSearchParams(query);
  return listHref(path!, { source: parseSource(q.get("source")), pillar: parsePillar(q.get("pillar")) });
}

/** Adds ?note= (or &note=) to a return path. */
export function withNote(path: string, note: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}note=${encodeURIComponent(note.slice(0, 160))}`;
}

// ---------- form drafts (keep the typed text when validation fails) ----------

/** Each echoed field is capped so the URL stays short. */
export const DRAFT_MAX = 500;

/** The fields each add form echoes back on a validation error (and only those). */
export const DRAFT_FIELDS = {
  idea: ["title", "hook", "pillar"],
  hook: ["text", "pillar", "source"],
  creator: ["handle", "platform", "pillar"],
} as const;
export type DraftForm = keyof typeof DRAFT_FIELDS;
export type Draft<F extends DraftForm> = Partial<Record<(typeof DRAFT_FIELDS)[F][number], string>>;

/** Picks the form's own fields out of the posted values (empty values are skipped). */
export function draftFields<F extends DraftForm>(form: F, get: (k: string) => unknown): Draft<F> {
  const out: Record<string, string> = {};
  for (const k of DRAFT_FIELDS[form]) {
    const v = get(k);
    if (typeof v === "string" && v !== "") out[k] = v.slice(0, DRAFT_MAX);
  }
  return out as Draft<F>;
}

/**
 * The redirect after a failed submit: `path` (may already carry a query) + error, the extra keys that
 * reopen the form (e.g. add=1), and each draft field as `draft_<name>` (capped at DRAFT_MAX).
 */
export function errorRedirect(path: string, error: string, fields: Record<string, string | undefined> = {}, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  q.set("error", error.slice(0, 200));
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  for (const [k, v] of Object.entries(fields)) if (v) q.set(`draft_${k}`, v.slice(0, DRAFT_MAX));
  return `${path}${path.includes("?") ? "&" : "?"}${q.toString()}`;
}

/** The draft values a page prefills its form with (`draft_<name>` keys of that form only, capped). */
export function draftFrom<F extends DraftForm>(form: F, sp: Record<string, string | string[] | undefined>): Draft<F> {
  return draftFields(form, (k) => sp[`draft_${k}`]);
}

// ---------- idea cards ----------

/** The reference hook line inside a creator idea's `about` (between “ and ”), or null. */
export function quotedHook(about: string): string | null {
  const m = /“([^”]+)”/.exec(about);
  const line = m?.[1]?.trim();
  return line ? line : null;
}

/** `about` without the quoted hook (the card title already shows it): "…opens with a question hook. It got 4×…". */
export function aboutWithoutQuote(about: string): string {
  return about
    .replace(/:\s*“[^”]*”\s*\.?\s*/, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "Question hook from @x" → "Question hook"; falls back to the stored pattern ("question" → "Question hook"). */
export function hookKind(title: string, pattern?: string | null): string | null {
  const m = /^(.+? hook) from @/i.exec(title.trim());
  if (m) return m[1]!;
  return pattern ? `${pillarWord(pattern)} hook` : null;
}

export interface IdeaHeading {
  /** Small label above the title ("From @x · Question hook", "Your script"). */
  label: string;
  title: string;
  /** The title is the reference hook line: render it in quotes. */
  quoted: boolean;
}

export function ideaHeading(i: IdeaLike & { pattern?: string | null }): IdeaHeading {
  if (i.source === "creator") {
    const quote = quotedHook(i.about);
    const kind = hookKind(i.title, i.pattern);
    const who = i.creatorHandle ? `From @${i.creatorHandle}` : "From a creator";
    return { label: kind ? `${who} · ${kind}` : who, title: quote ?? i.title, quoted: quote !== null };
  }
  const label = i.source === "script" ? "Your script" : i.source === "niche" ? "Your niche" : "Added by you";
  return { label, title: i.title, quoted: false };
}

export interface IdeaSection {
  label: string;
  text: string;
}

/** "What it's about" and "How to adapt it" (the second never for his own scripts). Empty texts are skipped. */
export function ideaSections(i: IdeaLike): IdeaSection[] {
  const about = i.source === "creator" && quotedHook(i.about) ? aboutWithoutQuote(i.about) : i.about.trim();
  const out: IdeaSection[] = [];
  if (about) out.push({ label: "What it's about", text: about });
  else if (i.hook.trim()) out.push({ label: "Opening line", text: i.hook.trim() });
  if (i.source !== "script" && i.adapt.trim()) out.push({ label: "How to adapt it", text: i.adapt.trim() });
  return out;
}

const STAGE_WORD: Record<string, string> = { scripted: "Scripted", filmed: "Filmed", posted: "Posted", dropped: "Dropped" };

/** One quiet stage Chip, or null: plain ideas have none, and a script is already scripted by definition. */
export function stageChip(i: { stage: string; source: string }): string | null {
  if (i.stage === "idea") return null;
  if (i.source === "script" && i.stage === "scripted") return null;
  return STAGE_WORD[i.stage] ?? null;
}

/** The forward move from this stage (idea → scripted → filmed → posted), or null. */
export function forwardMove(stage: string): IdeaStage | null {
  if (!(IDEA_STAGES as readonly string[]).includes(stage)) return null;
  const idx = IDEA_STAGES.indexOf(stage as IdeaStage);
  const next = IDEA_STAGES[idx + 1];
  return next && next !== "dropped" && allowedMoves(stage as IdeaStage).includes(next) ? next : null;
}

/** The one field a move needs (packages/research moveIdea). Labels avoid internal words. */
export function moveField(to: IdeaStage): { name: "script" | "mediaId" | "batchItemIds"; label: string; helper: string; multiline: boolean } | null {
  if (to === "scripted") return { name: "script", label: "Script", helper: "Shots or talking points. You can edit it later.", multiline: true };
  if (to === "filmed") return { name: "mediaId", label: "Clip id", helper: "The clip's id from the library.", multiline: false };
  if (to === "posted") return { name: "batchItemIds", label: "Post ids", helper: "The scheduled post ids from the calendar, separated by commas.", multiline: false };
  return null;
}

export const pillarTag = (p: string | null) => (p ? p.toUpperCase() : null);

// ---------- hooks ----------

/** Stored creator hooks look like “Line.” (@handle): drop the attribution and the curly quotes. */
export function cleanHookText(text: string): string {
  return text
    .trim()
    .replace(/\s*\(@[\w.]+\)\s*$/, "")
    .replace(/^“(.*)”$/s, "$1")
    .trim();
}

export interface HookView {
  /** The fill-in template (sans) or, for his own lines, the line itself. */
  main: string;
  /** The reference line it was learned from (shown in quotes), when the main line is a template. */
  quote: string | null;
  /** "@handle" or "Your hook" / "From your scripts" / "Your niche". */
  attribution: string;
}

export function hookView(h: HookLike): HookView {
  const line = cleanHookText(h.text);
  const attribution = h.creatorHandle ? `@${h.creatorHandle}` : h.source === "script" ? "From your scripts" : h.source === "niche" ? "Your niche" : h.source === "creator" ? "A creator" : "Your hook";
  if (h.template.trim()) return { main: h.template.trim(), quote: line, attribution };
  return { main: line, quote: null, attribution };
}

// ---------- already used ----------

export type UsedEntry = { kind: "idea"; at: string; idea: IdeaLike } | { kind: "hook"; at: string; hook: HookLike };

/** Ideas and hooks in one list, most recently used first. */
export function mergeUsed(ideas: IdeaLike[], hooks: HookLike[]): UsedEntry[] {
  const all: UsedEntry[] = [
    ...ideas.filter((i) => i.usedAt).map((idea) => ({ kind: "idea" as const, at: idea.usedAt!, idea })),
    ...hooks.filter((h) => h.usedAt).map((hook) => ({ kind: "hook" as const, at: hook.usedAt!, hook })),
  ];
  return all.sort((a, b) => b.at.localeCompare(a.at));
}

// ---------- time words ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "just now", "5 h ago", "yesterday", "3 days ago", "Nov 2" (past); "in 5 h", "tomorrow", "in 3 days" (future). No clock times (no time zone in the repo). */
export function whenText(iso: string, now: Date): string {
  const t = new Date(iso);
  const ms = t.getTime() - now.getTime();
  const h = Math.round(Math.abs(ms) / 3_600_000);
  const d = Math.round(Math.abs(ms) / 86_400_000);
  if (ms >= 0) {
    if (h < 1) return "within the hour";
    if (h < 24) return `in ${h} h`;
    return d <= 1 ? "tomorrow" : `in ${d} days`;
  }
  if (h < 1) return "just now";
  if (h < 24) return `${h} h ago`;
  if (d <= 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`;
}

/** "Gym · 12,400 followers · great deadpan hooks". */
export function creatorMeta(c: { pillar: string | null; followers: number | null; notes: string }): string {
  return [c.pillar ? pillarWord(c.pillar) : null, c.followers !== null ? `${c.followers.toLocaleString("en-US")} followers` : null, c.notes.trim() || null]
    .filter(Boolean)
    .join(" · ");
}

export const RUN_WORD: Record<string, string> = { ok: "Finished", partial: "Finished with gaps", failed: "Failed", running: "Running now" };
