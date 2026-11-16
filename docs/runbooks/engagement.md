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

## Enabling YouTube comment replies (stays shadow until you say so)
The `youtube.force-ssl` scope is granted (2026-11-14 probe, `yt.scopes`). Replies are gated twice: env `YT_COMMENT_REPLIES=1` on the worker **and** the YouTube engagement mode in the inbox (`shadow` then `live`). Until both are set, nothing is sent.
1. Tell Claude in chat you want YouTube auto-replies live. Your explicit OK is required (non-negotiable 2).
2. **[changes state]** Add the line `YT_COMMENT_REPLIES=1` to the server's env file, then restart the worker as in [deploy.md](deploy.md).
3. Leave the YouTube mode on `shadow` for a few days and review the shadow replies in the inbox "Would reply" tab.
4. **[changes state]** Flip the YouTube mode to `live` in the inbox (this writes an `engagement-mode` audit row).
- **Rollback:** use the kill switch in the inbox, or set the YouTube mode back to `shadow`. To fully disable, remove the `YT_COMMENT_REPLIES` line from the env file and restart the worker.

## Triage buckets and promo spam (run 4)
- Buckets: `simple_positive` and `negative` get a drafted reply, `flag` and `hide_flag` need him, and `spam_promo` is ignored.
- **Promo spam** ("send it to @somepage", "DM us to be featured", "we'd love to feature you", paid promotion, s4s, "check out our page", follower selling) is ignored. It gets no reply of any kind, no hide, no flag and no ping. It has a triage row and nothing else, and shows only under the inbox **Ignored** filter. Promo DM threads are ignored the same way (`dm_threads.ignored_reason`, no draft).
- Precedence: threats, doxxing and scams (`hide_flag`) still win, and so do whereabouts questions and blocklist terms. A spammer asking "where is this gym" still reaches him. Promo wins over links and business words.
- The location rule flags whereabouts **questions and requests** ("where…", "which gym", "are you in/near…", "can we meet", "what time do you train", addresses, ZIP codes, the blocklist). Bare topical words such as "gym", "park", "tomorrow" or "near" no longer flag on their own, so "love the gym content" is praise. Rhetorical praise ("how are you this good?!") goes to the model, which may call it praise only with confidence ≥ 0.7. Calibration is in `packages/engagement/src/__tests__/calibration.test.ts`, run on about 160 invented comments.
- **Promo list** (`engagement_promo_accounts`): "Always ignore this account" lists the author (`manual`). Their open items move to Ignored, and their pending shadow or planned replies are cancelled, never deleted. An author with 2 promo hits from the text rules is listed automatically (`rule`). "Not spam" sends one item back through triage without the promo rule: it shows as a flag until the worker re-triages it, and it ends up flagged or drafted. If a rule had listed that author, the list row is closed. Removing a list row sets `removed_at`.

## Pings and one-tap approve (run 4)
- `settings.engagement.pings` controls the pings: `hourly` (the default) sends one digest per hour while something new waits ("5 replies drafted, 2 need you"). `each` sends one push per drafted or flagged comment, up to 6 per hour, then one digest. `off` sends nothing. These are private notifications (alert kind `reply-ready`) and never make anything public.
- A ping reads `@name commented: "…". Drafted: "…". Approve?` and links to `/app/inbox/item/<id>`. If the comment, the draft or the reason touches a place, a whereabouts question or the blocklist, the push says only "A comment needs you". Promo spam never pings.
- **Approve & send** on the item page queues the drafted (or edited) reply as a manual action. It is the same row and the same path as "Send this reply". The worker's send tick applies every gate: dry-run plus the live flag, the kill switch, the limits, the thread re-read and unknown-state handling. A double tap reports "already queued/sent". Promo, abusive (`hide_flag`), TikTok, killed or blocked-author items are refused. Edited text must pass the privacy lint. While `DRY_RUN` is on (the web reads the same env name, default on), it records the reply and says so, but nothing goes out.
- **Auto-send is still his explicit OK in chat**, per platform (go-live checklist above). Nothing in run 4 turns on auto-replies: shadow stays the default.
- Migration `0012_inbox_ignore.sql` **[changes state]** is additive and safe to re-run. Apply it by hand as in [migrations.md](migrations.md) before deploying the worker.

## DMs
- Instagram DM threads are read-only, and the drafts are suggestions only. **No code path sends a DM.** The creator copies a draft and sends it in the app inside the 24 h window shown by the countdown.

### DM drafts (read-only, never sends)
`dm-poll` is off by default. The inbox has a toggle "Turn on DM drafts (read-only, never sends)" that records an audit event. Nothing is ever sent from DMs.
