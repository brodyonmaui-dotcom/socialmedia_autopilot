# Run 4: rules for every build agent

Read `CLAUDE.md` first. The non-negotiables there hold. Then:

## Safety
- Everything runs on fakes, fixtures and the local seed DB. No real posting or sending, no real platform calls, no server or ssh.
- Never read the env file or the secrets folder. Never print tokens.
- The repo is public: no real place names, time zones, domains, handles or personal data in code, fixtures, seed data or docs. Demo people are obviously fake ("gym_fan_22").
- Nothing new may publish or reply without the existing approval gates (`planTransition`, the manual-send gates, shadow mode). New features may only make the system send less, never more.
- No deletes of user data. "Remove" means archive or a status change.

## Working in a shared tree
- Other agents are editing the same checkout right now. **Touch only the files in your brief.** If you need a change elsewhere, say so in your report instead of making it.
- **Do not commit, stash, reset, checkout or push.** The lead reviews and commits.
- Do not kill processes you did not start (`pkill` is forbidden). Use your own port and `NEXT_DIST_DIR` if you run the web app (given in your brief).
- The guard hook blocks Bash commands whose text contains the word `truncate` (also the Tailwind class) or names guarded files. Use the Write/Edit tools for such files; never paste file content through a shell heredoc.
- Local stack: `export DATABASE_URL=postgres://ap:ap@localhost:5432/autopilot_dev` (already migrated and seeded; `bash scripts/dev/local-stack.sh` re-applies new migrations and the seed). Migrations are files in `packages/db/migrations/`; use only the number given in your brief; additive only; safe to re-run.
- Seed data: add your demo rows in your own module under `scripts/dev/lib/` and call it from `scripts/dev/seed.ts` with a one-line edit. Seeds must be idempotent.

## Quality bar
- Write the acceptance tests first, then the code. Match the existing style; search for an existing helper before writing a new one.
- Before reporting: `pnpm typecheck`, the tests of the packages you touched, and (if you touched the web app) a web build with your own `NEXT_DIST_DIR`. Run the full `pnpm test` once at the end with `DATABASE_URL` set and report the numbers.
- UI work follows `docs/design/ui-system.md` (v3) exactly, including its hard rules. It overrides any older "v2 / Warm Industrial" wording you find elsewhere. Look at real screenshots (phone 390 px and desktop 1440, Day and Night) with `node scripts/dev/phone-shot.mjs <path> <out.png> --port <yours> --cookie "$(pnpm -s dev:session | tail -1)" [--desktop] [--theme dark] [--full]`, and fix what looks wrong before you report. Save temporary shots under `logs/shots/<your-name>/` (gitignored).

## Report (keep it under 40 lines)
Files changed, what works, what you did not finish, anything the lead must decide, test numbers, and any file outside your list that needs a follow-up edit.
