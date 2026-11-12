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

Start from the prep pack an Opus run made for you, so you don't spend your own tokens rediscovering the repo: docs/prep/codebase-map.md (what exists, where, key APIs and tables) and the draft specs docs/design/<item>.md (goals, interfaces, file plan, task breakdown, acceptance criteria). Treat the drafts as a junior engineer's proposal: keep what's right, fix what's wrong, then hand the tasks to implementers. If something in the map looks stale, send a scout rather than reading it yourself.

Budget target: you yourself should use well under a quarter of this run's tokens; subagents do the rest. Anything you notice is below your level (boilerplate, CRUD, UI wiring, fixtures, test scaffolding, renames, docs) goes to an implementer, and any lookup goes to a scout.

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

At the end: open a PR with summary, per-item acceptance criteria, test results, what's NOT done, decisions, and a short "how to check it on my phone" list. If a SendUserFile tool exists, send the HTML report with status "proactive". Push notifications: at most two, one only if fully blocked on the creator, one when the PR is ready.
```

## Settings for a lead run
- **Model:** Fable for the lead. The `implementer` subagent is pinned to Opus and `scout` to Haiku in `.claude/agents/`.
- **Effort:** default (or `high` for a hard design item). Lowering effort reduces how much the model thinks; telling it "don't think" doesn't.
- **One run per usage window.** Two sessions in the same 5-hour window split it. On 2026-11-12, run B started while run A was still finishing and hit the limit after 24 minutes with nothing pushed.
- **Weekly budget:** check usage after each run. Fable-as-lead should get roughly twice as much done per allowance as Fable writing all the code itself, because most tokens move to Opus.
