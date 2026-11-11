// Read-only: hashes every video file under the two "Ready To Post" trees and reports exact
// byte-for-byte duplicates (same sha256 in more than one place). Never moves, renames or deletes
// anything — that's a human decision. Writes docs/reports/duplicates-<date>.md.
//   pnpm exec tsx scripts/find-duplicates.mjs
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
if (existsSync(".env")) process.loadEnvFile(".env");
const { sha256File } = await import("../packages/media/src/hash.ts");

const VIDEO_EXT = /\.(mp4|mov|m4v)$/i;
// Same posted/-qa/hidden-dir skip rules as the ingest agent, plus the editor-internal junk dirs
// discovered under Trade Recaps (DaVinci Resolve's cache mirrors the whole filesystem).
const SKIP_DIR = /^posted$|^already posted$|-qa$|^\.|^cacheclip$|^resolve project backups$|^edit status$|^trim review$|^compare day/i;

const ROOTS = [
  `${process.env.USERPROFILE}\\Gym Content\\Ready To Post`,
  `${process.env.USERPROFILE}\\Trades\\Trade Recaps\\Ready To Post Recaps`,
];

function findVideos(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (SKIP_DIR.test(entry)) continue;
      findVideos(full, out);
    } else if (VIDEO_EXT.test(entry)) {
      out.push({ path: full, size: stat.size });
    }
  }
}

const files = [];
for (const root of ROOTS) findVideos(root, files);
console.log(`scanning ${files.length} video files for exact duplicates...`);

const byHash = new Map();
let done = 0;
for (const f of files) {
  const hash = await sha256File(f.path);
  if (!byHash.has(hash)) byHash.set(hash, []);
  byHash.get(hash).push(f);
  done++;
  if (done % 50 === 0) console.log(`  hashed ${done}/${files.length}`);
}

const dupeSets = [...byHash.entries()].filter(([, group]) => group.length > 1);
const today = new Date().toISOString().slice(0, 10);
const lines = [`# Duplicate content report — ${today}`, "", `Scanned ${files.length} files under the two Ready To Post trees. Found ${dupeSets.length} duplicate set(s). Nothing was moved or deleted — this is informational only.`, ""];
if (dupeSets.length === 0) {
  lines.push("No exact duplicates found.");
} else {
  for (const [hash, group] of dupeSets) {
    lines.push(`## ${hash.slice(0, 12)}… (${group.length} copies, ${(group[0].size / 1e6).toFixed(1)} MB each)`);
    for (const f of group) lines.push(`- \`${f.path}\``);
    lines.push("");
  }
}

mkdirSync("docs/reports", { recursive: true });
const outPath = `docs/reports/duplicates-${today}.md`;
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`wrote ${outPath}: ${dupeSets.length} duplicate set(s) across ${dupeSets.reduce((n, [, g]) => n + g.length, 0)} files`);
