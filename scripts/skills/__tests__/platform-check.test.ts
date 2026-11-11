import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeResearch, renderPlatformCheck } from "../lib/platform-check.js";

const md = `# Title
## Verification log — 2026-11-09 (build kickoff)
### Still open (M0)
- ~~Resolved thing~~ — done
- Whether webhooks fire
- Business Discovery at Standard Access

### M0 result — Instagram (2026-11-10, probe)
- Page token: data access until 2027-02-08.
`;

describe("analyzeResearch", () => {
  it("finds the newest log date, open (non-struck) items and deadlines", () => {
    const r = analyzeResearch(md, new Date("2026-11-11T12:00:00Z"));
    expect(r.lastVerified).toBe("2026-11-10");
    expect(r.daysSinceVerified).toBe(1);
    expect(r.openItems).toEqual(["Whether webhooks fire", "Business Discovery at Standard Access"]);
    expect(r.deadlines).toEqual([{ label: "Meta data access (re-run probe:connect-meta)", date: "2027-02-08", daysLeft: 89, severity: "ok" }]);
  });

  it("marks a deadline soon/overdue", () => {
    expect(analyzeResearch(md, new Date("2027-01-30T00:00:00Z")).deadlines[0]!.severity).toBe("soon");
    expect(analyzeResearch(md, new Date("2027-02-09T00:00:00Z")).deadlines[0]!.severity).toBe("overdue");
  });

  it("works on the real research.md and says when nothing parses", () => {
    const real = analyzeResearch(readFileSync("docs/research.md", "utf8"), new Date("2026-11-11T12:00:00Z"));
    expect(real.lastVerified).not.toBeNull();
    expect(real.openItems.length).toBeGreaterThan(0);
    expect(real.deadlines.some((d) => d.date === "2027-02-08")).toBe(true);
    expect(renderPlatformCheck(analyzeResearch("# empty"))).toMatch(/none parsed/);
  });
});
