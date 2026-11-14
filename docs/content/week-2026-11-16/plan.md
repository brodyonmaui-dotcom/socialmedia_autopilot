# Posting plan: Mon Nov 16 – Sun Nov 22, 2026

Status: **DRAFT; creator answers 2026-11-15 folded in** (sound route, mind-training series, no lighter days, higher caps; see the end). Catch-up cross-posting of the IG backlog runs on top of this plan: `docs/backfill.md`. All times are **creator-local** wall clock, inside the `DEFAULT_CADENCE` windows (09:30–11:45, 12:00–14:00, 15:00–18:00, 20:00–21:00). Nothing here publishes anything: the laptop `weekly-batch` skill turns it into a draft batch, and the creator approves it on the phone.

Rules this plan inherits: `docs/content-playbook.md` (hooks, re-hooks, retention rubric), `docs/voice.md` (tone, hashtags, "Not financial advice."), `docs/tiktok-free-plan.md` (TikTok caps), CLAUDE.md (approval, location boundary).

## 1. Slot types
| Slot | Source | Caption approach |
|---|---|---|
| **Yap reel** (Y) | The 20 scripts in `yap-scripts.md`; 14 scheduled, 6 spares | **Hook line only** (the script's line 1), no hashtags on IG beyond 0–2, TikTok 3, YT title = hook ≤ 60 chars (shorten if needed), description = hook + 3 hashtags. Trading-lane scripts add "Not financial advice." |
| **Physique check** (P) | Existing library, picked by `weekly-batch` | voice.md gym one-liner: dry self-roast + "…" or one ironic emoji |
| **Single working set** (S) | Existing library | Gym one-liner, or the calm tip format ("Most people don't need more back days. They need better reps.") |
| **Trade recap** (R) | Same day, from the trade-recaps chat via `ready-to-post/` | voice.md trading recap: date → real numbers → honest lesson, "Not financial advice." Never invented numbers (`{{P/L}}` until he provides them) |
| **Workout log** (W) | Same day, from the workout-assembly chat via `ready-to-post/` | Gym one-liner or lifestyle line; no place, no "right now" |

R and W arrive through the editor handoff (`docs/payloads/workout-assembly.md`, `trade-recaps.md`): the app schedules them into the next free slot after `earliest` and asks for one tap. They are **extra** to the scheduled slots below.

## 2. Daily grid
Scheduled per day (creator-local). IG anchors; YT follows the next slot the same day (cadence stagger); TikTok gets a different selection, not every post.

| Time | Instagram | YouTube Shorts | TikTok | Snapchat (assisted) |
|---|---|---|---|---|
| 10:15 | Yap #A | — | — | — |
| 12:45 | Library (P or S) | Yap #A | Yap #A (direct) | — |
| 16:30 | (R / W land here or later) | Library (P or S) | — | — |
| 20:15 | Yap #B | Yap #B | Library clip (draft if it needs a sound) | 1 Spotlight (reminder) |

- **Scheduled per platform per day:** IG 3, YT 3, TikTok 2, Snapchat 1. With R + W on market days: IG/YT up to 5, TikTok up to 3 (R goes to TikTok on market days; W only if TikTok has room).
- **Spread:** ≥ 2 h between yap reels on one platform; ≥ 3 h between TikToks (tiktok-free-plan.md). Yaps are off-peak (late morning) and evening; library clips mid-day; recaps land after the market close when they clear the editor.
- **Snapchat:** the previous 48 h's best performer on IG/TikTok (decisions.md §3). In week 1 there's no data yet, so Mon–Tue use the strongest yap of the previous day.

## 3. Which pillar leads each day
The lead is the 10:15 yap (it sets the day's tone on IG); Yap #B is a different lane.

| Day | Lead | Yap #A (10:15 IG) | Yap #B (20:15) | Library |
|---|---|---|---|---|
| Mon 16 | Trading discipline | #1 | #2 | S |
| Tue 17 | Gym as mirror | #3 | #4 | P |
| Wed 18 | Process > results | #5 | #6 | S |
| Thu 19 | Trading discipline | #7 | #8 (mind-training day 1) | S (re-hook from the clip bank) |
| Fri 20 | Identity | #9 | #10 | P |
| Sat 21 | Gym / physique | #11 | #12 | P + S (no market, no R) |
| Sun 22 | Time and reflection | #13 | #14 (mind-training) | S (re-hook) |

Spares **#15–#20** are held back: they replace any yap that's re-recorded, flagged, or that the weekly report says to swap for a stronger lane next week.

## 4. Sound decision (creator-approved 2026-11-15)
1. **Yap reels:** direct post everywhere. They have no music, so no muting, no Content ID, and no Commercial Music Library limit.
2. **Library clips (P/S): original audio, no royalty-free tracks.**
   - **TikTok:** a clip that needs a trending sound goes as a Creator Inbox **draft** (`soundInApp: true`). He adds the sound from his saved sounds in the TikTok app and posts. **≤ 3 drafts a day** (5 pending max), cleared daily.
   - **Instagram / YouTube:** original audio. The APIs can't attach in-app sounds. If a clip really needs its trending song on IG, he posts that one from the Instagram app.
   - **Never** bake commercial songs into the file (IG muting, YouTube Content ID).
3. Re-hook variants (§5) change the song **or** the hook, never both.

## 5. Re-hook testing (clip bank)
- Every published P/S clip goes into the **clip bank** with its hook, audio and first-week numbers.
- Thu and Sun library slots are **re-hooks**: an older clip (≥ 7 days) with a new on-screen line 1 and caption line 1, nothing else changed. Week 1 has almost no history, so if nothing is ≥ 7 days old, use a fresh clip and start the bank.
- Not on TikTok (duplicate-content rejection). Compare old vs new retention in the weekly report (playbook §6).
- Yaps get re-hooked too: each script has an alternate hook. A yap that scores BAD HOOK is re-recorded with the alternate in 2–3 weeks (the line-1 swap only; same script).

## 6. Trial Reels: "Manage Versions" later
- Today the API refuses trials (subcode 2207081, a permission-level refusal at ~137 followers; research.md 2026-11-12). The fallback (plain reel + flag) stays on, and the daily re-probe continues, plus a re-probe at 200 followers.
- **When trials pass:** take the week's 2 strongest yaps (lowest `reels_skip_rate`), build up to 5 versions each (the alternate hook, plus 3 new hook lines from the playbook formulas, plus 1 with a different first sentence order), one version per day as a trial, MANUAL graduation. The weekly report says which to share (decisions.md §5).
- Until then: run the same comparison as regular-reel re-hooks a week apart.

## 7. Caps (app settings)
Regular plan plus the catch-up backfill (`docs/backfill.md`, which has the limits and sources):

| Platform | Regular | + Backfill | **Cap / day** |
|---|---|---|---|
| Instagram | 3 + R + W | — | **6** |
| YouTube | 3 + R + W | 5 | **10** |
| TikTok | 2 + R | 4 (ramp: 2 for the first 3 days) | **7**, ≤ 3 drafts |
| Snapchat | 1 | — | **1** |

`DEFAULT_CADENCE.dailyCaps` is 4/4/4/1 today. The creator OK'd raising caps (2026-11-15); he sets them in Settings. The labelled 5/day/platform setting another session is adding needs to go up to 10 for YouTube.

## 8. Weekly review hooks
- Sunday night: `weekly-report` with the retention rubric. Swap in spares for any lane that's BAD HOOK twice.
- Track per-lane yap results (n is tiny this week: say "too early to tell" under 3 posts).

## Creator answers (2026-11-15)
1. **Caps:** raise them; volume first, with a quality floor. Numbers are in §7.
2. **Sound route:** OK. Original audio, trending sounds added in the app via TikTok drafts, no royalty-free library tracks.
3. **Mind-training series:** in. #8 posts Thu 19 as day 1, so the daily practice starts that morning. #14 (the rules) posts Sun 22, and #20 is recorded on the real day N.
4. **Lighter days:** none. If a day is short, swap in a spare (#15–#19) or a backfill clip rather than dropping a slot.

Still open:
- **Snapchat week 1:** use the previous day's best yap until there's 48 h of data? (Default: yes.)
