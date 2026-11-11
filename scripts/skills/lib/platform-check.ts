/**
 * Reads docs/research.md and reports what a platform-check session needs to look at:
 * open questions, how stale the verification log is, and dated deadlines it mentions.
 * Pure text in, data out, so it's testable without the network.
 */
export interface PlatformCheckReport {
  lastVerified: string | null;
  daysSinceVerified: number | null;
  openItems: string[];
  deadlines: Array<{ label: string; date: string; daysLeft: number; severity: "ok" | "soon" | "overdue" }>;
}

const DAY = 86_400_000;
const days = (from: Date, toIso: string) => Math.floor((Date.parse(toIso + "T00:00:00Z") - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / DAY);

/** Known dated facts in research.md. A regex miss means the doc changed: the report says so. */
const DEADLINE_PATTERNS: Array<{ label: string; re: RegExp; warnDays: number }> = [
  { label: "Meta data access (re-run probe:connect-meta)", re: /data access until (\d{4}-\d{2}-\d{2})/i, warnDays: 14 },
  { label: "Old Meta user token expiry", re: /expires (\d{4}-\d{2}-\d{2})/i, warnDays: 7 },
];

export function analyzeResearch(md: string, now = new Date()): PlatformCheckReport {
  md = md.replace(/\r\n/g, "\n"); // Windows checkouts (core.autocrlf) give CRLF
  const dates = [...md.matchAll(/^#{2,3} .*?(\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1]!).sort();
  const lastVerified = dates.at(-1) ?? null;

  const openItems: string[] = [];
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^#{2,3} Still open/.test(l));
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (/^#/.test(line)) break;
      const m = line.match(/^\s*-\s+(.*)$/);
      if (!m) continue;
      const text = m[1]!.trim();
      if (/^~~/.test(text)) continue; // struck through = resolved
      openItems.push(text);
    }
  }

  const deadlines = DEADLINE_PATTERNS.flatMap(({ label, re, warnDays }) => {
    const m = md.match(re);
    if (!m) return [];
    const daysLeft = days(now, m[1]!);
    const severity: "ok" | "soon" | "overdue" = daysLeft < 0 ? "overdue" : daysLeft <= warnDays ? "soon" : "ok";
    return [{ label, date: m[1]!, daysLeft, severity }];
  });

  return {
    lastVerified,
    daysSinceVerified: lastVerified ? -days(now, lastVerified) : null,
    openItems,
    deadlines,
  };
}

export function renderPlatformCheck(r: PlatformCheckReport, now = new Date()): string {
  return [
    `# Platform check (${now.toISOString().slice(0, 10)})`,
    "",
    `Last verification-log entry: ${r.lastVerified ?? "none found"}${r.daysSinceVerified !== null ? ` (${r.daysSinceVerified} day(s) ago)` : ""}.`,
    "",
    "## Deadlines",
    ...(r.deadlines.length ? r.deadlines.map((d) => `- ${d.severity === "ok" ? "" : `**${d.severity.toUpperCase()}** `}${d.label}: ${d.date} (${d.daysLeft} day(s))`) : ["- none parsed (did research.md change?)"]),
    "",
    "## Still open",
    ...(r.openItems.length ? r.openItems.map((t) => `- ${t}`) : ["- nothing open"]),
    "",
  ].join("\n");
}
