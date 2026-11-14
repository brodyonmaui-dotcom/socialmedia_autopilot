# Payload: trade-recap shorts chat

Copy this file into the trade-recaps chat's folder (e.g. as `CLAUDE.md` or `docs/autopilot-payload.md`) and tell that chat: "Adopt this payload; the handoff contract and compliance rules are mandatory."

Public-safe: no personal data. Sources are saved Instagram reels (2026-11); creator view counts are unverified, so only the processes are kept.

## Compliance (non-negotiable)
- Recaps describe **his own trades** as a journal: what he did, the real numbers he gave you, the honest lesson.
- **No advice, no signals, no return promises.** Never "buy/sell here", never "this setup works", never imply viewers will make money. No live calls, no "watch this level tomorrow".
- Real numbers only. Missing → `{{P/L}}` and ask. Never round up, never spin a loss.
- "Not financial advice." at the end of every caption that shows a setup or P/L.
- Blur or crop account numbers, balances he hasn't chosen to show, broker usernames and anything else identifying in screen recordings.

## Script structures
- **Hook (emotion) → Super hook (credibility) → Open loop** (@kierzacporter, https://www.instagram.com/reel/DdB54MDoQWM/). Ours: "Welp, I was the liquidity today 🥀" → "I took this trade live" → "the second move is what mattered."
- **Hook → Lead → Body 1 → Open loop → Body 2 → Open loop → Body 3 → close** (@realskytan, https://www.instagram.com/reel/DambEp1igDW/). Our close is no CTA, or one soft question.
- Hook rules: one sentence, a claim not a question, specific nouns, calm. No hype.

## Re-hook testing
- **Footage is the asset, the hook is the experiment** (@zac_spencer, https://www.instagram.com/reel/DcmKoU1hVF3/). Keep a clip bank of approved recaps; a re-post changes only the hook (on-screen line 1 + caption line 1) or only the audio, ≥ 7 days later, never on TikTok (duplicate-content rejection). A re-posted recap still says the original date.

## Retention rubric (when the creator shares a recap's numbers)
From @cookin.code (https://www.instagram.com/reel/DfsPYGvCQ3N/):
| Diagnosis | Signal | Fix |
|---|---|---|
| BAD HOOK | most viewers leave in the first 3 s (high skip rate) | cut the intro, lead with the payoff |
| MID DROP-OFF | retention falls at one timestamp | add a re-hook / open loop there |
| HELD BACK | reach far below normal (originality flag) | post original edits, not re-uploads |
Verify a fix by comparing old vs new retention on the same footage.

## Editing pattern
- WhisperX word-level timestamps for rough cuts (https://github.com/m-bain/whisperX, BSD-2-Clause; `pip install whisperx` in a venv, needs ffmpeg; skip diarization).
- Subtitles **2–3 words per cue**; hard cuts; occasional punch-in on the chart at the key candle.
- Any edit done twice → a named skill file with explicit specs (@caleb_tankphoto, https://www.instagram.com/reel/DepWiuBqdhG/); a rules folder for the recap series (@speedy_devv).
- Strip metadata on export: `ffmpeg -i in.mp4 -map_metadata -1 -c copy out.mp4`.

## Cautions
- This chat **never posts** or connects to social accounts, Zernio or posting MCPs. It writes to `ready-to-post/` only after the creator approves.
- Same-day recaps: set `"when": "today"` and an `earliest` after the market close.

## THE HANDOFF CONTRACT (version 1)
This section is identical in `workout-assembly.md` and `trade-recaps.md`. The autopilot app is built against it; don't change field names. If you need a change, ask the creator to raise it in the autopilot chat first (it becomes version 2).

**When the creator approves a render in this chat**, save two files into the `ready-to-post` folder inside his socials folder:
- `<name>.mp4`: the final render (vertical 9:16, location metadata stripped; see cautions).
- `<name>.post.json`: the sidecar below, same `<name>`.

```json
{ "version": 1,
  "pillar": "trade-recap | workout-log | physique | single-set | yap | other",
  "platforms": ["instagram","youtube","tiktok","snapchat"],
  "when": "today | tomorrow | this-week",
  "earliest": "HH:MM (optional, creator-local)",
  "caption": { "instagram": "…", "tiktok": "…", "youtube": { "title": "…", "description": "…" }, "snapchat": "…" },
  "soundInApp": false,
  "approvedInEditor": "<ISO timestamp>",
  "source": "workout-assembly | trade-recaps | manual" }
```

Field rules:
- `pillar`: exactly one of the listed values. `platforms`: any subset, in that spelling.
- `when` + optional `earliest` (24 h `HH:MM`, the creator's local wall clock; never write a time zone name or offset).
- `caption`: one entry per platform in `platforms`. YouTube `title` ≤ 60 characters.
- `soundInApp: true` means the creator adds a sound inside the app (TikTok goes as an inbox draft). Then the mp4 has **no** music baked in.
- `approvedInEditor`: when he approved the render here (ISO 8601). Write the sidecar **only** after his explicit approval; never pre-fill it.
- `source`: this chat's name.

**Caption rules** (excerpt from the creator's voice guide; follow it exactly):
- Calm, honest, a little dry. Self-roast before anyone else can. No hype, no all caps, no "INSANE", "let's gooo", no 🔥💯🚀💪 strings. 0–1 emoji, usually at the end, often ironic (🥀 😔 🤷🏼‍♂️ 🙂‍↕️ 😊).
- Gym one-liner: one line, deadpan + "…" or one ironic emoji ("My lats are not a fan of this pull day…").
- Trading recap: date or "today" → what happened with **real numbers he gave you** → the honest lesson, commas over periods ("November 2nd P/L +$806, SMT + BOS towards data high for a 1:1R. Happy to take profits before price reversed…"). Losses get the same honesty. Missing number → write `{{P/L}}` and ask; never invent or round. Add "Not financial advice." at the end on any recap with a setup or P/L. No signals, no "buy/sell here".
- Hashtags: Instagram **≤ 5**, TikTok 3–5, YouTube 3 in the description, Snapchat 1–2 topic tags. From his set: `#daytrading #nasdaq #ict #gym #gymbro #physique #discipline #hypertrophy #collegefitness`.
- YouTube: title ≤ 60 chars (the one-liner or a plain hook); description 1–2 sentences + 3 hashtags (+ "Not financial advice." for trading). TikTok: shorter than IG. Snapchat: the one-liner only.
- CTAs rare and soft; never "follow for more", "comment X", "link in bio".
- **Privacy:** never name a gym, trail, city, campus, school, employer or any identifiable place; never describe surroundings that pinpoint one; never pair a place with "right now". **Nothing location-revealing in the footage either**: no signs, logos of a specific gym, street views, windows with landmarks, mail/ID, screens showing account numbers.

**What happens next:** the app ingests the folder, schedules the post into a slot, and asks the creator for **one tap of approval** before anything posts. This chat never posts, schedules or uploads anything itself.
