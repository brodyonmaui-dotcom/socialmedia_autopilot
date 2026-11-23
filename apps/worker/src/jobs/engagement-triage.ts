// Engagement triage (F3): rules first, model only when no rule hit, then the planner. Shadow mode stores
// the planned action as 'shadow' (shown in the inbox, never sent). flag/none add nothing: the triage row
// is the inbox entry.
// Run 4: promo spam (promo rule or promo list) gets a triage row and nothing else: no action row, no
// ping. "Not spam" items come back here once with the promo rule off. Pings (reply-ready alerts) are paced
// by settings engagement.pings; they only notify, they never send anything.
import {
  planActions,
  planPings,
  postRules,
  preRules,
  promoAuthorKey,
  RULES_ONLY_MODEL,
  type Bucket,
  type PingItem,
  type PromoAccount,
  type TriageClient,
  type TriageResult,
} from "@autopilot/engagement";
import type { OutboxPool } from "./outbox.js";
import { PgEngagementStore, type EngagementJobStore, type InboxJobStore } from "./engagement-store.js";

export type TriageStore = Pick<
  EngagementJobStore,
  "loadSettings" | "listUntriaged" | "saveTriage" | "insertAction" | "lastRepliesOn" | "repliesToAuthorSince" | "countSent" | "textUseCount" | "isBlockedAuthor"
> &
  Partial<Pick<InboxJobStore, "loadPromoAccounts" | "promoHitCount" | "addPromoAccount" | "pingState" | "insertReplyReadyAlert">>;

/** A text-rule promo hit from an author already seen spamming once puts them on the list (source 'rule'). */
export const PROMO_RULE_LIST_AFTER = 2;

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
  promoListed: number;
  pings: number;
}

export async function runEngagementTriageWith(store: TriageStore, triage: TriageClient, cfg: TriageJobConfig, limit = 20): Promise<TriageJobResult> {
  const now = cfg.now ?? new Date();
  const log = cfg.log ?? console.log;
  const out: TriageJobResult = { triaged: 0, modelCalls: 0, buckets: {}, actions: {}, planned: 0, shadow: 0, promoListed: 0, pings: 0 };
  const items = await store.listUntriaged(limit);
  const settings = await store.loadSettings();
  const promoAccounts: PromoAccount[] = items.length && store.loadPromoAccounts ? await store.loadPromoAccounts() : [];
  const pingItems: PingItem[] = [];

  for (const { id, comment: c, ctx, skipPromo } of items) {
    let result: TriageResult;
    const hit = preRules(c, cfg.blocklist, { promoAccounts, skipPromo: skipPromo === true });
    if (hit) {
      result = { bucket: hit.bucket, reply: null, confidence: 1, reasons: [hit.reason], model: "rules" };
    } else {
      out.modelCalls++;
      result = postRules(await triage.triage(c, ctx), c, cfg.blocklist, { allowPromo: skipPromo !== true });
    }
    if (skipPromo) result = { ...result, reasons: ["not spam (creator)", ...result.reasons] };
    await store.saveTriage(id, result, now);
    out.triaged++;
    out.buckets[result.bucket] = (out.buckets[result.bucket] ?? 0) + 1;

    if (result.bucket === "spam_promo") {
      // Repeat text-rule spammers go on the list. A list hit is already listed; "Not spam" items never reach here.
      const key = promoAuthorKey(c.authorId, c.authorHandle);
      if (key && !result.reasons.includes("promo:list") && store.promoHitCount && store.addPromoAccount) {
        if ((await store.promoHitCount(c.platform, c.authorId, c.authorHandle ?? null)) >= PROMO_RULE_LIST_AFTER) {
          if (await store.addPromoAccount(c.platform, key, c.authorHandle ?? null, "rule", now)) out.promoListed++;
        }
      }
      out.actions.none = (out.actions.none ?? 0) + 1;
      continue; // no engagement_actions row at all, no ping
    }

    // Rules-only drafts (no model key, F20 B) are always drafts: never auto-sent, whatever the mode.
    const status = settings.mode[c.platform] === "live" && result.model !== RULES_ONLY_MODEL ? "planned" : "shadow";
    let drafted: string | null = null;
    for (const a of await planActions(c, result, settings, store, now)) {
      out.actions[a.kind] = (out.actions[a.kind] ?? 0) + 1;
      if (a.kind !== "reply" && a.kind !== "hide") continue;
      const text = a.kind === "reply" ? a.text : null;
      if (await store.insertAction(id, a.kind, text, status, a.notBefore, now)) {
        out[status]++;
        if (a.kind === "reply" && status === "shadow") drafted = text;
      }
    }
    const flagged = result.bucket === "flag" || result.bucket === "hide_flag";
    if (drafted !== null || flagged) {
      pingItems.push({ commentId: id, platform: c.platform, authorHandle: c.authorHandle ?? null, text: c.text, draft: drafted, reasons: result.reasons });
    }
  }

  if (store.pingState && store.insertReplyReadyAlert && settings.pings !== "off") {
    const pings = planPings(settings.pings, pingItems, await store.pingState(now), now, cfg.blocklist);
    for (const p of pings) {
      await store.insertReplyReadyAlert(p.kind === "item" ? p.commentId : null, p.kind === "item" ? p.platform : (p.platform ?? "all"), p.message, now);
      out.pings++;
    }
  }

  if (out.triaged || out.pings) {
    const buckets = Object.entries(out.buckets).map(([k, n]) => `${k} ${n}`).join(", ");
    log(`[engage] triage: ${out.triaged} comment(s) · model ${out.modelCalls} · ${buckets} · planned ${out.planned} · shadow ${out.shadow} · pings ${out.pings}${out.promoListed ? ` · promo listed ${out.promoListed}` : ""}`);
  }
  return out;
}

export async function runEngagementTriageOnce(pool: OutboxPool, triage: TriageClient, cfg: TriageJobConfig, limit = 20): Promise<TriageJobResult> {
  return runEngagementTriageWith(new PgEngagementStore(pool), triage, cfg, limit);
}
