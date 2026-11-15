---
name: weekly-report
description: Weekly performance report from insights snapshots — comparisons by platform, pillar, hook pattern, length and posting time, recommendations with sample sizes, and which Instagram trial reels to share to the main feed. Use when the creator asks how the week went, what worked, or which trials to share.
---

# Weekly report

Numbers must be right. The script computes everything; you explain it in his terms and never add a number the script didn't print.

## Steps
1. `pnpm skill:weekly-report [--week YYYY-MM-DD] [--fixture <snapshots.json>]` → one line; the full report is in `logs/weekly-report-<week>.md`.
   - Without `--fixture` it reads `post_metrics` snapshots from the DB (`DATABASE_URL`, VPS). Ingestion from the platforms is the worker's job.
2. Read the report. Lead with 3 bullets: what worked, what didn't, what to try next week. Every claim cites its sample size ("n=4"). Under 3 posts in a group = "too early to tell".
3. **Retention diagnosis** (`docs/content-playbook.md` §6): label the weakest posts BAD HOOK / MID DROP-OFF / HELD BACK from `reels_skip_rate`, `ig_reels_avg_watch_time` vs length, and reach vs the pillar norm; give the fix. For a re-hooked clip, compare old vs new retention.
4. **Trial reels:** list the trial-share recommendations exactly as the report gives them (share / wait / don't share, with the reason). Trials stay MANUAL (decisions.md #5): he shares them in the Instagram app; this skill never does.
5. Offer: "feed this into next week's batch?" → the weekly-batch skill reads `logs/weekly-report-*.md`.

## Rules
- Compare like with like: views per platform are not comparable across platforms; rank within a platform.
- Never present correlation as cause; say "posts with X did better (n=…)".
- If a metric is missing for a platform (e.g. trial insights not documented yet), say "not available", don't estimate.
