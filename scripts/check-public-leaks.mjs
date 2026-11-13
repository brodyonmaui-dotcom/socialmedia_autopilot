#!/usr/bin/env node
// node scripts/check-public-leaks.mjs [--root <dir>]
// The repo is PUBLIC (CLAUDE.md). Scans docs/**, README*, every *.md, .env.example and infra/** (text
// files only) for values that would reveal the creator or the server: IPv4 addresses, personal
// filesystem paths, IANA time zones, `ssh <real host>`, @handles next to instagram/tiktok, and any
// PRIVACY_BLOCKLIST term (env only, never .env-loaded here). Prints `file:line: <rule>` per hit and
// never the matched text itself. Exit 1 on any hit, else `check-public-leaks: ok (<n> files)`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const argRoot = process.argv.indexOf("--root");
const root = resolve(argRoot > 0 && process.argv[argRoot + 1] ? process.argv[argRoot + 1] : join(dirname(fileURLToPath(import.meta.url)), ".."));

/** Never descended into: generated, vendored or gitignored output. */
const SKIP_DIRS = new Set([".git", "node_modules", "logs", "dist", ".next", "coverage", ".turbo", ".pnpm-store"]);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|mp4|mov|m4a|mp3|wav|pdf|zip|gz|tgz|woff2?|ttf|otf|sqlite|db)$/i;

function inScope(rel) {
  const p = rel.split(sep).join("/");
  const base = p.split("/").pop() ?? "";
  return p.startsWith("docs/") || p.startsWith("infra/") || /^README/i.test(base) || /\.md$/i.test(base) || base === ".env.example";
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (inScope(rel) && !BINARY_EXT.test(entry.name)) out.push(rel);
    }
  }
  return out;
}

// ---- rules: each returns true when the line leaks ----
const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.]*\d)/g;
function ipLeak(line) {
  for (const m of line.matchAll(IPV4)) {
    const o = m.slice(1, 5).map(Number);
    if (o.some((n) => n > 255)) continue;
    const ip = o.join(".");
    if (ip === "127.0.0.1" || ip === "0.0.0.0" || o[0] === 10) continue; // loopback / any / private examples
    if (/^(192\.0\.2|198\.51\.100|203\.0\.113)\./.test(ip)) continue; // RFC 5737 documentation ranges
    return true;
  }
  return false;
}
/** `/home/user` (sandbox) and `/home/deploy` (the VPS service account in infra/bootstrap-vps.sh) aren't people. */
const PERSONAL_PATH = /[A-Za-z]:\\|\/Users\/[A-Za-z][\w.-]*|\/home\/(?!(?:user|deploy)\b)[a-z_][\w.-]*/;
const IANA_ZONE = /\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc|Brazil|Canada|Mexico|US)\/[A-Z][A-Za-z_+-]*(?:\/[A-Z][A-Za-z_-]*)?/g;
const ALLOWED_ZONES = new Set(["Europe/London"]); // the labelled fixture zone
function zoneLeak(line) {
  for (const m of line.matchAll(IANA_ZONE)) {
    if (ALLOWED_ZONES.has(m[0])) continue;
    // A documented format example ("IANA zone, e.g. Area/City") — still reported to the creator once (F7 B9).
    if (/\be\.g\.,?\s*$/.test(line.slice(0, m.index))) continue;
    return true;
  }
  return false;
}
/** `ssh [flags] [user@]host` where host looks real (a domain or IP); the `autopilot` alias and placeholders are fine. */
const SSH = /\bssh\s+(?:-\S+\s+(?:\S+\s+)?)*(?:[\w.-]+@)?([\w.-]+)/g;
function sshLeak(line) {
  for (const m of line.matchAll(SSH)) {
    const host = m[1] ?? "";
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
    if (/[a-z0-9-]+\.[a-z]{2,}$/i.test(host) && !/(^|\.)(example\.(com|org|net)|invalid|test|localhost|local)$/i.test(host)) return true;
  }
  return false;
}
/** Placeholder/example handles that docs may show next to platform names. */
const EXAMPLE_HANDLES = new Set(["username", "handle", "yourhandle", "your_handle", "example", "creator", "someone", "user", "me", "mention", "name"]);
const HANDLE = /(?:^|[\s(\["'`])@([A-Za-z0-9_.]{2,30})(?![\w/@-])/g;
const PLATFORM_WORD = /instagram|tiktok/gi;
function handleLeak(line) {
  const near = [...line.matchAll(PLATFORM_WORD)].map((m) => m.index ?? 0);
  if (!near.length) return false;
  for (const m of line.matchAll(HANDLE)) {
    const h = (m[1] ?? "").replace(/\.+$/, "").toLowerCase();
    // Same clause: within 80 chars of the platform word (long HTML/report lines mention both far apart).
    if (h && !EXAMPLE_HANDLES.has(h) && near.some((i) => Math.abs(i - (m.index ?? 0)) <= 80)) return true;
  }
  return false;
}
const blocklist = (process.env.PRIVACY_BLOCKLIST ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const RULES = [
  ["ipv4", ipLeak],
  ["personal-path", (l) => PERSONAL_PATH.test(l)],
  ["time-zone", zoneLeak],
  ["ssh-host", sshLeak],
  ["handle", handleLeak],
];

const files = walk(root, []).sort();
const hits = [];
let blocklistHits = 0;
for (const rel of files) {
  let text;
  try {
    if (statSync(join(root, rel)).size > 2_000_000) continue;
    text = readFileSync(join(root, rel), "utf8");
  } catch {
    continue;
  }
  if (text.includes("\u0000")) continue; // binary
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [rule, test] of RULES) if (test(line)) hits.push(`${rel.split(sep).join("/")}:${i + 1}: ${rule}`);
    const lower = line.toLowerCase();
    if (blocklist.some((t) => lower.includes(t))) {
      blocklistHits++;
      hits.push(`${rel.split(sep).join("/")}:${i + 1}: privacy-blocklist`);
    }
  });
}

if (hits.length) {
  for (const h of hits) console.log(h);
  console.log(`check-public-leaks: FAIL ${hits.length} hit(s) in ${new Set(hits.map((h) => h.split(":")[0])).size} file(s) of ${files.length}${blocklistHits ? ` (${blocklistHits} blocklist)` : ""}`);
  process.exit(1);
}
console.log(`check-public-leaks: ok (${files.length} files)`);
