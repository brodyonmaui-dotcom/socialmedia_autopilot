---
name: weekly-batch
description: Write captions and YouTube titles for next week's draft posts (the Sunday weekly-draft job and editor renders leave them empty), or draft a new batch from library clips; check against docs/voice.md and the location boundary; everything stays DRAFT for approval on the phone. Use when the creator asks for the weekly batch, captions for the week, "Next week: N posts need captions", or "plan next week".
---

# Weekly batch

Writes text, never publishes. The batch lands as `draft`; only the creator's tap on the phone approves it (CLAUDE.md non-negotiable 2).

## Start here: captions for the drafts that already exist
Every Sunday 18:00 the worker's `weekly-draft` job tops up next week with one library clip per empty day (IG + YT + TikTok), as drafts with **empty captions and titles**. Editor renders can land with empty text too. Approval is blocked until the text is there. So always start with:

1. `pnpm skill:weekly-batch pending` (default: next week; `--week <any date in the week>` for another). Needs `DATABASE_URL`. It prints one line and writes `logs/weekly-pending-<week>.json`: one entry per post with `id`, `platform`, `pillar`, `scheduledFor` (creator-local), `durationS`, `label` (file name), `origin`, and the current `caption` / `title`. Zero posts → say so and stop (or go to "New batch" below if he wants more).
2. Read `docs/voice.md` (every time). Copy the file to `logs/weekly-fill-<week>.json` and write each `caption` (and `title` for YouTube) in that voice, following the per-platform rules in "New batch" step 2 (hooks, hashtags, trading numbers, `{{P/L}}` when he hasn't given one). Posts of the same clip share an idea but not a copy-pasted caption. Use the file name, pillar and length, never the video frames.
3. `pnpm skill:weekly-batch fill logs/weekly-fill-<week>.json`: the same lint as `check` (voice, location boundary + `PRIVACY_BLOCKLIST`, ≤5 IG hashtags, YouTube title required, empty captions). Writes nothing. On FAIL read the log it names, fix, re-run. Ask him for any `{{…}}` numbers.
4. Only after he says to save: `pnpm skill:weekly-batch fill logs/weekly-fill-<week>.json --write`. One transaction; each item gets an `edit` event; it refuses items that aren't `draft` (already approved or rejected). Items stay drafts.
5. Tell him: "Captions saved; approve the week on the phone." To drop a clip he doesn't want: reject it on the calendar (`docs/runbooks/weekly-loop.md`).

## New batch (only when he asks for clips beyond the drafts)

### Inputs
- Clips: `status = 'ready'` rows in `media` (library page), or IDs the creator gives you. Don't read video frames; use the filename, pillar and his notes.
- `docs/voice.md` (read it every time; it wins over habit). `CLAUDE.md` wins over voice.md.
- `docs/content-playbook.md`: hook rules (§1), re-hook clip bank (§3), retention fixes from the last report (§6).
- Last report's "what worked" (weekly-report skill) and the research brief (research-brief skill), if they exist in `logs/`.

### Steps
1. Ask which clips and which platforms if he hasn't said. Defaults: Instagram + YouTube + TikTok per clip; Snapchat is assisted (1 Spotlight/day, picked from the previous 48 h's best), so leave it out unless he asks.
2. Write `logs/batch-<weekStart>.json` in the shape of `scripts/skills/fixtures/draft-sample.json`:
   - one item per clip: `mediaId`, `pillar` (gym | trading | meal | lifestyle | tip | running), `posts.{instagram,youtube,tiktok}`.
   - Per platform, tailor per voice.md: IG first line stands alone, ≤5 hashtags; TikTok shorter, 3–5 hashtags; YouTube `title` ≤60 chars + 1–2 sentence description with 3 hashtags.
   - Trading: real numbers only. If he hasn't given one, write `{{P/L}}` and ask him. Add "Not financial advice." on recaps.
   - `scheduledFor` (ISO with offset) only if he gave times or a scheduler output exists; otherwise leave it out (slot assignment is the scheduler's job).
   - Hooks: line 1 of every caption follows the playbook hook rules (one sentence, a claim not a question, specific nouns). Yap reels get the hook line only, nothing else. A re-hook of an older clip changes only the hook (or only the song); never re-post to TikTok.
   - Sound-dependent TikToks go as inbox drafts: set `tiktokDraft: true` (he finishes the sound in the TikTok app; max 5 pending drafts per 24 h, the checker warns).
3. Run `pnpm skill:weekly-batch check logs/batch-<weekStart>.json`. On FAIL, read the log it names, fix the text, re-run. Never "fix" a privacy finding by rewording around a place: remove the place.
4. Run `pnpm skill:weekly-batch review logs/batch-<weekStart>.json`. It writes `logs/batch-<weekStart>-review.md`: one row per clip with folder + file name (from the library when the DB is reachable, else blank), the IG / TikTok / YouTube text, and open questions (`{{…}}` gaps, check findings, YouTube > 60 s, TikTok drafts, numbers taken from file names, archived clips). Add anything only you know (what the clip seems to show) to that file. It refuses to replace an existing review; pass `--force` only after you've carried over any hand edits. Point him to the file and ask for numbers still in `{{…}}`.
5. Times: `pnpm schedule-batch logs/batch-<weekStart>.json --write` fills every missing `scheduledFor` from the cadence grid (caps, stagger, DST-safe in `TZ_CREATOR`; existing times are kept). Preview without `--write`; on FAIL read the log it names.
6. Only after he says to save it: `pnpm skill:weekly-batch create logs/batch-<weekStart>.json` (needs `DATABASE_URL`; on the VPS he runs it). It refuses unless every post has a time and zero errors.
7. Tell him: "Draft batch saved; approve it on the phone." Nothing is approved by this skill.

## Never
- Approve, publish, set `DRY_RUN=false` or pass `--live`. `fill --write` only stores text; it never approves.
- Invent numbers, places, sponsorships or experiences. Name a gym, trail, city, campus or school.
- Commit the batch, pending or fill files (they're in `logs/`, gitignored).
