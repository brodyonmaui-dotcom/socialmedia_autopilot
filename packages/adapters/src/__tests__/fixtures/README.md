# Recorded response shapes

Hand-written from the shapes documented in `docs/research.md` (verification log) and seen by the M0/M1
probes. Ids are fake. When a live call shows a different shape, update the fixture AND research.md.

| File | Source |
|---|---|
| `ig-*.json` | Meta Graph API v25.0: container create / status / media_publish / media list / debug_token (research.md M0 Instagram + M1 day 1 + connect-meta) |
| `yt-*.json` | Google OAuth token endpoint + `videos.insert` resumable upload (research.md YouTube + M0 result) |
| `zernio-*.json` | Zernio `/v1/posts` and `/v1/accounts` (research.md Zernio addendum + M1 day 1: `platformPostUrl` empty right after posting) |
