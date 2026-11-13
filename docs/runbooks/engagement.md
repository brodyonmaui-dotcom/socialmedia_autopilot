# Engagement (F3): shadow mode, going live, kill switch

Comments are polled, triaged (rules → model → rules), planned and stored. Design: `docs/design/F3.md`. Steps that change server or account state are marked **[changes state]**. An agent asks before running those; you run them.

## Shadow mode (the default)
- `settings.engagement.mode` defaults to instagram `shadow`, youtube `shadow`, tiktok `off`.
- In shadow, everything is computed and stored as `shadow` rows. The inbox "Would reply" tab shows "would reply: …". **Nothing is sent or hidden**: the send tick never lists shadow rows.
- Check the pipeline offline at any time: `pnpm simulate-engagement` (200 synthetic comments, both modes, fakes only). It prints one line. Details go to `logs/simulate-engagement.json`.

## Go-live checklist (one platform at a time)
1. Read a week of the "Would reply" tab with the creator. Every draft is 2–6 words, has no place or schedule words, and doesn't reply to questions, links, brand or location comments.
2. **The creator's explicit OK in chat** for this platform. Turning on auto-replies is an auto-reply behaviour change (non-negotiable 2).
3. Worker env **[changes state]**: `DRY_RUN=false` **and** the worker's live flag (`--live` / `WORKER_LIVE=1`). With either missing, every action is skipped as `dry-run`. Then redeploy ([deploy.md](deploy.md)).
4. Inbox → mode toggle → `live` for this platform **[changes state]**. This writes `settings.engagement.mode[platform]='live'` plus an `engagement-mode` audit row. Only rows still `planned` after the switch can send. Old shadow rows never do.
5. `hideEnabled` stays **off** (default). Abusive comments are flagged, and the creator hides them with one tap. Turning it on is a separate OK in chat **[changes state]**.
6. Per platform:
   - **Instagram:** the Page token needs `instagram_manage_comments` (granted in M0, `docs/research.md` engagement section). Check it with `./infra/probe.sh ig` (`comment_fields`).
   - **YouTube:** replies need the `youtube.force-ssl` scope. It means a re-consent session with the creator ([token-renewal.md](token-renewal.md)) **[changes state]**, then `YT_COMMENT_REPLIES=1` in `.env` **[changes state]**. Without both, the YouTube source can't reply (`no-capability`) and stays read-only.
   - **TikTok:** out on the free plan (decision in `docs/design/F3.md`). Mode stays `off`.
7. Watch the first hour: inbox → Sent tab. Expect no `engagement-failure` or `engagement-unknown` alerts.

## Limits (enforced right before every send)
- 1 auto-reply per person per 7 days per platform. 10 per platform per hour, 40 per platform per day, 80 per day across all platforms.
- A 10-minute veto window: no auto action is sent before `notBefore`. Delete or edit it in the inbox before then.
- The worker skips a thread where the creator has already replied (human takeover). It re-reads the thread before every retry and every manual send. If our reply is already there, the row is marked sent and nothing is resent.
- A timeout → `unknown` + alert, **never retried**. Rejections back off (5 → 15 → 45 min, 4 attempts), then end `failed` + alert.
- Manual "Send this reply" from the inbox passes the same gates (kill, limits, dry-run), except the mode check.

## Kill switch
- **Manual:** the big toggle in the inbox **[changes state]**, or `ENGAGEMENT_KILL=1` (or `true`) in `.env` + redeploy **[changes state]**. The env switch wins over the toggle.
- **Auto-trip:** it trips on 3 consecutive send failures on a platform, or on a newest error that looks like a block or limit (`action block`, `spam`, `rate limit`, `too many`, `temporarily blocked`, `checkpoint`, or AI billing/quota). The tick stops at once, sets `killed` with the reason and raises an `engagement-kill` alert.
- **Reset:** read the reason first. For a platform block, wait at least 24–48 h and stay in shadow meanwhile. Then turn the toggle off **[changes state]**. Rows held while killed stay `planned` and send after the reset. Delete stale ones in the inbox first **[changes state]**.

## A reply went out that shouldn't have
1. **Kill first:** the inbox toggle **[changes state]**.
2. Inbox → **Sent** tab → find the action (comment, text, platform reply id).
3. "Never auto-reply to this person" on that author **[changes state]**.
4. Fix it by hand on the platform. Reply or delete there yourself **[changes state]**: the worker never deletes anything.
5. Tell Claude in chat what went wrong. A new rule or blocklist term is an auto-reply behaviour change, so it gets the creator's OK, and the kill switch stays on until then.

## DMs
- Instagram DM threads are read-only, and the drafts are suggestions only. **No code path sends a DM.** The creator copies a draft and sends it in the app inside the 24 h window shown by the countdown.
