# Snapchat handoff (assisted route, F10)

Snapchat has no posting API we can use (Zernio returns `PLATFORM_BETA_RESTRICTED`), so the app never posts to Snapchat. You share the clip yourself from the phone, and the app keeps track. The outbox never fires Snapchat items.

## Before the first real share
- Use the **dedicated brand Snapchat account**, logged in in the Snapchat app on the iPhone.
- The first real Spotlight post needs your explicit OK in chat (non-negotiable 2). Afterwards, note in chat whether the posting screen showed a location / Snap Map option, so it can be logged in `docs/research.md`.
- Install the dashboard to the Home Screen if you like; the share works from Safari too.

## Daily flow (phone taps)
1. Home → **Snapchat · N to share today** → `/handoff`.
2. On the card: **Copy** the caption (it's already trimmed to one line + up to 2 hashtags).
3. Tap **Prepare**. The clip downloads through the dashboard; the size shows when it's ready.
4. Tap **Share** → pick **Snapchat** in the share sheet → **Spotlight** (not Story).
5. **Every time:** check location / Snap Map is **OFF** on the posting screen. Paste the caption if it didn't carry over. Post.
6. Back in the dashboard: **Mark posted** → confirm. Optionally paste the Spotlight link (only `snapchat.com` links are kept). The card disappears; an audit event is written.

## When something's off
- **Share sheet is blank or has no Snapchat:** open the Snapchat app once, come back, tap Share again.
- **"This browser can't share files":** open the dashboard on the iPhone (Safari or the Home-Screen app), not on a computer.
- **Share is greyed out with a reason:** a privacy rule matched the caption (a place, coordinates, a postcode or a private term), or the clip has no clean file yet. Fix the caption in the batch (that sends it back to draft for re-approval) or wait for ingest.
- **"Changed underneath you, reload":** the item changed in another tab; reload the page.
- **"TZ_CREATOR not set":** the server `.env` is missing the creator zone; the page refuses to guess "today".

## Skip vs Drop
- **Skip today** moves the item to the next day that has no other Snapchat item, at the same local time (one Spotlight a day). Status stays approved. The button asks you to confirm first. Use it when today doesn't suit.
- **Drop** (with a confirm) rejects the item for good. Use it when the clip shouldn't go to Snapchat at all.
- Items from earlier days that weren't shared show under **Missed** with the same buttons.

## When nothing is due
The page shows the best recent Instagram/TikTok performer as a **suggestion only**, with a link to Batches. To share it, add it to a batch and approve it there; the app never adds Snapchat posts on its own.
