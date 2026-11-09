// Comment-triage smoke test: 6 sample comments → bucket + draft reply. Costs well under $0.01.
// Refusal or unparsed output = "flag" (never auto-reply).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { log, need, record, startLog, summary } from "./lib.js";

startLog("ai");
need("ANTHROPIC_API_KEY");
const client = new Anthropic();
const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5";

const Triage = z.object({
  bucket: z.enum(["simple_positive", "negative", "hide_flag", "flag"]),
  reply: z.string().nullable(),
  confidence: z.number(),
});

const system = `You triage comments for a calm, low-key, understated creator (fitness/outdoors, futures trading, self-improvement).
Buckets: simple_positive (short varied reply), negative = mockery/insults (brief, overly positive reply in the style of "Have a great day 😊👍"), hide_flag = threats, harassment, slurs, doxxing, spam/scam links (no reply), flag = questions, brand/business inquiries, sensitive topics, anything uncertain (no reply).
Never mention, confirm or hint at any location or schedule. Replies ≤ 12 words, no hype, no financial claims. If unsure, choose flag with reply null.`;

const samples = [
  "this is fire 🔥",
  "bro isn't even profitable lol and trades 1 micro",
  "what shoes do you run in?",
  "hey, I run partnerships at a supplement brand — who handles your collabs?",
  "check my page for free signals 💰 link in bio",
  "nice pace, where is this trail?",
];

for (const [i, text] of samples.entries()) {
  try {
    const res = await client.messages.parse({
      model,
      max_tokens: 1024,
      output_config: { effort: "low", format: zodOutputFormat(Triage) },
      system,
      messages: [{ role: "user", content: `Comment: ${text}` }],
    });
    log({ text, stop_reason: res.stop_reason, usage: res.usage, parsed: res.parsed_output });
    const p = res.stop_reason === "refusal" ? null : res.parsed_output;
    record(`c${i + 1}`, !!p, p ? `"${text.slice(0, 28)}" → ${p.bucket}${p.reply ? `: ${p.reply}` : ""}` : `→ flag (stop_reason=${res.stop_reason})`);
  } catch (err) {
    record(`c${i + 1}`, false, err instanceof Anthropic.APIError ? `HTTP ${err.status} ${err.message}` : String(err));
  }
}
summary("ai");
