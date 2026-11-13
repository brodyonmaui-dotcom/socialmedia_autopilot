/**
 * simulate-engagement: 200 synthetic comments through the whole F3 pipeline over fakes.
 * preRules → fake triage → postRules → planActions → stored rows → runSendTick over scripted fake
 * sources (instagram + youtube). No network, no DB, no real clock, nothing sent anywhere.
 * The fake sources' call ledger and the store are the oracle for the invariants; each invariant is a
 * counter in the report and any counter above 0 makes `ok` false (the CLI exits 1).
 */
import { lintText } from "@autopilot/research";
import { DEFAULT_RETRY_POLICY } from "@autopilot/core";
import { planActions } from "../planner.js";
import { seededRng } from "../rotation.js";
import { postRules, preRules } from "../rules.js";
import { runSendTick } from "../send.js";
import { DEFAULT_ENGAGEMENT } from "../settings.js";
import { createFakeTriageClient } from "../triage-fake.js";
import { MemoryEngagementStore, type MemoryActionRow } from "../testing/fake-store.js";
import { FakeCommentSource, type FakeBehaviour } from "../testing/fake-source.js";
import type { Bucket, EngagementAlert, EngagementPlatform, EngagementSettings, InboundComment, TriageClient, TriageResult } from "../types.js";

export interface SimulateEngagementOptions {
  /** Comments generated, duplicates included (default 200). */
  comments?: number;
  seed?: string;
  /** shadow: rows stored as `shadow`, settings shadow. live-fake: both platforms live, rows due at once. */
  mode?: "shadow" | "live-fake";
  keepLog?: boolean;
  /** Replace the fake triage (tests inject a bad one). */
  triage?: TriageClient;
  /** TEST ONLY: skip preRules/postRules so a bad triage reaches the planner and the invariants must catch it. */
  unsafeSkipRules?: boolean;
}

export type Category = "praise" | "emoji" | "mockery" | "fake" | "threat" | "scam" | "question" | "location" | "brand" | "market" | "own";

export interface EngagementInvariants {
  doubleReplies: number;
  limitBreaches: number;
  locationLeaks: number;
  /** reply planned/sent to a location, brand, question, scam or threat comment */
  unsafeReplies: number;
  ownReplies: number;
  hidesWhileDisabled: number;
  shadowSends: number;
  unknownResent: number;
}

export interface SimulateEngagementReport {
  ok: boolean;
  mode: "shadow" | "live-fake";
  seed: string;
  comments: number;
  unique: number;
  duplicatesIgnored: number;
  categories: Partial<Record<Category, number>>;
  buckets: Partial<Record<Bucket, number>>;
  replies: number;
  hides: number;
  flags: number;
  sent: number;
  retried: number;
  failed: number;
  unknown: number;
  pending: number;
  ticks: number;
  killedNow: string | null;
  invariants: EngagementInvariants;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  alerts: Partial<Record<string, number>>;
  actions: Array<Pick<MemoryActionRow, "id" | "platform" | "platformCommentId" | "kind" | "text" | "status" | "attempts" | "lastError">>;
  log: string[];
  summary: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const START = new Date("2026-01-05T15:00:00Z"); // fixed and arbitrary: says nothing about the creator
const MAX_TICKS = 200;
const PER_TICK = 2; // comments arriving per simulated minute
const PLATFORMS: EngagementPlatform[] = ["instagram", "youtube"];
const UNSAFE: ReadonlySet<Category> = new Set(["location", "brand", "question", "scam", "threat"]);
/** Place/schedule words a reply must never contain (on top of lintText's privacy rules). */
const PLACE_WORD = /\b(?:where|location|address|gym|trail|park|beach|city|town|street|near|lake|mountain|tonight|tomorrow)s?\b/i;

const TEMPLATES: Array<[Category, number, string[]]> = [
  ["praise", 24, ["love this", "great video man", "nice form", "thank you for this", "so clean", "love the energy", "this is fire 🔥", "great tip, thanks"]],
  ["emoji", 6, ["🔥🔥🔥", "🙌", "💯"]],
  ["mockery", 8, ["lol no", "cringe", "this is so cringe bro", "lol no way that works"]],
  ["fake", 5, ["this is so fake", "paid actor", "fake gains"]],
  ["threat", 4, ["kys", "kill yourself", "i know where you live"]],
  ["scam", 5, ["send me $50 and i'll double it", "giveaway winner! claim at www.example.test", "join my crypto group t.me/example"]],
  ["question", 10, ["what program do you run?", "how long have you been training?", "what's your split?", "how many calories do you eat?"]],
  ["location", 10, ["where is this trail?", "what gym is this", "which park is that", "are you at the beach tomorrow", "what city do you train in?"]],
  ["brand", 7, ["collab?", "we'd love a brand partnership, dm us", "sponsor opportunity for you", "dm me for a promo"]],
  ["market", 6, ["clean NY session today", "great London open trade", "nice Asia session read"]],
  ["own", 3, ["thanks everyone for the support"]],
];

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length) % xs.length]!;
}
function weighted(rng: () => number): [Category, string[]] {
  const total = TEMPLATES.reduce((n, [, w]) => n + w, 0);
  let r = rng() * total;
  for (const [cat, w, texts] of TEMPLATES) {
    if ((r -= w) < 0) return [cat, texts];
  }
  const last = TEMPLATES[TEMPLATES.length - 1]!;
  return [last[0], last[2]];
}

interface SimComment { c: InboundComment; category: Category }

function generate(n: number, rng: () => number): SimComment[] {
  const out: SimComment[] = [];
  const repeatAuthors = ["fan-a", "fan-b", "fan-c", "fan-d", "fan-e"];
  for (let i = 0; i < n; i++) {
    if (out.length > 5 && rng() < 0.05) {
      out.push(pick(rng, out)); // exact duplicate (same platform + id): the comment store must ignore it
      continue;
    }
    const [category, texts] = weighted(rng);
    const platform: EngagementPlatform = rng() < 0.6 ? "instagram" : "youtube";
    const a = rng();
    const authorId = category === "own" ? "creator" : a < 0.1 ? null : a < 0.25 ? pick(rng, repeatAuthors) : `user-${i}`;
    const c: InboundComment = {
      platform,
      platformCommentId: `${platform === "instagram" ? "ig" : "yt"}-c${i}`,
      platformMediaId: `${platform}-media-${i % 7}`,
      authorId,
      text: pick(rng, texts),
      createdAt: new Date(START.getTime() + Math.floor(i / PER_TICK) * MIN).toISOString(),
      isOwn: category === "own",
      ownRepliesInThread: category !== "own" && rng() < 0.08 ? [{ platformCommentId: `own-${i}`, text: "haha thanks, more soon", createdAt: START.toISOString() }] : [],
    };
    out.push({ c, category });
  }
  return out;
}

const key = (platform: string, id: string) => `${platform}:${id}`;

export async function simulateEngagement(opts: SimulateEngagementOptions = {}): Promise<SimulateEngagementReport> {
  const n = opts.comments ?? 200;
  const seed = opts.seed ?? "simulate-engagement";
  const mode = opts.mode ?? "shadow";
  const live = mode === "live-fake";
  const rng = seededRng(seed);
  const log: string[] = [];
  const triage = opts.triage ?? createFakeTriageClient();
  const settings: EngagementSettings = {
    ...DEFAULT_ENGAGEMENT,
    mode: live ? { instagram: "live", youtube: "live", tiktok: "off" } : { ...DEFAULT_ENGAGEMENT.mode },
  };
  const policy = { ...DEFAULT_RETRY_POLICY, lookupTimeoutMs: 50 };

  const store = new MemoryEngagementStore();
  const sources = new Map<EngagementPlatform, FakeCommentSource>(PLATFORMS.map((p) => [p, new FakeCommentSource(p)]));
  const scripts = new Map<string, FakeBehaviour[]>(); // key(platform, commentId) → script (our copy; the fake consumes its own)
  const commentStore = new Map<string, SimComment>();
  const categoryOf = new Map<string, Category>();
  const generated = generate(n, rng);

  const report: SimulateEngagementReport = {
    ok: false, mode, seed, comments: generated.length, unique: 0, duplicatesIgnored: 0, categories: {}, buckets: {},
    replies: 0, hides: 0, flags: 0, sent: 0, retried: 0, failed: 0, unknown: 0, pending: 0, ticks: 0, killedNow: null,
    invariants: { doubleReplies: 0, limitBreaches: 0, locationLeaks: 0, unsafeReplies: 0, ownReplies: 0, hidesWhileDisabled: 0, shadowSends: 0, unknownResent: 0 },
    checks: [], alerts: {}, actions: [], log, summary: "",
  };
  const alerts: EngagementAlert[] = [];

  async function ingest(sc: SimComment, now: Date): Promise<void> {
    const { c, category } = sc;
    const k = key(c.platform, c.platformCommentId);
    if (commentStore.has(k)) {
      report.duplicatesIgnored++;
      return;
    }
    commentStore.set(k, sc);
    categoryOf.set(k, category);
    report.unique++;
    report.categories[category] = (report.categories[category] ?? 0) + 1;
    const src = sources.get(c.platform)!;
    src.threads.set(c.platformCommentId, { ...c, ownRepliesInThread: [...c.ownRepliesInThread] });
    const r = rng();
    const script: FakeBehaviour[] | null = r < 0.05 ? ["reject", "ok"] : r < 0.08 ? ["timeout"] : r < 0.1 ? ["permanent"] : null;
    if (script) {
      scripts.set(k, [...script]);
      src.behaviours.set(c.platformCommentId, [...script]);
    }

    let t: TriageResult;
    const hit = opts.unsafeSkipRules ? null : preRules(c);
    if (hit) t = { bucket: hit.bucket, reply: null, confidence: 1, reasons: [hit.reason], model: "rules" };
    else {
      t = await triage.triage(c, {});
      if (!opts.unsafeSkipRules) t = postRules(t, c);
    }
    report.buckets[t.bucket] = (report.buckets[t.bucket] ?? 0) + 1;

    for (const p of await planActions(c, t, settings, store, now)) {
      if (p.kind === "flag") report.flags++;
      if (p.kind !== "reply" && p.kind !== "hide") continue;
      if (p.kind === "reply") report.replies++;
      else report.hides++;
      store.addAction({
        id: `act-${c.platformCommentId}-${p.kind}`,
        commentId: k,
        platform: c.platform,
        platformCommentId: c.platformCommentId,
        authorId: c.authorId,
        kind: p.kind,
        text: p.kind === "reply" ? p.text : null,
        idempotencyKey: `engage:${c.platform}:${c.platformCommentId}:${p.kind}`,
        status: live ? "planned" : "shadow",
        // live-fake skips the veto window so rows are due at once; shadow keeps the planner's time
        notBefore: live ? new Date(now.getTime() - 1000).toISOString() : p.notBefore,
        origin: "auto",
        createdAt: now.toISOString(),
      });
    }
  }

  // ---- run: comments arrive PER_TICK a minute; one send tick per minute
  let now = START;
  let cursor = 0;
  let killed = false;
  let blockInjected: string | null = null;
  const blockAfter = Math.floor((generated.length / PER_TICK) * 0.75);
  while (report.ticks < MAX_TICKS) {
    report.ticks++;
    for (let i = 0; i < PER_TICK && cursor < generated.length; i++) await ingest(generated[cursor++]!, now);

    // Late in the run, the next instagram reply that will actually be sent gets an "Action Blocked".
    if (live && !blockInjected && report.ticks >= blockAfter) {
      for (const a of await store.listDueActions(now, 100)) {
        if (a.platform !== "instagram" || a.kind !== "reply" || a.attempts > 0) continue;
        if ((await store.limitCounts(a.platform, a.authorId, settings.limits, now)).authorWindow > 0) continue;
        blockInjected = a.id;
        scripts.set(key(a.platform, a.platformCommentId), ["block"]);
        sources.get("instagram")!.behaviours.set(a.platformCommentId, ["block"]);
        break;
      }
    }

    const r = await runSendTick(store, sources as Map<EngagementPlatform, FakeCommentSource>, {
      settings: { ...settings, killed },
      dryRun: false,
      killEnv: false,
      policy,
      now: () => now,
      timeoutMs: 5,
      log: opts.keepLog ? (l) => log.push(`${now.toISOString()} ${l}`) : undefined,
    });
    report.sent += r.sent;
    report.retried += r.retried;
    alerts.push(...r.alerts);
    if (r.killedNow) {
      killed = true;
      report.killedNow = r.killedNow;
    }
    // The platform now shows our sent replies in the thread (what a re-fetch before a retry would see).
    for (const a of store.actions) {
      if (a.status !== "sent" || a.kind !== "reply" || !a.platformActionId) continue;
      const th = sources.get(a.platform)?.threads.get(a.platformCommentId);
      if (th && !th.ownRepliesInThread.some((o) => o.platformCommentId === a.platformActionId)) {
        th.ownRepliesInThread.push({ platformCommentId: a.platformActionId, text: a.text ?? "", createdAt: now.toISOString() });
      }
    }
    if (cursor >= generated.length && (killed || (await store.listDueActions(now, 1)).length === 0)) break;
    now = new Date(now.getTime() + MIN);
  }

  // ---- invariants (oracle: the fake sources' call ledger + the store)
  const inv = report.invariants;
  const createdBy = (b: FakeBehaviour) => b === "ok" || b === "timeout"; // a timeout may have created it
  for (const [p, src] of sources) {
    const byComment = new Map<string, number>();
    for (const call of src.calls) byComment.set(call.platformCommentId, (byComment.get(call.platformCommentId) ?? 0) + 1);
    for (const [id, calls] of byComment) {
      const script = scripts.get(key(p, id)) ?? ["ok"];
      let created = 0;
      for (let i = 0; i < calls; i++) if (createdBy(script[Math.min(i, script.length - 1)]!)) created++;
      if (created > 1) inv.doubleReplies++;
      if (!live) inv.shadowSends += calls;
    }
    if (!settings.hideEnabled[p]) inv.hidesWhileDisabled += src.calls.filter((c) => c.op === "hide").length;
  }
  const perCommentKind = new Map<string, number>();
  for (const a of store.actions) {
    const k = `${a.commentId}|${a.kind}`;
    perCommentKind.set(k, (perCommentKind.get(k) ?? 0) + 1);
  }
  inv.doubleReplies += [...perCommentKind.values()].filter((v) => v > 1).length;

  const sentRows = store.actions.filter((a) => a.status === "sent" && a.sentAt);
  if (!live) inv.shadowSends += sentRows.length;
  const l = settings.limits;
  for (const a of sentRows) {
    const t = Date.parse(a.sentAt!);
    const within = (ms: number, same: (b: MemoryActionRow) => boolean) => sentRows.filter((b) => same(b) && Date.parse(b.sentAt!) > t - ms && Date.parse(b.sentAt!) <= t).length;
    if (within(HOUR, (b) => b.platform === a.platform) > l.perPlatformPerHour) inv.limitBreaches++;
    if (within(DAY, (b) => b.platform === a.platform) > l.perPlatformPerDay) inv.limitBreaches++;
    if (within(DAY, () => true) > l.globalPerDay) inv.limitBreaches++;
    if (a.kind === "reply" && a.origin === "auto" && a.authorId !== null && within(l.perPersonDays * DAY, (b) => b.kind === "reply" && b.origin === "auto" && b.platform === a.platform && b.authorId === a.authorId) > 1) inv.limitBreaches++;
  }

  for (const a of store.actions) {
    if (a.kind === "hide" && !settings.hideEnabled[a.platform]) inv.hidesWhileDisabled++;
    if (a.kind !== "reply") continue;
    const text = a.text ?? "";
    const lint = lintText({ text, kind: "reply" });
    if (lint.issues.some((i) => i.severity === "error") || PLACE_WORD.test(text) || text.includes("?")) inv.locationLeaks++;
    const cat = categoryOf.get(a.commentId);
    if (cat && UNSAFE.has(cat)) inv.unsafeReplies++;
    if (cat === "own") inv.ownReplies++;
  }
  for (const a of store.actions.filter((x) => x.status === "unknown")) {
    const calls = sources.get(a.platform)!.calls.filter((c) => c.platformCommentId === a.platformCommentId).length;
    if (calls !== a.attempts) inv.unknownResent++;
  }

  report.failed = store.actions.filter((a) => a.status === "failed").length;
  report.unknown = store.actions.filter((a) => a.status === "unknown").length;
  report.pending = store.actions.filter((a) => a.status === "planned").length;
  for (const a of alerts) report.alerts[a.kind] = (report.alerts[a.kind] ?? 0) + 1;
  report.actions = store.actions.map(({ id, platform, platformCommentId, kind, text, status, attempts, lastError }) => ({ id, platform, platformCommentId, kind, text, status, attempts, lastError }));

  const check = (name: string, ok: boolean, detail: string) => report.checks.push({ name, ok, detail });
  for (const [name, v] of Object.entries(inv)) check(name, v === 0, `${v}`);
  check("every category generated", TEMPLATES.every(([cat]) => (report.categories[cat] ?? 0) > 0), JSON.stringify(report.categories));
  if (live) {
    check("kill switch tripped and stopped sends", !!report.killedNow && (report.alerts["engagement-kill"] ?? 0) === 1, report.killedNow ?? "not tripped");
    check("one alert per unknown", (report.alerts["engagement-unknown"] ?? 0) === report.unknown, `${report.unknown} unknown`);
  } else {
    check("shadow: nothing sent, no rows due", report.sent === 0 && report.pending === 0, `${report.sent} sent`);
  }

  report.ok = report.checks.every((c) => c.ok);
  const failing = report.checks.filter((c) => !c.ok).map((c) => c.name);
  report.summary =
    `simulate-engagement (${mode}): ${report.ok ? "OK" : "FAIL"} ${report.comments} comments · replies ${report.replies} · hides ${report.hides} · flags ${report.flags} · sent ${report.sent}` +
    ` · ${inv.doubleReplies} double-replies · ${inv.limitBreaches} limit breaches · ${inv.locationLeaks} location leaks · kill: ${report.killedNow ? "tripped" : "not tripped"}` +
    (failing.length ? ` · FAILED: ${failing.join("; ")}` : "");
  return report;
}
