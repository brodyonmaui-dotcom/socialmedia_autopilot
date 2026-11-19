# Brief C: share the QA issue types from packages/media (run 5 cleanup, 2026-11-18)

Read `CLAUDE.md` and `docs/prep/run-4-agent-rules.md` first. **Do not commit.** Port 3103, `NEXT_DIST_DIR=.next-c` for the web build.

## Why
`apps/web/lib/library/qa-issues.ts` repeats `QaSeverity`, `QaIssue`, `Segment` (from `packages/media/src/qa.ts`) and `FixOp`, `FIX_OP_ORDER`, `OP_FOR_CODE`, `OPT_IN_OPS` (from `packages/media/src/fix.ts`), because the web app doesn't depend on `@autopilot/media`, whose `qa.ts`/`fix.ts` import `node:child_process`/`node:fs` via `exec.ts`/`probe.ts`. The web bundle must never pull those in.

## Do
1. New `packages/media/src/qa-types.ts`: **no imports at all.** Move into it `Segment`, `QaSeverity`, `QaIssueCode`, `QaIssue` (and any type `QaIssue` needs) from `qa.ts`, and `FixOp`, `FIX_OP_ORDER`, `OP_FOR_CODE`, `OPT_IN_OPS` from `fix.ts`. `qa.ts` and `fix.ts` import from it and re-export the same names so every existing import (`index.ts`, worker, tools, tests) keeps working unchanged.
2. `apps/web/package.json`: add `"@autopilot/media": "workspace:*"` (same form as the other workspace deps); `apps/web/next.config.mjs`: add it to `transpilePackages`. Run `pnpm install` (offline workspace link; commit-ready lockfile change).
3. `apps/web/lib/library/qa-issues.ts`: import the shared names from `@autopilot/media/src/qa-types.js` (deep path, same pattern as `@autopilot/engagement/src/rules.js` in `apps/web/lib/inbox/promo.ts`); value imports only from that file, never from `@autopilot/media` root. Keep the web-only helpers (`TAG_LABELS`, `tagLabel`, `cleanIssue`, `issuesOf`, `focusHref`). The web's `code: string` (rows from the DB may hold unknown/legacy codes) — keep the mapper tolerant: if needed define `type WebQaIssue = Omit<QaIssue,"code"> & { code: QaIssueCode | (string & {}) }` or narrow in `cleanIssue`; don't make an unknown DB code crash or vanish where it was shown before.
4. Guard test (in `packages/media/src/__tests__/` or next to the others): read `qa-types.ts` source and assert it has no `import` / `require` statements; and a web-side test that no file under `apps/web` (excluding `__tests__`) imports `@autopilot/media` other than via `/src/qa-types`.
5. Verify the bundle: after `NEXT_DIST_DIR=.next-c pnpm --filter <web> build`, grep the client and server output chunks for `child_process` / `ffprobe` / `execFile` and report (should be absent from client chunks). Restore `apps/web/tsconfig.json` and `apps/web/next-env.d.ts` with `git show HEAD:<path> > <path>` afterwards.

## Files you may touch
`packages/media/src/{qa-types,qa,fix}.ts`, a new test there, `apps/web/lib/library/qa-issues.ts` + its tests, a new guard test under `apps/web/lib/library/__tests__/`, `apps/web/package.json`, `apps/web/next.config.mjs`, `pnpm-lock.yaml`.

## Done when
`pnpm typecheck` 0; `pnpm test` with `DATABASE_URL=postgres://ap:ap@localhost:5432/autopilot_dev` green (numbers); web build OK; bundle grep result reported. Report <40 lines.
