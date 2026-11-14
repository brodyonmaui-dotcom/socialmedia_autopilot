# Payload: AI practices for all of the creator's chats

Copy into each chat's folder (or a shared global `CLAUDE.md`). Public-safe.

## Prompting changes for Fable 5.2 (and newer models)
- **Give ownership.** "This codebase is yours; finish the work" beats step-by-step micromanagement.
- **Say "finish the work."** Ask for the whole deliverable, tested, not a plan for it.
- **Lower effort with the setting, not with words.** Use the effort/thinking setting; don't write "don't think" in prompts.
- **Tell the model its usage limits** ("you have ~X hours of usage left; if paused, stop at the last commit").
- **Delete stale "never" rules.** Old blanket prohibitions written for weaker models now cause over-refusal and timidity. Keep only the ones that protect something real (secrets, posting, money, privacy).
- **Name approvals exactly.** "Ask before: posting, buying, deleting, connecting accounts, placing orders" beats "be careful".

## Patterns
- **Opus works, Fable checks:** one model builds, a second pass (different model or fresh session) verifies against the spec and real sources. Same idea for facts: any quote, law or stat gets checked against a source URL before it ships.
- **Turn twice-repeated tasks into skills.** The second time you explain something, write it as a named skill file with explicit specs.
- **Scripts do the heavy lifting**; the model reads one-line summaries and opens logs only on FAIL.

## Fable 5.2 on Pro/Team plans: what's actually true (checked 2026-11-14)
An Instagram video claims Fable 5.2 is included in Pro/Team plans only until **Nov 16, 2026, 11:59 pm PT**, then moves to usage credits. Anthropic's help center confirms the core of it, with caveats:
- **Launch offer:** on **Pro plans and standard Team seats**, "all Fable models are included in your plan's weekly usage limits from launch on November 9, 2026 through November 16, 2026 at 11:59 pm PT", capped at "up to 50% of your weekly usage limits on Fable models at no extra cost". After that, "Fable models go back to running on usage credits on Pro plans and standard seats on Team plans." Unused allowance doesn't carry over. Source: https://support.claude.com/en/articles/17506494-claude-fable-5-2-launch-offers
- **Not cut off on Nov 16:** Max, Ultra and premium Team seats. Fable is included in those plans, and they also get one to three Fable limit resets that expire **March 8, 2027, 11:59 pm PT** (same article; also https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan).
- **Excluded from the offer:** Free and standard legacy Enterprise seats.
- "Pro/Team" in the video blurs Pro with *standard* Team seats; premium seats aren't affected.
- API list price (for reference): $8 / M input tokens, $40 / M output tokens (https://www.anthropic.com/claude-fable-and-mythos-5-2). The help center gives no usage-credit rate.
- **What it means here:** if the creator is on Pro, heavy Fable work should land before Nov 16, 11:59 pm PT; after that it draws usage credits (which cost money; ask before using them, per the budget rule). Opus/Sonnet/Haiku work is unaffected.

## Optional tool: Floorplan
- An interactive map of a codebase, for understanding the autopilot repo at a glance: https://github.com/haydenschmitty/floorplan (MIT, free, runs on your existing Claude Code plan, Node 18+).
- Install: `claude plugin marketplace add haydenschmitty/floorplan`, then `claude plugin install floorplan@floorplan`. Optional; read its code first like any plugin, and don't run it on repos holding secrets you haven't gitignored.
