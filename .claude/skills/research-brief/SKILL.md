---
name: research-brief
description: Build the weekly research brief from tracked creators (top hooks, hook patterns, what's working per pillar) and turn it into backlog ideas and hooks in the creator's voice. Use when the creator asks what's working for others, wants ideas or hooks, or before drafting a weekly batch.
---

# Research brief

Read-only on the platforms. Writes only to `logs/` and, with his OK, to the research backlog (ideas/hooks).

## Steps
1. Run the script:
   - With live data: `pnpm skill:research-brief` (creators from the DB). **The Business Discovery fetch is a stub** until its field list is verified against Meta's docs and logged in `docs/research.md`; until then it prints FAIL and you use a snapshot file.
   - With a snapshot: `pnpm skill:research-brief --fixture <file.json>` (shape: `packages/research/fixtures/research-sample.json`). He can paste numbers from the apps; you write the file in `logs/`.
2. Read the markdown file the one-line summary names. Hooks that named a place were already dropped; don't go looking for them.
3. Tag each top hook with its playbook formula (`docs/content-playbook.md` §1: superlative, negation swap, conditional warning, named law + stat, quiet-signal reframe, paradox). Keep processes, not view counts (creator numbers are unverified).
4. Turn the top patterns into **3–5 ideas and 3–5 hooks in his voice** (docs/voice.md): dry, calm, honest; one idea each, hooks per the playbook rules. Any named law, quote or stat in a hook needs a source URL first; no source, no anchor. Patterns, not copies: never reuse another creator's line verbatim, never mock or call out a creator.
5. Show them in chat. Add the ones he picks on the phone (Research → ideas / hooks), or, if he asks you to, insert them with `addIdea` / `addHook` from `packages/research` (they lint for privacy on write).

## Rules
- Creators are tracked by public handle only. Notes say why we follow them, never where they are.
- Engagement rate = (likes + comments) / followers. Say "n/a" when followers are unknown; never estimate.
- Small samples: say how many posts a pattern is based on. Fewer than 3 is an anecdote, not a pattern.
