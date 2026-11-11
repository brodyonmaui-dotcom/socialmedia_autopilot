// platform-check skill: what in docs/research.md is stale, open or about to expire.
//   pnpm skill:platform-check
// Offline and read-only; the skill then re-reads the official pages for the items it lists.
import { readFileSync } from "node:fs";
import { analyzeResearch, renderPlatformCheck } from "./lib/platform-check.js";
import { writeLog } from "./lib/io.js";

try {
  const now = new Date();
  const report = analyzeResearch(readFileSync("docs/research.md", "utf8"), now);
  const path = writeLog("platform-check", renderPlatformCheck(report, now), now);
  const urgent = report.deadlines.filter((d) => d.severity !== "ok");
  const status = urgent.length ? "WARN" : "OK";
  console.log(
    `platform-check: ${status} ${report.openItems.length} open item(s), last verified ${report.lastVerified ?? "never"}` +
      `${urgent.length ? `, ${urgent.map((d) => `${d.label} ${d.severity} (${d.daysLeft} d)`).join("; ")}` : ""} → ${path}`,
  );
} catch (err) {
  console.log(`platform-check: FAIL ${(err as Error).message}`);
  process.exit(1);
}
