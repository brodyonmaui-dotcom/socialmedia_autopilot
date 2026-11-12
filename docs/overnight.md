# Overnight autonomous runs: guardrails + playbook

For unattended sessions (e.g. Fable 5.1 overnight). The goal: wake up to **a pull request you review**, never to a changed server, a public post or lost work.

## The 5 layers (each one alone limits the damage)

| # | Layer | What it guarantees |
|---|---|---|
| 1 | **Run in a cloud session** (claude.ai/code or the Claude app → new session on this repo) | Isolated container: **no `.env`, no platform tokens, no SSH to the server, no access to your laptop or videos.** It physically cannot post, delete media or touch production. |
| 2 | **Branch + PR only** | Work happens on the session's own branch and ends as a PR. GitHub branch protection on `main` (one-time setup below) makes merging a human action. |
| 3 | **Guard hook** (`.claude/hooks/guard.mjs`, wired in `.claude/settings.json`) | Always blocks force-push, remote-branch deletion, `reset --hard`, broad `rm -rf`, reading `.env`/`.secrets`, and dropping data. With `AUTOPILOT_OVERNIGHT=1` it also blocks pushing to `main`, `--live`/`DRY_RUN=false`, ssh/scp/rsync, package publishing, outbound write requests, and editing guardrail files. |
| 4 | **Permission deny rules** (`.claude/settings.json`) | The file tools can't read or edit `.env`/`.secrets`, or edit the guardrail files themselves. |
| 5 | **Night brief + verification** | One scoped task with acceptance criteria. It must pass `pnpm typecheck`, `pnpm test` and the dry-run `simulate-week` before opening the PR. When unsure, it writes the question to the night log and moves on; it never guesses on platform facts, secrets or voice. |

### One-time setup (5 min)
1. **GitHub branch protection:** repo → Settings → Branches → Add rule for `main`: tick **Require a pull request before merging**, **Do not allow force pushes**, **Do not allow deletions**.
2. **Cloud environment for nights:** in the Claude app's cloud environment settings, create an environment named `autopilot-overnight` with the environment variable `AUTOPILOT_OVERNIGHT=1`. Keep the default network (package registries allowed) and **add no secrets to it.** Pick this environment for every overnight session.
3. Never paste a key into a night session. If a task needs a live API, it isn't an overnight task.

## What's a good overnight task
**Yes:** big, self-contained, verifiable offline with tests, fixtures and seed data, low on taste decisions, one area of the repo.
**No:** anything needing credentials, the server, real posting, your phone, the Meta/Google/TikTok dashboards, or voice/brand judgment calls (those are day tasks with you).

## Ranked overnight backlog (highest ROI first)
**Order of record: `docs/fable-week.json`** (the table below explains why; the tracker holds status).
| Night | Task | Why it's high-ROI for an autonomous run | Area |
|---|---|---|---|
| 1 | **Scheduler + outbox engine + `simulate-week`**: slot assignment from cadence windows, per-platform caps, staggering, DST/time-zone math, idempotency keys, retry/backoff, "unknown" timeout state, existence check before retry; fake adapters; exhaustive tests | The most correctness-critical code (double posts, missed posts), pure logic, and the tests are the oracle | `packages/core`, `apps/worker` |
| 2 | **Batch builder + approval UI** (phone-first): week grid, per-post card, inline edit, approve-all, reject, warnings (format, location, missing sound, duplicate), single-user passkey login | Large UI surface that works on seed data and needs no credentials | `apps/web` |
| 3 | **Platform adapters behind one interface**: IG container flow, YT resumable + `publishAt`, Zernio (`Idempotency-Key`, `scheduledFor`, draft), Snapchat assisted; contract tests on recorded fixtures; token-health checks; PWA push | Spec-heavy, fully mockable, and the facts are already in `docs/research.md` | `packages/adapters` |
| 4 | **Engagement pipeline**: comment polling ingest, triage (Haiku client mocked in tests), reply rotation, per-person and rate limits, kill switch, **shadow mode** default, inbox UI, DM drafts with 24 h countdown | Rules-heavy, testable with synthetic comments; live sending stays off | `apps/worker`, `apps/web` |
| 5 | **Analytics + weekly report**: insights snapshots, comparisons by pillar/platform/hook/length/time/trial, recommendations with sample sizes, trial-share list | Analysis code on synthetic data; numbers must be right | `packages/analytics` |
| 6 | **Research branch + skills**: creator list model, idea backlog (idea→scripted→filmed→posted), hooks/scripts UI, the 4 `.claude/skills` with scripts | Scaffolding-heavy | `apps/web`, `.claude/skills` |
| 7 | **Red-team review + hardening**: audit the whole repo for double-post paths, secret leaks in logs, location leaks in generated text, missing tests; fix with tests | Strong long-horizon code reading; finds what humans miss | repo-wide (no new features) |

**Day sessions (Opus, with you)** do what nights can't: review and merge last night's PR, deploy to the server, live tests with your OK, phone UX feedback, server ops. **Don't let the day session edit the area tonight's task owns**, or you'll get merge conflicts.

**Fable runs use `docs/fable-lead.md` instead** (Fable as lead engineer, delegating to Opus `implementer` and Haiku `scout` subagents). The template below is for Opus-only runs.

## Night brief template (paste into the overnight session; replace the {{...}} parts)
```
OVERNIGHT RUN. Unattended. Read CLAUDE.md, docs/overnight.md, docs/decisions.md, docs/voice.md, docs/fable-week.json, and the verification log at the end of docs/research.md.

Work: take the first item in docs/fable-week.json whose status is "todo" or "in-progress" and whose model matches this session ({{fable|opus}}). Set it to "in-progress". When it's done and budget remains, continue with the next item in the same branch/PR, as separate, clearly labelled commits.
Stay inside each item's "area". Touch shared types in packages/core only when unavoidable, and list them in the PR.

Done means, per item:
- Its acceptance criteria are met (derive 3–6 concrete ones from the item and the docs; write them at the top of the PR).
- pnpm typecheck and pnpm test pass; simulate-week passes once it exists.

Checkpoint every ~45 minutes AND after each finished item (you may hit a usage limit at any time, so the report must always be current):
1. Commit and push to your branch (never main, never force).
2. Update docs/fable-week.json (status + one-line notes) and docs/night-logs/{{YYYY-MM-DD}}.json, using the shape of docs/night-logs/_example.json.
3. Run: node scripts/night/report.mjs --log docs/night-logs/{{YYYY-MM-DD}}.json   (one-line output)
4. Commit the log + docs/night-reports/night-{{YYYY-MM-DD}}.html.
At the very end: open or update the PR, and if a SendUserFile tool exists, send the HTML report with status "proactive".

Rules:
- Never use real credentials, the server, --live or DRY_RUN=false. Everything runs on fakes, fixtures and seed data.
- Platform behavior comes only from docs/research.md. If a fact is missing, add it as a needsAttention item and stub it.
- Voice/brand/product calls: pick the most conservative option and list it under "decisions".
- If a guard hook or permission rule denies something, don't work around it. Record it under "blocked" and move on.
- Save tokens: don't re-read files you've already read, read logs only on FAIL, run targeted tests while iterating and the full suite at checkpoints, no video/media reads, and keep tool output short.
- Commit small and often. Stop when the items for your model are done or the remaining work needs a human. Don't start work outside docs/fable-week.json.
```

## Local Opus run (laptop, unattended through a usage-limit reset)
Different from a cloud night: it has your laptop, videos and SSH tunnel. So it gets **no server changes, no posting, no file moves and no deletes**, only building and read-only checks.
1. Settings: in `~/.claude/settings.json` (your user file, not the repo's) add `"autoContinueAtUsageLimit": true`, so the session waits for the limit to reset and continues by itself.
2. Windows: plug in, and set Settings → System → Power → Screen and sleep → "When plugged in, put my device to sleep after" → **Never** for the night.
3. Restart the session so the repo's guard hook loads: `/exit`, then `claude --continue`, then switch to auto mode (Shift+Tab until it shows auto).
4. Paste the brief with model = opus (it picks up item O1 in the tracker), plus the local limits above.

## Morning review (10 min)
1. Read the PR summary, "NOT done" and "Decisions for Brody". 2. Check CI/tests are green. 3. Skim the diff for anything outside the owned area. 4. Merge, or leave comments for the day session. 5. Day session: `git pull`, deploy with `docker compose up -d` (asks first), quick phone check.

## Budget notes
- Fable costs more per token than Opus (2.5× at API list prices), so a night burns more of the weekly allowance than the same hours on Opus. After night 1, check usage and size the remaining nights to it.
- One backlog item per night. Long, single-goal runs are where an autonomous model shines; many small chatty tasks waste it.
