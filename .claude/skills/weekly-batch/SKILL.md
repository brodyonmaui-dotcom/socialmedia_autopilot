---
name: weekly-batch
description: Draft next week's posts (captions, YouTube titles, per-platform text) for clips in the library, check them against docs/voice.md and the location boundary, and save them as a DRAFT batch for approval on the phone. Use when the creator asks for the weekly batch, captions for the week, or "plan next week".
---

# Weekly batch

Writes text, never publishes. The batch lands as `draft`; only the creator's tap on the phone approves it (CLAUDE.md non-negotiable 2).

## Inputs
- Clips: `status = 'ready'` rows in `media` (library page), or IDs the creator gives you. Don't read video frames; use the filename, pillar and his notes.
- `docs/voice.md` (read it every time; it wins over habit). `CLAUDE.md` wins over voice.md.
- Last report's "what worked" (weekly-report skill) and the research brief (research-brief skill), if they exist in `logs/`.

## Steps
1. Ask which clips and which platforms if he hasn't said. Defaults: Instagram + YouTube + TikTok per clip; Snapchat is assisted (1 Spotlight/day, picked from the previous 48 h's best), so leave it out unless he asks.
2. Write `logs/batch-<weekStart>.json` in the shape of `scripts/skills/fixtures/draft-sample.json`:
   - one item per clip: `mediaId`, `pillar` (gym | trading | meal | lifestyle | tip | running), `posts.{instagram,youtube,tiktok}`.
   - Per platform, tailor per voice.md: IG first line stands alone, ≤5 hashtags; TikTok shorter, 3–5 hashtags; YouTube `title` ≤60 chars + 1–2 sentence description with 3 hashtags.
   - Trading: real numbers only. If he hasn't given one, write `{{P/L}}` and ask him. Add "Not financial advice." on recaps.
   - `scheduledFor` (ISO with offset) only if he gave times or a scheduler output exists; otherwise leave it out (slot assignment is the scheduler's job).
   - Sound-dependent TikToks: set `tiktokDraft: true`; the checker will tell you they must be finished in the app for now.
3. Run `pnpm skill:weekly-batch check logs/batch-<weekStart>.json`. On FAIL, read the log it names, fix the text, re-run. Never "fix" a privacy finding by rewording around a place: remove the place.
4. Show him the captions in chat (compact table: clip · platform · text). Ask for numbers still in `{{…}}`.
5. Only after he says to save it: `pnpm skill:weekly-batch create logs/batch-<weekStart>.json` (needs `DATABASE_URL`; on the VPS he runs it). It refuses unless every post has a time and zero errors.
6. Tell him: "Draft batch saved; approve it on the phone." Nothing is approved by this skill.

## Never
- Approve, publish, set `DRY_RUN=false` or pass `--live`.
- Invent numbers, places, sponsorships or experiences. Name a gym, trail, city, campus or school.
- Commit the batch file (it's in `logs/`, gitignored).
