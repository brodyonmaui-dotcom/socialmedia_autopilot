# Payload: workout video assembly chat

Copy this file into the workout-assembly chat's folder (e.g. as `CLAUDE.md` or `docs/autopilot-payload.md`) and tell that chat: "Adopt this payload; the handoff contract is mandatory."

Public-safe: no personal data. Sources are saved Instagram reels (2026-11); their view-count claims are unverified marketing, so only the processes are kept.

## What to adopt
### Filming
- Lower the exposure for a moodier gym look, and record in 4K so you can crop to 9:16 and punch in later (bfitcreator: https://www.instagram.com/p/DdWszYKGzHH/).
- Film far more than you need (@merik.hodgins, below).

### Grade (starting point, tune by eye)
- Cinematic gym grade: **Temperature +10, Luminosity +15, Exposure −20** (wansinbs: https://www.instagram.com/reel/DdfQICGoUpy/). Save it as a preset so every workout log matches.

### Storytelling without talking
- Sequence: **setting → details/close-ups → action**. Mix focal lengths (wide, mid, tight). Match the audio's pace to the edit's pace (merik.hodgins: https://www.instagram.com/reel/DaV4mHOMC--/).
- "Setting" means mood (light, chalk, the bar), never a recognizable place (see the privacy rule in the contract).

### The 7-step 60-second edit (aidendjohnston: https://www.instagram.com/reel/DegOQG6Tydw/)
1. Hook doc: write the on-screen hook line first (rules below).
2. WhisperX word-level timestamps for rough cuts.
3. Subtitles **2–3 words per cue**.
4. Music (see the sound rule).
5. B-roll, labelled by Claude from filenames/your notes (don't feed whole videos into context).
6. Hard cuts + occasional punch-in zooms.
7. Close. Our version: **no CTA** or one soft question (voice guide).

### Make it repeatable
- Any edit you've done twice becomes a **named skill file with explicit specs** (resolution, grade values, caption font/size/position, cue length, cut rules) (caleb_tankphoto: https://www.instagram.com/reel/DepWiuBqdhG/).
- Keep a **rules folder per series** (motion, captions, hook patterns) so every render inherits the same rules (speedy_devv). Suggested: `rules/workout-log/`, `rules/physique/`, `rules/single-set/`.

### Hooks and re-hooks (from the autopilot content playbook)
- Line 1 on screen is a complete claim, one sentence, specific nouns, not a question. Dry and calm ("Leg day and I are not on speaking terms…").
- **Footage is the asset, the hook is the experiment:** keep every approved render's source in a clip bank; a re-post changes only the hook *or* only the song, ≥ 7 days later. Never re-post the same clip to TikTok (duplicate-content rejection).

### Sound rule
- TikTok trending sound → export **without** music, set `soundInApp: true` (it goes as a TikTok inbox draft; he adds the sound there).
- Instagram / YouTube → original gym audio or a free-licence track cleared for that platform. Don't bake in commercial songs (muting / Content ID).

## Install steps
- **WhisperX:** https://github.com/m-bain/whisperX (BSD-2-Clause). `pip install whisperx` in a virtual env; needs ffmpeg. Runs locally; no account needed for transcription (speaker diarization needs a Hugging Face token: skip it, we don't need it).
- **ffmpeg:** your OS package manager.
- Strip location metadata on every export: `ffmpeg -i in.mp4 -map_metadata -1 -c copy out.mp4` (removes GPS/QuickTime location atoms; also check with `exiftool out.mp4 | grep -i -E "gps|location"` → no output).

## Cautions
- This chat **never posts** and never connects to any social account, Zernio or a posting MCP. It only writes to `ready-to-post/` after the creator approves.
- No paid generation tools, no yt-dlp music rips (copyright).
- Don't read whole videos into the model's context; work from filenames, timestamps and transcripts.

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
