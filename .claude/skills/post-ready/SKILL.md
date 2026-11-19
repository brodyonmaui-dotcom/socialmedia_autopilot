---
name: post-ready
description: Draft captions for renders in the Ready To Post folders that have no sidecar, write their .post.json files, then run the ingest.
---

# post-ready

Captions renders that arrived without a sidecar. The server makes no AI call (docs/decisions.md section 4), so this runs here; drafted items never carry `approvedInEditor` and always need the phone tap.

1. Run `pnpm skill:post-ready scan`. It prints JSON of renders missing sidecars (duration, hasAudio, filenameDate, source, defaults). Nothing to do if the list is empty.
2. For each render, draft captions per targeted platform following `docs/voice.md` and `docs/content-playbook.md` (read only the sections you need).
   - Facts come from the filename date and the duration. Do not watch the video.
   - trade-recaps: IG/TikTok captions and the YT description include "Not financial advice."; never invent P/L, use `{{P/L}}` only if a number is truly unknown (it will then be flagged).
   - At most 5 hashtags; YouTube title at most 60 characters; YT needs title + description.
   - Never name places or whereabouts.
3. Write each draft to a temp file outside the repo, shape `{ "caption": { "instagram": "", "tiktok": "", "youtube": { "title": "", "description": "" } }, "pillar"?, "platforms"?, "soundInApp"?, "earliest"? }`, then run `pnpm skill:post-ready write <render.mp4> <draft.json>`. It validates and writes `<name>.post.json` with `when: "today"`; it refuses to overwrite.
4. On FAIL, fix the draft and retry once; if it fails again, leave that render and report it.
5. Run `pnpm ingest:ready`. A just-written sidecar shows WAIT for 2 minutes; the scheduled task picks it up.
6. Print a short summary: drafted N, failed N, ingested/waiting N.
