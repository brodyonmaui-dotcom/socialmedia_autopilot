#!/usr/bin/env node
// PreToolUse guard (Bash). Reads the hook JSON on stdin; denies dangerous commands.
// ALWAYS blocks: force-push, remote branch deletion, history rewrites, broad rm -rf, reading secret files, dropping data.
// OVERNIGHT mode (env AUTOPILOT_OVERNIGHT=1) also blocks: pushing to main, real-publish flags (--live / DRY_RUN=false),
// ssh/scp/rsync to the server, package publishing, outbound write requests, and edits to guardrail files. Uses only Node (works on Windows Git Bash and Linux).
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = JSON.parse(raw)?.tool_input?.command ?? "";
  } catch {
    process.exit(0); // unparseable input: let the normal permission flow decide
  }
  const c = cmd.replace(/\s+/g, " ");
  const overnight = process.env.AUTOPILOT_OVERNIGHT === "1";

  const always = [
    [/\bgit\s+push\b[^|;&]*(--force\b|--force-with-lease\b|\s-f\b|\s\+\S)/, "force-push"],
    [/\bgit\s+push\b[^|;&]*--delete\b|\bgit\s+push\b[^|;&]*\s:\S/, "deleting a remote branch"],
    [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|filter-branch|filter-repo)\b/, "destructive git history/worktree command"],
    [/\bgit\s+branch\s+-D\b/, "force-deleting a branch"],
    [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b[^|;&]*(\s\/(\s|$)|\s~|\s\.\.?(\s|$|\/\s)|\$HOME|\*)/, "broad rm -rf"],
    [/(cat|less|more|head|tail|type|grep|sed|awk|cp|scp)\b[^|;&]*(\s|\/)(\.env)(\s|$)(?!\.example)/, "reading the .env secrets file"],
    [/\.secrets\//, "touching .secrets/"],
    [/\b(docker\s+(system|volume)\s+prune|dropdb|DROP\s+(DATABASE|TABLE)|TRUNCATE\s)/i, "destroying data"],
  ];
  const night = [
    [/\bgit\s+push\b[^|;&]*\b(origin\s+)?(main|master)\b/, "pushing to main (open a PR instead)"],
    [/DRY_RUN=false|--live\b/, "real publishing (needs the creator's explicit OK in chat, never unattended)"],
    [/\b(ssh|scp|rsync|sftp)\b/, "server access (overnight runs never touch the server)"],
    [/\b(npm|pnpm|yarn)\s+publish\b/, "publishing a package"],
    [/\.claude\/(hooks|settings)|CLAUDE\.md|docs\/overnight\.md/, "editing guardrail files"],
    [/\bcurl\b[^|;&]*-X\s*(POST|PUT|DELETE|PATCH)/i, "outbound write requests"],
  ];

  for (const [re, why] of overnight ? [...always, ...night] : always) {
    if (re.test(c)) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `Blocked by .claude/hooks/guard.mjs: ${why}. Note it in the night log and move on; ask the creator instead.`,
          },
        }),
      );
      process.exit(0);
    }
  }
  process.exit(0);
});
