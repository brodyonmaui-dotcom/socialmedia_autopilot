// DM helpers (F3): read + draft only. He sends every DM himself from the Instagram app; this module
// deliberately has no way to send anything. Drafts are template-first; a TriageClient may only pick
// the bucket (and, for fans, a short lead-in), never the text of a brand reply.
import { lintText } from "@autopilot/research";
import type { DmThreadInput, DmWindow, InboundComment, TriageClient } from "./types.js";

/** Instagram's standard messaging window: 24 h after the person's last message. */
export const DM_WINDOW_MS = 24 * 3_600_000;

export function dmWindow(lastInboundAt: string, now: Date): DmWindow {
  const start = Date.parse(lastInboundAt);
  if (!Number.isFinite(start)) return { endsAt: lastInboundAt, msLeft: 0, open: false };
  const end = start + DM_WINDOW_MS;
  const msLeft = Math.max(0, end - now.getTime());
  return { endsAt: new Date(end).toISOString(), msLeft, open: msLeft > 0 };
}

export function dmWindowLabel(w: DmWindow): string {
  if (!w.open || w.msLeft <= 0) return "window closed: copy + open Instagram";
  const totalMin = Math.floor(w.msLeft / 60_000);
  if (totalMin < 1) return "closes in under 1 min";
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return h > 0 ? `closes in ${h} h ${min} min` : `closes in ${min} min`;
}

export type DmKind = "brand" | "fan" | "question" | "other";

const BRAND = /\b(collab\w*|sponsor\w*|partnerships?|rates?|budget|campaigns?|ambassadors?)\b/i;
const FAN = /\b(thanks|thank you|thank u|thx|love|appreciate\w*)\b/i;

/** Brand wins over everything; a question wins over plain fan mail (it needs his answer). */
export function classifyDm(text: string): DmKind {
  if (BRAND.test(text)) return "brand";
  if (text.includes("?")) return "question";
  if (FAN.test(text)) return "fan";
  return "other";
}

export interface DmDraftInput {
  thread: DmThreadInput;
  blocklist?: string[];
}

export const DM_TEMPLATES = {
  brand:
    "Hey, thanks for reaching out, I appreciate you thinking of me. I'm open to hearing more: could you send over the deliverables, timeline and rate you have in mind? I'll look it over and get back to you.",
  fan: "Thanks for watching and for the support, it means a lot.",
  question: "Thanks for the message, appreciate it. I'll get back to you when I can.",
  plain: "Thanks for the message, appreciate it.",
} as const;

/** A question sentence about place, schedule or whereabouts. Drafts must never contain one. */
const LOCATION_QUESTION = /\b(where|when|location|located|city|town|area|gym|trail|live|based|schedule|train|tomorrow|tonight|today|time)\b/i;
function hasLocationQuestion(text: string): boolean {
  return (text.match(/[^.!?]*\?/g) ?? []).some((s) => LOCATION_QUESTION.test(s));
}

function clean(text: string, blocklist: string[] | undefined): boolean {
  const lint = lintText({ text, kind: "dm", platform: "instagram", blocklist });
  return lint.ok && !hasLocationQuestion(text);
}

export async function buildDmDraft(
  input: DmDraftInput,
  triage?: TriageClient,
): Promise<{ text: string; bucket: string; reasons: string[] } | null> {
  const { thread, blocklist } = input;
  const last = thread.messages.at(-1);
  if (!last || last.dir !== "in") return null;

  // Everything they sent since our last outbound message.
  const lastOut = thread.messages.map((m) => m.dir).lastIndexOf("out");
  const inbound = thread.messages.slice(lastOut + 1).filter((m) => m.dir === "in");
  const text = inbound.map((m) => m.text).join("\n");
  const reasons: string[] = [];

  let bucket: string = classifyDm(text);
  reasons.push(`rules: ${bucket}`);
  let fanLead: string | null = null;

  if (triage && bucket !== "brand") {
    const synthetic: InboundComment = {
      platform: "instagram",
      platformCommentId: `dm:${thread.platformThreadId}:${last.id}`,
      platformMediaId: `dm:${thread.platformThreadId}`,
      authorId: thread.participantId,
      ...(thread.handle ? { authorHandle: thread.handle } : {}),
      text,
      createdAt: last.at,
      isOwn: false,
      ownRepliesInThread: [],
    };
    const t = await triage.triage(synthetic, { pillar: null });
    reasons.push(`triage: ${t.bucket}`);
    if (t.bucket === "hide_flag") {
      bucket = "hide_flag";
      reasons.push("looks abusive or spam: review before answering");
    } else if (t.bucket === "simple_positive" && bucket !== "question") {
      bucket = "fan";
      if (t.reply && t.reply.trim().split(/\s+/).length <= 6) fanLead = t.reply.trim();
    } else if (t.bucket === "negative") {
      bucket = "other";
    } else if (t.bucket === "flag" && bucket === "fan") {
      bucket = "other";
    }
  }

  let draft: string;
  switch (bucket) {
    case "brand":
      draft = DM_TEMPLATES.brand;
      break;
    case "fan":
      draft = fanLead ? `${fanLead.replace(/[.\s]+$/, "")}. ${DM_TEMPLATES.fan}` : DM_TEMPLATES.fan;
      if (fanLead && !clean(draft, blocklist)) {
        reasons.push("model lead-in failed lint: template only");
        draft = DM_TEMPLATES.fan;
      }
      break;
    case "hide_flag":
      draft = DM_TEMPLATES.plain;
      break;
    default:
      draft = DM_TEMPLATES.question;
  }

  if (!clean(draft, blocklist)) {
    reasons.push("draft failed lint: plain thank-you");
    draft = DM_TEMPLATES.plain;
  }
  return { text: draft, bucket, reasons };
}
