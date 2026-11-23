# Weekly loop: Sunday draft, captions, Monday report (F14)

Design: [../design/F14.md](../design/F14.md). Code: `apps/worker/src/jobs/weekly-draft.ts`, `apps/worker/src/jobs/weekly-report.ts`, `scripts/skills/weekly-batch.ts` (`pending` / `fill`).

Nothing in this loop publishes. The jobs only add **draft** items and raise alerts; a post goes out only after you approve it on the phone, and an empty caption or YouTube title blocks approval (`caption.missing`).

## 1. What runs when

Times are creator-local (`TZ_CREATOR` in `.env`). Without `TZ_CREATOR` the worker logs one line at start and schedules neither job.

| When | Job | What it does |
|---|---|---|
| Sunday 18:00 | `weekly-draft` | For next week (the Monday after the run): every day with no post yet gets **one library clip**, as draft items for **Instagram, YouTube and TikTok** (no Snapchat), with times from the cadence settings and **empty captions and titles**. Days that already have something (editor renders, posts you added) are left alone. Clips used in the last 28 days or already planned are skipped. Raises one `batch-ready` alert, which **pushes** to the phone: "Next week (from 2026-11-23): 5 clips added, 15 posts need captions". |
| Monday 08:00 | `weekly-report` | If anything was published in the week that just ended, raises one `report-ready` alert linking to `/analytics?days=7`: "Last week's report is ready: 18 posts published". **Page-only** (Alerts page, no push). |

Both are safe to re-run: a second run for the same week adds nothing and raises no second alert. The Sunday job writes into the same weekly batch as the editor pipeline and takes the same lock, so the two never race.

## 2. Write the captions (Claude Code session)

After the Sunday alert, Home shows **"Next week: N posts need captions"**; it links to that week on the calendar. To fill them, open a Claude Code session and ask for next week's captions (the `weekly-batch` skill):

1. `pnpm skill:weekly-batch pending` (or `--week <any date in the week>`) lists the draft items of next week with an empty caption or an empty YouTube title, from any source, into `logs/weekly-pending-<week>.json` (id, platform, pillar, local time, clip length, file name).
2. Claude writes the text in the `docs/voice.md` voice into a copy of that file.
3. `pnpm skill:weekly-batch fill <file>`: lints it (voice, location boundary + `PRIVACY_BLOCKLIST`, ≤5 IG hashtags, YouTube title required). Writes nothing.
4. `pnpm skill:weekly-batch fill <file> --write`: stores captions and titles in one go (each change is logged as an `edit` event). Items stay drafts; it refuses any item that isn't a draft.

Needs `DATABASE_URL` (on the VPS you run it, or through the tunnel). Then approve on the phone as usual.

## 3. Remove items you don't want

On the calendar, open the day, then **⋯ → Reject** on the post (or each platform). Reject is a status, nothing is deleted; **Show rejected** brings them back into view. Rejected items never publish and don't count as "needs captions".

A rejected day counts as empty again. The Sunday job only runs once a week, but if it is run again for the same week by hand, that day gets a different clip; reject that one too.

## 4. Turn the Sunday push off

The `batch-ready` alert still appears on the Alerts page; only the phone notification stops. Set the `alert_push` setting to the default list without `batch-ready` (re-read every minute, no restart). On the server **[changes state]**:

```sh
cd /opt/autopilot/infra && docker compose exec -T db psql -U autopilot -c \
  "insert into settings (key, value) values ('alert_push', '{\"kinds\": [\"engagement-kill\",\"unknown-outcome\",\"final-failure\",\"token-health\",\"auth\",\"ready-for-approval\",\"reply-ready\",\"auto-scheduled\"]}') on conflict (key) do update set value = excluded.value"
```

Check the current default list (`PUSH_KINDS_DEFAULT` in `packages/core/src/types.ts`) first so nothing else drops out. To turn it back on, run the same command with `batch-ready` added to the list **[changes state]**. More in [alerts-push.md](alerts-push.md).

## 5. Logs

Each job logs one line with counts only (clips added, posts, items it couldn't place, alerts raised), never clip names, paths or captions.

## Daily Instagram top-up (F20 D)
Every day at 17:00 creator-local the worker's `daily-instagram` job looks at tomorrow. If fewer than the **Instagram minimum** (Settings, next to the daily limits; default 2, 0 to 6) non-rejected Instagram posts exist, from any source, it adds the missing number of library clips as Instagram-only drafts (`origin 'daily'`, key `daily:<date>:<mediaId>:instagram`). It prefers gym clips, skips trading clips and anything used in the last 28 days.
- Captions come from fixed templates (`packages/core/src/caption-templates.ts`, no AI): short, in the voice guide, 2 to 4 hashtags, no places or times. A template used in the last 14 days is not picked again while others remain. Edit the caption in the calendar if you want something else.
- Nothing is approved. You get one `batch-ready` alert ("Tomorrow (date): 2 Instagram posts drafted with captions. Approve them in the calendar.") and tap Approve yourself. Re-runs add nothing. Set the minimum to 0 to turn it off. No TZ_CREATOR means it isn't scheduled.
