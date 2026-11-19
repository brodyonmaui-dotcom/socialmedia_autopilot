// F15 /post-ready helper: Claude drafts captions for renders that arrived without a sidecar.
//
//   pnpm skill:post-ready scan                          # one JSON object: renders needing a sidecar
//   pnpm skill:post-ready write <render.mp4> <draft.json>  # validate + write <name>.post.json
// Exit codes: 0 ok · 1 write refused (FAIL line) · 2 usage / no source folder configured.
// Nothing here uploads, approves or posts: the sidecar has no approvedInEditor, so the phone tap is still needed.
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRepoEnv } from "./load-env.js";
import { probe } from "@autopilot/media";
import { blocklistFromEnv } from "@autopilot/research";
import { scanRenders } from "./post-ready/scan.js";
import { postReadyLine, writePostReady } from "./post-ready/write.js";
import { parseReadyDirs } from "./ready/dirs.js";

loadRepoEnv();

const [cmd, ...args] = process.argv.slice(2);
const { dirs, errors } = parseReadyDirs(process.env);
for (const e of errors) console.error(`post-ready: ${e}`);
if (!dirs.some((d) => d.source !== null)) {
  console.error("post-ready: no source folder configured (INGEST_READY_DIRS=<path>=<source>, see .env.example); nothing done");
  process.exit(2);
}

// `pnpm --filter` runs in the package folder; resolve user-given paths against where pnpm was started.
const fromCaller = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);

if (cmd === "scan") {
  const out = await scanRenders({
    dirs,
    env: process.env,
    now: () => new Date(),
    fs: {
      list: (d) =>
        readdirSync(d, { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => e.name),
      exists: (p) => existsSync(p),
      mtimeMs: (p) => statSync(p).mtimeMs,
    },
    probe: async (file) => {
      const p = await probe(file);
      return { durationSec: p.durationS, hasAudio: p.hasAudio };
    },
    warn: (line) => console.error(line),
  });
  console.log(JSON.stringify(out));
  process.exit(0);
} else if (cmd === "write" && args.length === 2) {
  const r = writePostReady(
    {
      dirs,
      env: process.env,
      blocklist: blocklistFromEnv(),
      caseInsensitivePaths: process.platform === "win32",
      fs: {
        exists: (p) => existsSync(p),
        readText: (p) => readFileSync(p, "utf8"),
        writeText: (p, text) => writeFileSync(p, text, "utf8"),
        rename: (from, to) => renameSync(from, to),
      },
    },
    fromCaller(args[0]!),
    fromCaller(args[1]!),
  );
  console.log(postReadyLine(r));
  process.exit(r.ok ? 0 : 1);
} else {
  console.error("usage: pnpm skill:post-ready scan | write <render.mp4> <draft.json>");
  process.exit(2);
}
