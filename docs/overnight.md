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

## Night brief template (paste into the overnight session; replace the {{...}} parts)
```
OVERNIGHT RUN. Unattended. Read CLAUDE.md, docs/overnight.md, docs/decisions.md, docs/voice.md, and the verification log at the end of docs/research.md.

Goal: {{one task from the backlog table, e.g. "Night 1: scheduler + outbox engine + simulate-week"}}
Area you own: {{paths}}. Don't modify anything outside it except shared types in packages/core when unavoidable (list those in the PR).

Done means:
- {{3–6 concrete acceptance criteria}}
- pnpm typecheck and pnpm test pass; the simulate-week dry run passes (or is added, if this task creates it).
- One PR from your branch with: summary, what's tested, what's NOT done, open questions, and a 5-step "how to verify on my phone/server" checklist.

Rules:
- Never use real credentials, the server, --live or DRY_RUN=false. Everything runs on fakes/fixtures/seed data.
- Platform behavior comes only from docs/research.md. If a fact you need is missing, write it to NIGHT_LOG.md as a question and stub it.
- Voice/brand or product decisions: pick the most conservative option and list it under "Decisions for Brody" in the PR.
- If you're blocked or a guard hook denies something, don't work around it. Log it in NIGHT_LOG.md and continue with the next item.
- Commit small and often to your branch. Never force-push, never push to main.
- Stop when done or when the remaining work needs a human. Don't start unrelated work.
```

## Morning review (10 min)
1. Read the PR summary, "NOT done" and "Decisions for Brody". 2. Check CI/tests are green. 3. Skim the diff for anything outside the owned area. 4. Merge, or leave comments for the day session. 5. Day session: `git pull`, deploy with `docker compose up -d` (asks first), quick phone check.

## Budget notes
- Fable costs more per token than Opus (2.5× at API list prices), so a night burns more of the weekly allowance than the same hours on Opus. After night 1, check usage and size the remaining nights to it.
- One backlog item per night. Long, single-goal runs are where an autonomous model shines; many small chatty tasks waste it.
