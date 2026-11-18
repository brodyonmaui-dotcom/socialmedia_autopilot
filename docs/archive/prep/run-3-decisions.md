# Run 3: answers, corrections and order (read this before the design docs)

Written 2026-11-13 by the Opus prep run, from the creator's answers given today. **Where this file and `docs/design/F8|F9|F10|F11.md` disagree, this file wins.** Every open question in those drafts is answered here, so the run doesn't need to stop and ask. Record any new decision in the night log under "decisions".

## Order for Fable run 3
**Superseded by `docs/prep/run-3-fable-brief.md`** (written later in the prep run, after the scope widened: F8 T1–T5, F9 T2/T4/T5 and F11 T1 were built here). The brief's order: adversarial review → F11 T2/T3 → F9 T3 (only with probe output) → final review. The list below is the original order, kept for history.

1. **Review and finish what this prep run built** (branch `prep/run-3-2026-11-13`, see its PR and `docs/night-logs/2026-11-13-prep.json`):
   - F10 Snapchat handoff page (T1–T4, built in full here). Review the store's concurrency (skip lock) and the media proxy; fix anything you'd reject.
   - F9 T1 probe shape lines (read-only). The creator runs them on the server.
   - F11 design draft (reset `failed` / `unknown` → `draft`). Safety-critical: finalize the design, then build it.
   - F8 T1/T2 if this prep run reached them (check `docs/fable-week.json` notes).
2. **F8 · Alerts page + PWA push** (`docs/design/F8.md`): whatever T1–T5 remains.
3. **F11 · "I checked, it's not on the platform" reset** (`docs/design/F11.md`).
4. **F9 · Analytics ingest wiring** (`docs/design/F9.md`), T2 onward, **only once the probe output from F9 T1 is in `docs/research.md`** (a creator day task). Without it, the parsers would still be guesses; skip F9 and say so.

F7 leftovers listed as open in `docs/prep/run-3-plan.md` were closed in run 2 (`fd2200b`, `dcca075`); re-grep before re-doing any of them.

## Creator answers (2026-11-13)
- **F8, F9 and F10: every bold default in the open questions is approved.** In short:
  - F8: push kinds `engagement-kill`, `unknown-outcome`, `final-failure`, `token-health`, `auth` (others page-only, configurable via `alert_push`); no quiet hours in v1; push also in dry-run; `web-push` worker-only; expect basic auth not to break SW registration (verify on the phone; the Caddy fallback still needs asking first); verify iOS Web Push facts at build time and log them in `docs/research.md`.
  - F9: ingest runs in dry-run too; IG `postedAt` = `scheduled_for` for now; hourly; `metrics-health` is page-only.
  - F10: Mark posted needs a tap-confirm; nothing due → read-only `pickSnapchatDaily` suggestion + link to `/batches`; the Spotlight link is optional; "location / Snap Map off" stays the first checklist line and the creator confirms it on the first real share.
- **`web-push` runtime dependency: approved.** Exact version (no `^`/`~`), published at least 2 weeks before install. Worker only.
- **F10 media: the same-origin proxy is approved over R2 CORS.** No bucket change.
- **TikTok analytics stays off** (`ZERNIO_ANALYTICS` unset). No 402 check call.
- **`.env.example`'s example zone is not the creator's zone.** Leave it as is.
- **The leftover local dev-DB test batch is moot.** That container is gone; nothing to delete and nothing to ask.

## Still the creator's call (unchanged)
- The first real Snapchat share (non-negotiable 2), and logging whether location/Snap Map is off on the posting screen.
- Applying migration 0008 (when F8 T1 lands) on the server.
- Generating VAPID keys into the server `.env` (F8 T4), and any Caddyfile change (F8 OQ5 fallback).
- Running the F9 T1 probe lines and pasting the one-line summaries.
- Anything in F11 that reaches a real platform: the reset itself only changes local rows; re-approval and publishing stay behind the normal approval gate.
