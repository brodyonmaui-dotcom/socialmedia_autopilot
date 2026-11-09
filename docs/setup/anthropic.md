# Anthropic API key (comment/DM triage only)

1. console.anthropic.com → **Settings → Limits**: set a monthly spend limit of **$5**. Expected use is ~$1–2/mo.
2. Put the key in the server's `.env` as `ANTHROPIC_API_KEY=`.
3. Smoke test (6 sample comments, costs well under $0.01): `./infra/probe.sh ai`

Paste back: the `ai.*` lines. They show which bucket each sample comment landed in and the drafted reply.
