---
name: platform-check
description: Re-verify platform facts the build depends on (Instagram Graph API, YouTube Data API, Zernio/TikTok, Snapchat sharing) against official docs, flag stale or open items and upcoming token/data-access deadlines, and update the verification log in docs/research.md. Use at the start of a milestone, monthly, or when a platform call starts failing.
---

# Platform check

CLAUDE.md non-negotiable 7: verify platform facts against official docs at build time; update `docs/research.md` when something changed.

## Steps
1. `pnpm skill:platform-check` → one line: open items, last verification date, deadlines (WARN when Meta data access or a token is within its warning window). Details in `logs/platform-check-<date>.md`.
2. For each open item and each fact the next milestone depends on, read the **official** page:
   - Zernio: `curl -s https://docs.zernio.com/llms.txt`, then `curl -s https://docs.zernio.com/<page>.mdx` (WebFetch doesn't resolve it here).
   - YouTube: developers.google.com/youtube/v3 (revision history + the `videos.insert` reference).
   - Meta: developers.facebook.com may not resolve from a cloud session; then say so and use web search summaries marked "M0-test", never as settled facts.
   - Snapchat: developers.snap.com Creative Kit pages.
3. Compare with `docs/research.md` and `packages/core/src/capabilities.ts`. Only when something changed or got confirmed, append a dated entry to the **verification log** at the end of `docs/research.md` (what, source, impact). Strike through (`~~…~~`) "Still open" items that are now resolved; don't delete history.
4. If a fact change affects adapters or limits, list it for the creator as a decision; don't change adapter behavior in the same step.
5. Deadlines: if Meta data access is within 14 days, tell him to re-run `probe:connect-meta` on the VPS (he runs it; cloud sessions can't SSH).

## Never
- Use tokens or make write calls to any platform. Read-only GETs of public docs only.
- Commit domains, IPs, time zones or account IDs that reveal location.
