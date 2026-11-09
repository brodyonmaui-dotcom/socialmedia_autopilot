# TikTok via Zernio (~15 min, free for 2 accounts)

Zernio's docs (read 2026-11-09) say new TikTok connections use TikTok's Business API. That works with **Personal** accounts (only DMs need a Business account), so your viral sounds stay available. We still verify it, because losing them would be costly.

1. Sign up at zernio.com (no card needed for 2 accounts). Turn on 2FA if offered.
2. `[OK?]` **Connect TikTok** from the Zernio dashboard. **Read TikTok's consent screen.** If it asks to switch your account to a Business account, **stop and cancel**, then tell me.
3. After connecting, check in the TikTok app: **Profile → ☰ → Settings and privacy → Account**. If it still offers "Switch to Business account", you're still Personal. 
4. Zernio → **Settings → API keys → Create**. Put it in the server's `.env` as `ZERNIO_API_KEY=`.
5. Read-only + Zernio dry run: `./infra/probe.sh tiktok`. It lists the account, your allowed privacy levels, and runs Zernio's `dryRun`. Nothing is posted.

Paste back: the `tiktok.*` lines + "still Personal: yes/no".
