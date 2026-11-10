# Share your existing socials work with this session

This session runs in a cloud container, so it can't see your laptop on its own. Pick **one** option:

**A. Share the folder (best).** In the Claude desktop app on your laptop: **Settings → Claude Code → Remote Control**, then add your socials folder. Tell me when it's done and I'll request access; you approve a prompt. After that I can read the folder and run the probes on your laptop. Folder sharing to cloud sessions isn't available on every account yet. If it's not offered, use B.

**B. Handoff file.** In your other Claude Code chat (the socials one), paste:

> Write `HANDOFF.md` in this folder for another engineer. Cover: what this project does; the Meta app (app ID, app mode Live/Development, Facebook Login or Instagram Login, which permissions/scopes were granted, how the token was made, whether it's short-lived, 60-day or a system-user token, and its expiry date); the Facebook Page name and IG username; where each secret is stored (file path + variable name only, **never the values**); any scripts that already post or read insights; and lessons learned. No secret values anywhere.

Then paste the contents of `HANDOFF.md` here. It contains no secrets, so that's safe.
