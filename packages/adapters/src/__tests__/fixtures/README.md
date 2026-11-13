# Recorded response shapes

Hand-written from the shapes documented in `docs/research.md` (verification log) and seen by the M0/M1
probes. Ids are fake. When a live call shows a different shape, update the fixture AND research.md.

| File | Source |
|---|---|
| `ig-*.json` | Meta Graph API v25.0: container create / status / media_publish / media list / debug_token (research.md M0 Instagram + M1 day 1 + connect-meta) |
| `yt-*.json` | Google OAuth token endpoint + `videos.insert` resumable upload (research.md YouTube + M0 result) |
| `zernio-*.json` | Zernio `/v1/posts` and `/v1/accounts` (research.md Zernio addendum + M1 day 1: `platformPostUrl` empty right after posting) |
| `ig-comments-list.json`, `ig-comment-replies.json`, `ig-comment-reply-ok.json`, `ig-comment-hide-ok.json` | IG comments list / replies / reply / hide (research.md:192-194). Shape from docs 2026-11-12, unverified by a live probe |
| `ig-conversations.json`, `ig-conversation-messages.json` | IG Conversations API, read only (research.md:195). Shape from docs 2026-11-12, unverified by a live probe |
| `yt-comment-threads.json`, `yt-comment-insert-ok.json` | YouTube `commentThreads.list` + `comments.insert` (research.md:196). Shape from docs 2026-11-12, unverified by a live probe |
| `ig-media-list-normalised.json` | Same media list shape; caption with IG-style rewritten whitespace, case and NFD accents (F7 A3 normalisation test). Hand-made |
