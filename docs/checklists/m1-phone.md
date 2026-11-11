# M1 phone demo checklist

Run at the end of M1 (Nov 21), per CLAUDE.md's end-of-milestone rule: tests + `simulate-week` dry run first, then these taps on the phone. Tick each box; anything that doesn't match "you should see" is a bug to file before M2.

**Before you start**
- [ ] The latest `main` is deployed (`docs/runbooks/deploy.md`) and migrations are applied (`docs/runbooks/migrations.md`). As of 2026-11-11: 0001, 0003 and 0004 are on the server, **0002 is not**.
- [ ] The dashboard gate is live (`docs/runbooks/dashboard-password.md`). From the laptop, `sh scripts/check-exposure.sh` shows `/app*` → `401` and `/`, `/healthz`, `/privacy`, `/terms` → `200`.
- [ ] `DRY_RUN=true` on the server unless this demo includes the approved real posts.

Sections marked **(F1/F2)** depend on tonight's Fable work (scheduler/outbox, batch + approval UI). Replace their generic steps with the exact taps once those PRs merge.

## 1. Getting in
- [ ] Safari → `https://<your domain>/app`. **You should see:** a browser username/password prompt (not the dashboard).
- [ ] Wrong password. **You should see:** the prompt again; no dashboard.
- [ ] Right password. **You should see:** the dashboard home with links to Library, Touch-up, Research and Analytics.
- [ ] Share → *Add to Home Screen* (the PWA install is M2; for now it's just a bookmark).

## 2. Library
- [ ] Tap **Library**. **You should see:** "297 ingested clip(s)" (or more, if you've ingested since), newest first, each with file name, pillar · seconds · 1080×1920 and a status chip.
- [ ] Scroll: chips read `ready`. One clip (`shirtless-physique-check.mp4`) reads `archived`.
- [ ] No "file missing" badges on the phone. That's expected: the server can't see the laptop's folders, so the check only runs when the page is opened on the laptop (`next dev`).
- [ ] Clips with QA warnings show an amber "N warning(s)" line.

## 3. Touch-up queue
- [ ] Tap **Touch-up**. **You should see:** only `ready` clips that have QA warnings, each with its warnings listed.
- [ ] Nothing on this page posts or changes anything.

## 4. Weekly batch: draft → approve **(F2)**
- [ ] On the laptop: `pnpm skill:weekly-batch check logs/batch-<week>.json` → `OK … 0 error(s)`, then `pnpm skill:weekly-batch review logs/batch-<week>.json` and answer the review sheet.
- [ ] Times assigned (by the scheduler), then `pnpm skill:weekly-batch create …` (on the VPS or through the tunnel). **You should see:** "draft batch … approve it on the phone".
- [ ] On the phone: open the batch. **You should see:** every clip with its IG / YouTube / TikTok text and time, status **draft**.
- [ ] Edit one caption, save. **You should see:** the edit persists after a reload.
- [ ] Approve. **You should see:** status **approved**. Nothing publishes before its time.

## 5. Scheduler / outbox **(F1)**
- [ ] With `DRY_RUN=true`, wait for the first slot. **You should see:** in the worker log, a dry-run line for that item; status doesn't flip to `published`.
- [ ] `simulate-week` (laptop) passes: caps, stagger, DST, idempotency, retries, the `unknown` state.

## 6. First real posts (IG + YouTube) **(needs your explicit OK in chat first)**
- [ ] One approved IG reel + one YouTube Short with `DRY_RUN=false` and `--live`.
- [ ] **Instagram:** at its time the reel appears on the profile. If trial-ineligible (< 200 followers), it posts as a plain reel and the item is flagged "trial fell back".
- [ ] **YouTube:** the upload sits **private** with a scheduled time in YouTube Studio, then flips public on its own at `publishAt`.
- [ ] In the app the items read **published** with a link that opens the post.
- [ ] Captions contain no place names; no location tag is set (check the post on the phone).

## 7. Research and Analytics (read-only)
- [ ] **Research:** creators, ideas and hooks lists load (empty is fine on the server until you add some; migration 0003 is applied).
- [ ] **Analytics:** "Weekly report" loads. With no snapshots yet it says so; `?demo=1` shows the labelled demo data with an amber banner.

## 8. Wrap-up
- [ ] Note anything that felt slow or confusing on the phone.
- [ ] `sh scripts/check-exposure.sh` one more time: `/app*` still `401`.
