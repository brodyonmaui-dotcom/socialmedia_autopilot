// pnpm tsx scripts/research/build-yap-data.ts [--check]
// docs/content/week-2026-11-16/yap-scripts.md → packages/research/data/yap-2026-11-16.json (the bundle the
// research-refresh job upserts on every run). Every text field must pass the location lint first; a
// failing field stops the build (nothing is written). --check = verify the committed JSON is current.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blocklistFromEnv, lintText } from "../../packages/research/src/voice-lint.js";
import { parseYapScripts } from "../../packages/research/src/auto/yap.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const SRC = `${root}docs/content/week-2026-11-16/yap-scripts.md`;
const OUT = `${root}packages/research/data/yap-2026-11-16.json`;

const data = parseYapScripts(readFileSync(SRC, "utf8"), "yap-2026-11-16");
const blocklist = blocklistFromEnv();
const bad: string[] = [];
for (const i of data.ideas) {
  for (const [k, v] of Object.entries({ title: i.title, hook: i.hook, about: i.about, script: i.script })) {
    const issue = lintText({ text: v, kind: "hook", blocklist }).issues.find((x) => x.rule.startsWith("privacy."));
    if (issue) bad.push(`#${i.number} ${k}: ${issue.rule}`);
  }
}
for (const h of data.hooks) {
  const issue = lintText({ text: h.text, kind: "hook", blocklist }).issues.find((x) => x.rule.startsWith("privacy."));
  if (issue) bad.push(`${h.sourceKey}: ${issue.rule}`);
}
if (bad.length) {
  console.error(`build-yap-data: FAIL location lint: ${bad.join("; ")}`);
  process.exit(1);
}
const json = JSON.stringify(data, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current !== json) {
    console.error("build-yap-data: FAIL bundle is stale; run pnpm tsx scripts/research/build-yap-data.ts");
    process.exit(1);
  }
  console.log(`build-yap-data: ok (current) · ${data.ideas.length} ideas · ${data.hooks.length} alt hooks`);
} else {
  writeFileSync(OUT, json);
  console.log(`build-yap-data: ok · ${data.ideas.length} ideas · ${data.hooks.length} alt hooks → packages/research/data/yap-2026-11-16.json`);
}
