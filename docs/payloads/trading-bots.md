# Payload: trading bots chat

Copy this file into the trading-bots chat's folder and tell that chat: "Adopt this payload; the cautions are mandatory."

Public-safe: no personal data. **This is tooling, not advice.** Nothing here predicts price, and most day traders lose money.

## What to adopt: day-trader-skill
- Repo: https://github.com/Jakeschincariol/day-trader-skill · **MIT** (LICENSE confirmed) · plain Python 3.8+, standard library only.
- **Reviewed (2026-11-14, read-only, nothing installed or run): OK, with cautions below.**
- Free data sources only: Yahoo Finance (chart API + RSS; note this endpoint is unofficial), Nasdaq Trader symbol directory, SEC EDGAR (`data.sec.gov`), House Clerk disclosures. Also a `stooq.com` fallback in alerts. No telemetry, webhooks or unknown domains found.

### The 11 skills (folder → job)
| Skill | Job |
|---|---|
| trader-scanner | opening-range breakouts, flags, bounces |
| trader-news | headlines and 8-K filings |
| trader-entry | bar-by-bar trigger |
| trader-exit | stop and target plan |
| trader-timemachine | replays a setup 10,000× as **bootstrap draws from the stock's own last 60 days of 5-min bars**: a simulation, not a forecast |
| trader-risk | PASS / BLOCK against your configured limits |
| trader-budget | position sizing |
| trader-broker | order tickets; **paper by default**; records your typed "yes" |
| trader-alerts | price and clock alerts |
| trader-analyst | earnings facts |
| trader-pelosi | congressional trades tracker: **House** PTR filings only (Senate is manual) |

**Suggested flow:** scanner → news → entry → exit → timemachine → budget → risk → broker (alerts while a trade is open; news/analyst/pelosi on a schedule). Files pass along through a `trader/` folder.

**Configure the risk limits first** (`trader/config.json`): max loss per trade, max daily loss, max position size, max trades per day. Nothing else runs until risk can say BLOCK.

### Install (from the README; pin a commit)
- Option A: `/plugin marketplace add Jakeschincariol/day-trader-skill`, then `/plugin install day-trader-skill@day-trader-skill`.
- Option B: `git clone https://github.com/Jakeschincariol/day-trader-skill.git`, check out a specific commit SHA, then `cp -r day-trader-skill/trader-* ~/.claude/skills/` (or the project's `.claude/skills/`).
- Set `"sec_user_agent": "<name> <contact>"` in `trader/config.json` (SEC requires a user agent) or the `SEC_USER_AGENT` env var. Keep it out of any public repo.

## Review findings (concerns, not malice)
- **The approval gates are skill text + model behaviour, not code.** `ticket.py` refuses to approve unless risk passed today for that exact order fingerprint and your reply starts with "yes" (not a question, no "yes to all", no other symbol). But it only *prints* the order; the broker MCP's `place_stock_order` tool is what sends it, and nothing in code stops a model calling that tool directly. **The real hard gate is your tool permission setting**: set order tools to "Needs approval", never "Always allow".
- The broker route uses a third-party package (`uvx alpaca-mcp-server`), not vendored in the repo: vet it separately before connecting anything.
- `news.py` sends a browser-like User-Agent to Yahoo; the Yahoo chart endpoint is unofficial and can break or change terms.
- The public history is a single commit and the repo is very new with many open issues/PRs: maintainer responsiveness unknown. Re-read the diff before every update.
- The `ptr.py` script calls the local `pdftotext` binary (if installed) via subprocess; that's the only shell call.

## Reference only: autonomous "STARNET"-style bot
- A video shows an autonomous bot placing trades by itself. No setup or repo was given, and a search found no public "STARNET" repo. **Not adopting:** autonomous order placement is exactly what the approval-gated skill above avoids.

## Cautions (mandatory)
1. **Review the code first** (pin a SHA; read the diff on every update).
2. **Paper trading only.** `"paper": true` is the default; never flip it or the broker MCP's paper flag to live from a chat. Going live is a decision the creator makes himself, outside any chat, if ever.
3. **The creator's typed yes is required for every single order.** No batch approvals, no scheduled/automatic orders, no "yes to all".
4. Broker keys: paper keys only, in the MCP config's env block, never in chat, never in git, never printed.
5. Keep this out of the public social-media repo entirely.
6. Content from this chat that goes public (recaps, screenshots) follows the trade-recaps compliance rules: no signals, no advice, no return promises.
