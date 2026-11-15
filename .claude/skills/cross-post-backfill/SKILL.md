---
name: cross-post-backfill
description: Find Instagram reels that were never posted to YouTube Shorts or TikTok, and draft a paced catch-up batch (series kept in day order, TikTok drafts for licensed-audio reels) for approval on the phone. Use when the creator says YouTube/TikTok are behind Instagram, asks to "catch up" or "cross-post the backlog", or a series is ahead on IG.
---

# Cross-post backfill

Read-only on every platform. Writes only to `logs/`; the batch goes through `weekly-batch` and his tap on the phone like every other batch (CLAUDE.md #2). Pace and caps: `docs/backfill.md`.

## Steps
1. **Snapshot (on the VPS, or a laptop session with the `.env`):** `pnpm skill:backfill snapshot` → one line + `logs/backfill-snapshot-<date>.json`. It lists IG reels (Graph API, `media_url` missing = licensed audio), YouTube uploads incl. private/scheduled (uploads playlist, ~1 quota unit per 50), TikTok via Zernio (synced history incl. posts made in the TikTok app, the live 25 most recent, and Zernio's own queue), plus our outbox if `DATABASE_URL` is set. Cloud sessions can't run this: ask him to run it and paste the one line.
2. **Diff:** `pnpm skill:backfill diff logs/backfill-snapshot-<date>.json --youtube-per-day 5 --tiktok-per-day 4` → `logs/backfill-report-<date>.md`: posted / missing / check per platform, series gaps, the queue.
3. **Read the "check" rows with him.** They're never scheduled automatically: a wrong "missing" is a double post (CLAUDE.md #3). He confirms each as posted or missing; edit the snapshot (add the matching post to `youtube`/`tiktok`) and re-run the diff.
4. **Quality pass (volume first, but a floor):** drop reels he wouldn't post today (dated jokes, a clip that needs IG-only context). Series episodes always stay, in order.
5. **Draft:** `pnpm skill:backfill draft logs/backfill-snapshot-<date>.json --start <YYYY-MM-DD> [pace flags]` → `logs/batch-backfill-<date>.json` (weekly-batch shape, times from the catch-up grid in `TZ_CREATOR`). TikTok ramp: the first batch uses `--tiktok-per-day 2` for 3 days; re-draft at 4 only if no `spam_risk` / "too many posts" error showed up.
6. **Match masters:** every item has `mediaId: ""` and a label with the IG date, first line and link. Fill each from the library (`media` rows with `status = 'ready'`; filename dates and `captured_at` near the IG date). **Use his masters, never an IG download** (IG strips licensed-audio reels and re-encodes the rest). No master → leave it out and list it for him.
7. Captions: the draft adapts his IG caption (first line, ≤60-char YT title, 3 YT hashtags, ≤5 TikTok, "Not financial advice." on trading). Check them against `docs/voice.md`; series titles keep "Day N".
8. `pnpm skill:weekly-batch check …`, then `review …`, then (when he says) `create …`. Tell him: "Backfill batch saved; approve it on the phone." TikTok drafts (`tiktokDraft: true`) land in his TikTok inbox: he adds the sound from his saved sounds and posts. Keep ≤ 3 drafts a day so pending stays under TikTok's 5.

## Never
- Schedule a "check" row, re-download from Instagram, or post anything to TikTok twice ("Duplicate content detected" and our no-double-post rule).
- Raise caps or post live yourself. Caps are his settings (`docs/backfill.md` lists what the pace needs).
- Commit snapshot/report/batch files (they're in `logs/`, gitignored).
