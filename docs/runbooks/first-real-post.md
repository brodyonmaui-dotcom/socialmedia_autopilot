# First real post (go live)

One IG reel and one YT upload, watched by hand, then back to dry-run. Every step that changes server state is marked **[changes state]**. Two keys are needed to publish for real: `DRY_RUN=false` **and** the live key (`WORKER_LIVE=1`); with only one, the worker refuses and stays dry-run (`apps/worker/src/run-mode.ts`).

## 1. The explicit OK in chat
The creator writes to Claude: **"go live for the first IG reel and first YT upload"**. Claude confirms what will happen (one item per platform, live until checked, then back to dry-run). **Nothing below happens before this.** No OK, no steps 2 to 5.

## 2. Preflight on the VPS
```sh
ssh autopilot
cd /opt/autopilot && ./infra/preflight.sh
```
(Locally the same checks run as `pnpm preflight`.)
- Every **FAIL** must be fixed first. Each line names the runbook to follow.
- Read every **WARN**. Decide with the creator whether it blocks.
- Run it again until there is no FAIL.

## 3. Build a one-item batch per platform
On the phone:
1. One batch with **one Instagram reel**, and one with **one YouTube upload** (goes private with `status.publishAt`; YouTube holds the clock).
2. Set each slot **at least 30 minutes ahead**, leaving time for steps 4 and 5 plus the worker's tick.
3. Check caption (no places, at most 5 hashtags on IG) and media, then **approve** on the phone. Only approved items publish. Nothing else is in the queue; if other approved items exist, un-approve them first.

## 4. Switch the run mode
**[changes state]** On the server, in the env file used by the stack in `/opt/autopilot/infra`, change the `DRY_RUN` line and add the live key:
```
DRY_RUN=false
WORKER_LIVE=1
```
Restart only the worker (see [deploy.md](deploy.md)):
```sh
cd /opt/autopilot/infra
docker compose up -d worker     # [changes state] recreates just the worker so it reads the env file
docker compose logs --tail 30 worker
```
Confirm the startup line says live:
```
worker started · dry_run=false · platforms=...
```
If it says `dry_run=true`, or you see `live refused: DRY_RUN is false but no live key ...` or `live refused: live key present but DRY_RUN is not false ...`, one key is missing. Fix the env file and restart again. If you see `TZ_CREATOR is not set: refusing a live outbox`, set it in the env file (never in git). Do not go on until the line says `dry_run=false`.

## 5. Watch
- The `/alerts` page, and push if enabled ([alerts-push.md](alerts-push.md)).
- After the slot, check **by hand**: the Instagram profile and Reels tab; YouTube Studio, Content. The YT video stays **private** until `publishAt`, so it is correct to see it private and scheduled before then.
- Compare caption, media and time with what you approved.

## 6. Switch back to dry-run
Right after the first posts are confirmed (or the slot has passed and you have checked), unless the creator says in chat to stay live:

**[changes state]** Set `DRY_RUN=true` and remove the `WORKER_LIVE=1` line (or set it to `0`), then restart the worker and confirm `dry_run=true` in the startup line.

## 7. Rollback: something looks wrong
- **Kill:** set `DRY_RUN=true` in the env file and restart the worker **[changes state]**. Publishing stops from the next tick. (Dropping the live key does the same.)
- **A row shows `failed` or `unknown`:** follow [failed-or-unknown-post.md](failed-or-unknown-post.md). Look on the platform first, then use the buttons on the batch page: "I checked, it is not there" (reset to draft) or "Record it" (paste the post URL).
- Never delete a post or a row. Never retry by hand before checking the platform. A timeout is "unknown", not "failed".

## 8. Afterwards
- Claude records the result (what was posted, what was seen on each platform, anything odd) in the verification log at the end of `docs/research.md`.
- For steady-state live posting, repeat steps 2 and 4 with the creator's OK in chat, and leave the keys on.

## Engagement stays shadow
Going live with posting does not change auto-reply modes. Comment replies and DM drafts stay in shadow until the creator gives a **separate** explicit OK; see [engagement.md](engagement.md).
