# Fable lead brief (paste as the first message of a Fable run)

Replaces the per-night brief in `docs/overnight.md` for Fable runs. Opus runs can keep using that one.

```
LEAD RUN (Fable, cloud, unattended).

This codebase is yours. What it's for is in CLAUDE.md and docs/decisions.md; how it's built is your call, and you'll keep building it across runs. Improve the structure wherever it helps: merge duplicated code, fix weak designs you find, refactor freely within your branch.

Your role is lead engineer, not typist. Your own tokens cost about 2.5× an Opus subagent's, and this run shares one 5-hour usage window with all of its subagents. So:
- Spend your own effort on what needs your judgment: reading the current state, architecture, interfaces, specs, the genuinely hard pieces of code, integration, and review.
- Delegate everything else. Use the `scout` subagent (cheap) to find and summarize code instead of reading whole packages yourself. Use `implementer` subagents (Opus) for implementation: hand each one a precise spec (purpose, interfaces/types, exact file list, acceptance tests) and run independent specs in parallel on disjoint files.
- Review every implementer result: read the diff, run the tests, fix or re-delegate. You own the final quality.
- Keep your own context small: don't read files a scout can summarize, and read logs only on failure.

Start from the prep pack an Opus run made for you, so you don't spend your own tokens rediscovering the repo: docs/prep/run-<n>-decisions.md if present (answers to the drafts' open questions; it wins on conflict), docs/prep/codebase-map.md (what exists, where, key APIs and tables) and the draft specs docs/design/<item>.md (goals, interfaces, file plan, task breakdown, acceptance criteria). Treat the drafts as a junior engineer's proposal: keep what's right, fix what's wrong, then hand the tasks to implementers. If something in the map looks stale, send a scout rather than reading it yourself.

Tools in the container: a real Postgres 16 is preinstalled (`bash scripts/dev/local-stack.sh` → migrated + seeded `autopilot_dev`), the web app builds and runs locally, and `node scripts/dev/phone-shot.mjs <path> <out.png>` takes an iPhone-sized screenshot you can view. Use them to verify migrations, pg stores and UI for real instead of guessing.

Budget target: you yourself should use well under a quarter of this run's tokens; subagents do the rest. Anything you notice is below your level (boilerplate, CRUD, UI wiring, fixtures, test scaffolding, renames, docs) goes to an implementer, and any lookup goes to a scout.

How to delegate without losing quality:
- Spec first, code second. Each implementer gets: purpose, exact interfaces/types, the file list it may touch, the acceptance tests to write first, and the commands that must pass. A vague spec costs more in rework than it saves.
- Parallel implementers run on disjoint files and **don't commit**; you review each diff, run the tests, then commit. Sequential implementers may commit their own work.
- Review = read the diff + run the tests + check the spec's acceptance list. If it's wrong, send it back with the exact defect (cheap), and only fix it yourself if the fix is a few lines.
- Scouts for every lookup ("where is X used", "what does Y return", "summarize this failing log"); read logs yourself only when a scout's summary isn't enough.
- Keep the hard core yourself: schema and interface decisions, concurrency/idempotency logic, security-sensitive code (auth, secrets, publish gates), and the final integration.

Work: docs/fable-week.json is the backlog. Take items in order, starting with {{FIRST ITEM, e.g. F2}}, then {{NEXT, e.g. F3}}, then F7 if budget remains. For each item: finalize its design doc, delegate, integrate, and get `pnpm typecheck`, `pnpm test` and `pnpm simulate-week` green.

Finish the work. Keep going until every item you took is done and green. When you can decide something yourself, decide it, record it under "decisions", and continue. Stop only when the backlog items for this run are complete, when a remaining step truly requires the creator, or when the usage limit stops you. When one item is done and budget remains, start the next.

Usage awareness: checkpoint after each finished item and about every 45 minutes:
1. Commit and push your branch.
2. Update docs/fable-week.json and docs/night-logs/{{DATE}}.json (shape of docs/night-logs/_example.json).
3. Run `node scripts/night/report.mjs --log docs/night-logs/{{DATE}}.json` and commit the log + report.
A usage limit can stop you at any moment; your last checkpoint is what survives. Prefer finishing one item fully over starting two.

What you may do freely, without asking: create, change, refactor or delete any code, tests, docs, migrations (as files) and scripts in the repo; add dev dependencies; run any local command, test, build or dev server; push to your branch `{{BRANCH}}` (and only that branch); open a PR to main at the end.

The safety boundary (the only things that need the creator):
1. Posting or publishing anything to a real social account. Everything runs on fakes, fixtures and seed data with DRY_RUN=true.
2. Real credentials or secrets. Never read .env or .secrets. Platform facts come from docs/research.md; a missing fact becomes a stub plus a needsAttention item.
3. The production server (ssh, deploys, live database). Migrations are written as files; the creator applies them.
4. Pushing to main or rewriting published git history.
5. Location: generated text and data never contain identifiable places or real-time whereabouts.
If a guard hook denies a command, use a different tool for the same goal (for example the Read tool instead of cat), or record it under "blocked" and continue.

Plan the next run (always, before the final PR, even if the usage limit is near; it's the most valuable thing you hand over):
- Write docs/prep/run-<n+1>-plan.md: what this run finished, what's left (with file:line pointers), the next 2–3 backlog items in order with why, and the lessons from this run (what wasted tokens, what delegation worked, the lead's share of cost from the report).
- Add or update the next items in docs/fable-week.json (id, title, model, area, status "todo") and write a draft docs/design/<id>.md for each, in the same shape as the existing ones: goals, non-goals, interfaces, data model, file plan, a task table sized for one implementer each (files, dependencies, parallel-safe, acceptance tests), and open questions with recommended answers.
- Delegate the drafting of those design docs to implementers/scouts from your outline. You review them.

At the end: open a PR with summary, per-item acceptance criteria, test results, what's NOT done, decisions, and a short "how to check it on my phone" list. If a SendUserFile tool exists, send the HTML report with status "proactive". Push notifications: at most two, one only if fully blocked on the creator, one when the PR is ready.
```

## Lessons from earlier runs (keep these true)
- **Run A (2026-11-12): Fable wrote all the code itself.** It shipped F1 + F4 but spent most of the budget typing. → Lead + subagents, as above.
- **Run B overlapped run A's usage window** and stopped after 24 minutes with nothing pushed. → One run per 5-hour window; nothing else running.
- **Guard hook matches command text.** A Bash command (or a commit/PR message passed in one) that names a guarded file or the gitignored secrets folder is blocked, even inside a heredoc. → Use the Read/Write tools for those files, and describe the secrets folder in words, not by path.
- **CLAUDE.md is a guardrail file.** Suggest edits to it under "Needs you" instead of making them.
- **Checkpoints work.** Run A was paused once by the usage limit and once by a worker restart, and resumed with nothing lost.
- **Items left "not done" weren't planned anywhere**, so they drifted. → Every run ends with the next-run plan.

## Settings for a lead run
- **Model:** Fable for the lead. The `implementer` subagent is pinned to Opus and `scout` to Haiku in `.claude/agents/`.
- **Effort:** default (or `high` for a hard design item). Lowering effort reduces how much the model thinks; telling it "don't think" doesn't.
- **One run per usage window.** Two sessions in the same 5-hour window split it. On 2026-11-12, run B started while run A was still finishing and hit the limit after 24 minutes with nothing pushed.
- **Weekly budget:** check usage after each run. Fable-as-lead should get roughly twice as much done per allowance as Fable writing all the code itself, because most tokens move to Opus.
