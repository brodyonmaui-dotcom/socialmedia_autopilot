// pnpm simulate-engagement [--mode shadow|live-fake] [--comments 200] [--seed <s>]
// 200 synthetic comments through rules → fake triage → planner → send tick over fake sources:
// no network, no DB, no model, nothing sent. Without --mode it runs both modes. Prints one line
// (OK/FAIL) and writes logs/simulate-engagement.json; exits 1 on any broken invariant.
import { mkdirSync, writeFileSync } from "node:fs";
import { simulateEngagement } from "../packages/engagement/src/sim/simulate-engagement.js";

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const m = arg("mode");
if (m !== undefined && m !== "shadow" && m !== "live-fake") {
  console.error(`--mode must be shadow or live-fake (got ${m})`);
  process.exit(2);
}
type Mode = "shadow" | "live-fake";
const modes: Mode[] = m ? [m as Mode] : ["shadow", "live-fake"];
const comments = arg("comments") ? Number(arg("comments")) : undefined;
const seed = arg("seed");

const reports = [];
for (const mode of modes) reports.push(await simulateEngagement({ mode, comments, seed, keepLog: true }));

mkdirSync("logs", { recursive: true });
const out = "logs/simulate-engagement.json";
writeFileSync(out, JSON.stringify(reports, null, 2));
const ok = reports.every((r) => r.ok);
const summary = reports.map((r) => r.summary).join(" | ");
console.log(`${summary} · details ${out}`);
process.exit(ok ? 0 : 1);
