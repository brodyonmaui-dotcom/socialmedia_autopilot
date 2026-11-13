// Engagement triage (F3): rules first, model only when no rule hit, then the planner. Shadow mode stores
// the planned action as 'shadow' (shown in the inbox, never sent). flag/none add nothing: the triage row
// is the inbox entry.
import { planActions, postRules, preRules, type Bucket, type TriageClient, type TriageResult } from "@autopilot/engagement";
import type { OutboxPool } from "./outbox.js";
import { PgEngagementStore, type EngagementJobStore } from "./engagement-store.js";

export type TriageStore = Pick<
  EngagementJobStore,
  "loadSettings" | "listUntriaged" | "saveTriage" | "insertAction" | "lastRepliesOn" | "repliesToAuthorSince" | "countSent" | "textUseCount" | "isBlockedAuthor"
>;

export interface TriageJobConfig {
  blocklist: string[];
  now?: Date;
  log?: (line: string) => void;
}

export interface TriageJobResult {
  triaged: number;
  modelCalls: number;
  buckets: Partial<Record<Bucket, number>>;
  actions: Partial<Record<"reply" | "hide" | "flag" | "none", number>>;
  planned: number;
  shadow: number;
}

export async function runEngagementTriageWith(store: TriageStore, triage: TriageClient, cfg: TriageJobConfig, limit = 20): Promise<TriageJobResult> {
  const now = cfg.now ?? new Date();
  const log = cfg.log ?? console.log;
  const out: TriageJobResult = { triaged: 0, modelCalls: 0, buckets: {}, actions: {}, planned: 0, shadow: 0 };
  const items = await store.listUntriaged(limit);
  if (!items.length) return out;
  const settings = await store.loadSettings();

  for (const { id, comment: c, ctx } of items) {
    let result: TriageResult;
    const hit = preRules(c, cfg.blocklist);
    if (hit) {
      result = { bucket: hit.bucket, reply: null, confidence: 1, reasons: [hit.reason], model: "rules" };
    } else {
      out.modelCalls++;
      result = postRules(await triage.triage(c, ctx), c, cfg.blocklist);
    }
    await store.saveTriage(id, result, now);
    out.triaged++;
    out.buckets[result.bucket] = (out.buckets[result.bucket] ?? 0) + 1;

    const status = settings.mode[c.platform] === "live" ? "planned" : "shadow";
    for (const a of await planActions(c, result, settings, store, now)) {
      out.actions[a.kind] = (out.actions[a.kind] ?? 0) + 1;
      if (a.kind !== "reply" && a.kind !== "hide") continue;
      const text = a.kind === "reply" ? a.text : null;
      if (await store.insertAction(id, a.kind, text, status, a.notBefore, now)) out[status]++;
    }
  }
  const buckets = Object.entries(out.buckets).map(([k, n]) => `${k} ${n}`).join(", ");
  log(`[engage] triage: ${out.triaged} comment(s) · model ${out.modelCalls} · ${buckets} · planned ${out.planned} · shadow ${out.shadow}`);
  return out;
}

export async function runEngagementTriageOnce(pool: OutboxPool, triage: TriageClient, cfg: TriageJobConfig, limit = 20): Promise<TriageJobResult> {
  return runEngagementTriageWith(new PgEngagementStore(pool), triage, cfg, limit);
}
