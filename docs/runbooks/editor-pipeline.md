# Editor pipeline: approved render to phone approval (F15)

Design: [../design/F15.md](../design/F15.md). Code: `tools/ingest-agent/src/ready-cli.ts`.

## 1. What it does

1. In your editing chat (workout assembly, trade recaps) you approve a render.
2. The chat saves `<name>.mp4` and `<name>.post.json` into its Ready To Post folder (one folder per editing chat).
3. Every 10 minutes `pnpm ingest:ready` runs on the laptop: it checks the sidecar, makes a clean copy (metadata and location tags stripped), uploads it, creates **DRAFT** items in the app and sends a "ready for approval" push.
4. You tap **Approve & schedule** in the app.

Editor approval is not app approval. Nothing publishes until you tap Approve & schedule on the phone, and block warnings still block. The only exception is the opt-in Settings toggle in section 6.

## 2. Sidecar contract v1

```json
{ "version": 1,
  "pillar": "trade-recap | workout-log | physique | single-set | yap | other",
  "platforms": ["instagram","youtube","tiktok","snapchat"],
  "when": "today | tomorrow | this-week",
  "earliest": "HH:MM (optional, creator-local)",
  "caption": { "instagram": "…", "tiktok": "…", "youtube": { "title": "…", "description": "…" }, "snapchat": "…" },
  "soundInApp": false,
  "approvedInEditor": "<ISO timestamp>",
  "source": "workout-assembly | trade-recaps | manual" }
```

In a configured folder, `pillar`, `platforms` and `source` are optional and come from the folder defaults (below). A sidecar `source` that disagrees with its folder fails. `approvedInEditor` is optional (absent means "not approved in an editor", e.g. captioned by `/post-ready`).

Validation is strict:
- `version` must be 1; `pillar`, `when`, `source` must be one of the listed values.
- `platforms`: non-empty, no duplicates, only the four above.
- `caption` is required (`soundInApp` defaults to false). Every key inside `caption` is optional and may be an empty string (an empty one shows "Needs caption" in the app).
- `earliest` is optional, `HH:MM` 24 h, in your local time.
- `approvedInEditor`, when present, must be an ISO datetime with offset.
- Unknown keys fail, so a typo is reported instead of ignored.

An invalid sidecar prints one `FAIL <name>: <path>: <message>` line and both files stay where they are.

### Folder defaults

| Folder source | Pillar | Platforms |
|---|---|---|
| `trade-recaps` | trade-recap | Instagram, YouTube, TikTok |
| `workout-assembly` | workout-log | Instagram, YouTube, TikTok (+ Snapchat if `INGEST_SNAPCHAT_DEFAULT=on`) |

### What is ignored or waits

- Subfolders (including `_ingested`) and hidden files are ignored.
- Files modified less than 2 minutes ago show `WAIT` (still being written).
- A render with no sidecar shows `NEEDS SIDECAR`. It is never guessed; the editing chat or `/post-ready` must supply one.

### Same-day scheduling

`"when": "today"` takes the next free slot after now within today's caps and spacing. If any targeted platform does not fit today, the whole item goes to tomorrow.

## 3. Laptop environment

Names only; the values live in the laptop's local env file (`.env` in the repo folder), never in git:

- `INGEST_READY_DIRS`: `;`-separated `<path>=<source>` pairs, source `trade-recaps` or `workout-assembly`, e.g. `<trade recaps ready folder>=trade-recaps;<workout ready folder>=workout-assembly` (full Windows paths; `:` and `\` are fine, the split is on the last `=`). Folders must exist. Laptop `.env` only.
- `INGEST_SNAPCHAT_DEFAULT=on` adds Snapchat to the workout defaults (leave off until the account exists).
- `INGEST_READY_DIR`: legacy single folder; still works, but then the sidecar must carry `pillar`, `platforms` and `source`.
- `TZ_CREATOR`
- `DATABASE_URL`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_MEDIA` (not needed for `--dry-run`)

Missing config prints `ingest:ready: missing env …; nothing done` and exits 2.

## 4. First run by hand

From the repo folder:

1. `pnpm ingest:ready --dry-run` plans and prints only: no upload, no database writes, no moves.
2. `pnpm ingest:ready` for the real run.

Reading the output (one line per file):

| Line | Meaning |
|---|---|
| `WOULD INGEST <file> · <pillar> · <slots>` | dry run only: what would be created, with warning flags |
| `NEW <file> · <pillar> · <slots> · N draft item(s)` | uploaded, drafts created, files moved |
| `SKIP <file> (already ingested)` | same content already in the app; files moved |
| `WAIT <file> (…)` | modified under 2 minutes ago; picked up on a later run |
| `NEEDS SIDECAR <file>` | a render with no sidecar; left alone until one exists |
| `FAIL <name>: <stage>` | that file stopped at the named stage; files stay in place |

Last line: `ingest:ready: N new · N skipped · N wait · N fail`. Exit code 0 ok, 1 if any file FAILed, 2 config missing.

Finished pairs move into `_ingested/` inside their folder (a name clash gets `-<hash8>` appended). A failure leaves both files in place, and the next run retries them. Nothing is ever deleted, locally, in storage or in the database.

## 5. Laptop automation (Windows Task Scheduler)

### (a) Required: ingest every 10 minutes

It runs `pnpm ingest:ready`, uses no AI and costs nothing. Create Task (not "Basic Task"):

- **General**: name it e.g. "Autopilot ingest ready". Choose "Run whether user is logged on or not". Leave "Run with highest privileges" unchecked.
- **Triggers**: New, Daily; tick "Repeat task every: 10 minutes", for a duration of "Indefinitely" (or 1 day).
- **Actions**: Start a program. Program/script: `cmd.exe`. Arguments: `/c pnpm ingest:ready >> logs\ingest-ready.log 2>&1`. Start in: the repo folder (the one containing `package.json` and `.env`).
- **Settings**: "If the task is already running, then the following rule applies" set to "Do not start a new instance". Tick "Stop the task if it runs longer than" 9 minutes.

The repo's `logs/` folder is gitignored, so the log stays local. The run is one-shot and idempotent (keyed on the content hash), so an overlap is harmless anyway. Check `logs\ingest-ready.log` only when something looks off.

One-line equivalent (placeholders in angle brackets; set "Start in" afterwards or wrap in `cmd /c "cd /d <repo> && ..."`):

```
schtasks /Create /TN "Autopilot ingest ready" /SC MINUTE /MO 10 /TR "cmd /c cd /d <repo> && pnpm ingest:ready >> logs\ingest-ready.log 2>&1"
```

### (b) Optional: caption renders without sidecars every 2 hours

Runs `claude -p "/post-ready"` from the repo folder. It uses your Claude plan usage, so keep it off if the editing chats always write sidecars. Same steps as (a) but repeat every 2 hours, or:

```
schtasks /Create /TN "Autopilot post-ready" /SC HOURLY /MO 2 /TR "cmd /c cd /d <repo> && claude -p \"/post-ready\" >> logs\post-ready.log 2>&1"
```

Drafted items have no `approvedInEditor`, so they always need your phone tap. To run it by hand, use `/post-ready` in a Claude session in the repo.

### How the editing chats must write sidecars at render time

After you approve a render, the chat saves the render into its Ready To Post folder AND the sidecar next to it (same name, `<name>.post.json`). Write the sidecar last, or write to a temp name and rename, so the ingest never sees a half-written file. Set `approvedInEditor` to the time you approved it (ISO 8601 with offset). Never pre-fill it.

## 6. On the phone and approval

Home shows a "From your editors" card (and the batch page shows it at the top) listing editor drafts with preview, platform, caption start, slot and source. Buttons: **Approve & schedule**, **Edit caption**, **Move to tomorrow**, **Reject**.

Warnings:
- "Needs caption" blocks approval. Use Edit caption first.
- "Add sound in app or post as-is" is advisory (the editor flagged `soundInApp`).
- "No free slot today" means nothing fit your window. Tap Move to tomorrow.

Settings has an **Editor approval counts** toggle, OFF by default. Turning it on is your action, with a confirm sheet. When ON, an editor item auto-approves only if its sidecar has `approvedInEditor`, it has zero block warnings (lint, location, cap, missing file) and its source is `trade-recaps` or `workout-assembly`. You get a push "Scheduled: <title> at <time>" and can pull it back from the calendar. Sidecars drafted by `/post-ready` have no `approvedInEditor`, so they always need your tap.

Approve & schedule approves the render's items that have no block warning and tells you which stayed. TikTok items with `soundInApp: true` go as Creator Inbox drafts: finish them inside TikTok (max 5 pending per 24 h; past that the item is flagged).

## 7. Daily caps

Settings, "Daily posts per platform (cap)". Default 5 (about 3 weekly plus 2 same-day). Upper limits: Instagram 25, YouTube 10, TikTok 15, Snapchat 1. New caps apply to the next slotting; items already scheduled do not move.

## 8. Re-posting

A render is identified by its content hash. If you rejected it and drop the same file again, nothing happens (the key already exists). To post it again, re-render so the content changes.

## 9. Rollback

Disable the scheduled task in Task Scheduler (right-click, Disable). Reject any unwanted drafts in the app. Nothing was published without your Approve tap, so there is nothing to undo publicly.
