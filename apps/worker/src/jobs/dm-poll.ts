// Instagram DM poll (F3): read threads, store them, draft a reply for the newest inbound message.
// Read + draft only: DmSource has no send method and nothing here calls one.
import { buildDmDraft, type DmSource, type TriageClient } from "@autopilot/engagement";
import type { OutboxPool } from "./outbox.js";
import { PgEngagementStore, type EngagementJobStore } from "./engagement-store.js";

export const DM_CURSOR_KEY = "instagram-dm";

export type DmPollStore = Pick<EngagementJobStore, "loadSettings" | "getCursor" | "setCursor" | "upsertDmThreads" | "latestDraft" | "insertDmDraft">;
export interface DmPollResult { ran: boolean; threads: number; drafts: number; reason?: string }
export interface DmPollOptions { igUserId?: string | null; blocklist?: string[] }

export async function runDmPollWith(
  store: DmPollStore,
  source: DmSource | null,
  triage: TriageClient | null,
  log: (line: string) => void = console.log,
  now: Date = new Date(),
  opts: DmPollOptions = {},
): Promise<DmPollResult> {
  if (!source) return { ran: false, threads: 0, drafts: 0, reason: "no source" };
  const settings = await store.loadSettings();
  if (!settings.dmPollVerified) return { ran: false, threads: 0, drafts: 0, reason: "dmPollVerified=false" };

  const prev = await store.getCursor(DM_CURSOR_KEY);
  const { threads, cursor } = await source.fetchThreads(prev?.cursor ?? null);
  const stored = await store.upsertDmThreads(threads, opts.igUserId ?? null, now);
  await store.setCursor(DM_CURSOR_KEY, cursor, now);

  let drafts = 0;
  for (const { threadId, thread } of stored) {
    const messages = [...thread.messages].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const last = messages.at(-1);
    if (!last || last.dir !== "in") continue;
    const existing = await store.latestDraft(threadId);
    if (existing && existing.forPlatformMessageId === last.id) continue;
    const draft = await buildDmDraft({ thread: { ...thread, messages }, ...(opts.blocklist ? { blocklist: opts.blocklist } : {}) }, triage ?? undefined);
    if (!draft) continue;
    await store.insertDmDraft(threadId, last.id, draft.text, draft.bucket);
    drafts++;
  }
  if (stored.length) log(`[dm] poll: ${stored.length} thread(s) · ${drafts} new draft(s)`);
  return { ran: true, threads: stored.length, drafts };
}

export async function runDmPollOnce(
  pool: OutboxPool,
  source: DmSource | null,
  triage: TriageClient | null,
  log: (line: string) => void = console.log,
  now: Date = new Date(),
  opts: DmPollOptions = {},
): Promise<DmPollResult> {
  return runDmPollWith(new PgEngagementStore(pool), source, triage, log, now, opts);
}
