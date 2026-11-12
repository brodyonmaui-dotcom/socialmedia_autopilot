/**
 * simulate-week: a full 7-day × N-slot dry run of scheduler + outbox over fakes.
 * No network, no DB, no real clock. Scripted failures exercise every state transition; the fake
 * platforms are the oracle for double posts and caps. Returns a report; the CLI prints one line.
 */
import type { OutboxPost, Platform } from "../types.js";
import { CAPABILITIES } from "../capabilities.js";
import { daySlotTimes, isWithinAnyWindow, normalizeCadence, PLATFORMS, type CadenceSettings } from "../cadence.js";
import { assignSlots, findCapBreaches, type Assignment, type ScheduleItem } from "../scheduler.js";
import { runOutboxTick, type TickResult } from "../outbox/engine.js";
import { backoffMs, DEFAULT_RETRY_POLICY, type RetryPolicy } from "../outbox/policy.js";
import { addCalendarDays, hasOffsetChange, localDate, localHHMM, localToUtc, weekdayIndex } from "../time.js";
import { FakeClock, FakePlatform, MemoryOutboxStore, type FakeOutcome } from "../testing/fakes.js";

export interface SimulateOptions {
  /** TZ_CREATOR (or a labelled fixture zone). Required. */
  timeZone: string;
  /** Local "YYYY-MM-DD"; default: the Monday of the next week that crosses a DST change in `timeZone` (else next Monday). */
  weekStart?: string;
  days?: number;
  cadence?: Partial<CadenceSettings> | CadenceSettings;
  policy?: RetryPolicy;
  /** Platforms each clip goes to (Snapchat is assisted and only ever one a day). */
  platforms?: Platform[];
  tickMinutes?: number;
  /** Ticks logged into `report.log` (kept short: engine lines only). */
  keepLog?: boolean;
}

export interface SimCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SimReport {
  ok: boolean;
  timeZone: string;
  weekStart: string;
  days: number;
  slotsPerDay: number;
  crossesDst: boolean;
  posts: number;
  scheduled: number;
  unplaced: number;
  published: number;
  recovered: number;
  queuedRetries: number;
  failed: number;
  unknown: number;
  handoff: number;
  alerts: number;
  doublePosts: number;
  capBreaches: number;
  ticks: number;
  checks: SimCheck[];
  scheduleWarnings: string[];
  assignments: Assignment[];
  finalPosts: OutboxPost[];
  log: string[];
  summary: string;
}

/** Monday on or after `ymd`. */
function nextMonday(ymd: string): string {
  const wd = weekdayIndex(ymd);
  return wd === 0 ? ymd : addCalendarDays(ymd, 7 - wd);
}

/** The first Monday within ~400 days whose 7-day span changes UTC offset; else the next Monday. */
export function pickDstWeek(timeZone: string, from: Date = new Date()): { weekStart: string; crossesDst: boolean } {
  let monday = nextMonday(addCalendarDays(localDate(from, timeZone), 1));
  for (let i = 0; i < 60; i++) {
    const start = localToUtc(monday, "00:00", timeZone);
    const end = localToUtc(addCalendarDays(monday, 7), "00:00", timeZone);
    if (hasOffsetChange(start, end, timeZone)) return { weekStart: monday, crossesDst: true };
    monday = addCalendarDays(monday, 7);
  }
  return { weekStart: nextMonday(addCalendarDays(localDate(from, timeZone), 1)), crossesDst: false };
}

/** Deterministic failure script by post ordinal (sorted by scheduledFor, then platform). */
function scriptFor(ordinal: number): FakeOutcome[] | undefined {
  switch (ordinal % 24) {
    case 3:
      return ["reject", "ok"]; // one retry, then fine
    case 7:
      return ["reject", "reject", "reject", "reject", "reject"]; // final failure after maxAttempts
    case 11:
      return ["timeout-created"]; // unknown; the platform DID create it; must never be resent
    case 15:
      return ["timeout-not-created"]; // unknown; nothing created; still never resent by the engine
    case 19:
      return ["reject", "reject", "ok"]; // two retries
    default:
      return undefined;
  }
}

export async function simulateWeek(opts: SimulateOptions): Promise<SimReport> {
  const timeZone = opts.timeZone;
  const cadence = normalizeCadence(opts.cadence ?? {});
  const policy = opts.policy ?? DEFAULT_RETRY_POLICY;
  const days = opts.days ?? 7;
  const platforms = opts.platforms ?? (["instagram", "youtube", "tiktok"] as Platform[]);
  const picked = opts.weekStart ? { weekStart: opts.weekStart, crossesDst: false } : pickDstWeek(timeZone);
  const weekStart = picked.weekStart;
  const crossesDst = opts.weekStart
    ? hasOffsetChange(localToUtc(weekStart, "00:00", timeZone), localToUtc(addCalendarDays(weekStart, days), "00:00", timeZone), timeZone)
    : picked.crossesDst;
  const tickMs = (opts.tickMinutes ?? 1) * 60_000;
  const log: string[] = [];
  const checks: SimCheck[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };

  // ---- 1. the week's clips: slotsPerDay per day, each to every platform; one Snapchat handoff a day
  const items: ScheduleItem[] = [];
  const pillars = ["gym", "trading", "meal", "lifestyle", "tip", "running"];
  for (let d = 0; d < days; d++) {
    for (let s = 0; s < cadence.slotsPerDay; s++) {
      const n = d * cadence.slotsPerDay + s;
      const wanted: Platform[] = [...platforms];
      if (s === 0) wanted.push("snapchat");
      items.push({ key: `clip-${String(n + 1).padStart(2, "0")}`, pillar: pillars[n % pillars.length], platforms: wanted });
    }
  }

  // ---- 2. schedule (the plan starts "now" = Sunday night before the week, so no slot is in the past)
  const planStart = localToUtc(weekStart, "00:00", timeZone);
  const clock = new FakeClock(planStart);
  const schedule = assignSlots({ weekStart, days, items, cadence, timeZone, now: clock.now() });
  const slotTimes = daySlotTimes(cadence);

  check("every clip placed", schedule.unplaced.length === 0, schedule.unplaced.length ? schedule.unplaced.map((u) => `${u.key}/${u.platform}: ${u.reason}`).join("; ") : `${schedule.assignments.length} assignments`);
  const breaches = findCapBreaches(schedule.assignments, cadence, timeZone);
  check("schedule under daily caps", breaches.length === 0, breaches.length ? breaches.map((b) => `${b.platform} ${b.localDate} ${b.count}/${b.cap}`).join("; ") : "no breach");
  const offGrid = schedule.assignments.filter((a) => !slotTimes.includes(localHHMM(new Date(a.scheduledFor), timeZone)) || !isWithinAnyWindow(localHHMM(new Date(a.scheduledFor), timeZone), cadence.windows));
  check("every slot on the grid and inside a window (DST-safe)", offGrid.length === 0, offGrid.length ? offGrid.slice(0, 3).map((a) => `${a.key}/${a.platform} @ ${localHHMM(new Date(a.scheduledFor), timeZone)}`).join("; ") : `${schedule.assignments.length} slots, zone ${timeZone}${crossesDst ? " (week crosses a DST change)" : ""}`);
  const perDay = new Map<string, number>();
  for (const a of schedule.assignments) if (a.platform === "instagram") perDay.set(a.localDate, (perDay.get(a.localDate) ?? 0) + 1);
  check("instagram anchors spread evenly", [...perDay.values()].every((n) => n === cadence.slotsPerDay) && perDay.size === days, `${[...perDay.values()].join(",")} per day`);
  const byKey = new Map<string, Assignment[]>();
  for (const a of schedule.assignments) byKey.set(a.key, [...(byKey.get(a.key) ?? []), a]);
  let staggerBad = 0;
  for (const [, as] of byKey) {
    const ig = as.find((a) => a.platform === "instagram");
    if (!ig) continue;
    for (const a of as) {
      if (a.platform === "instagram") continue;
      const rule = cadence.stagger[a.platform];
      const minDay = addCalendarDays(ig.localDate, rule.days);
      if (a.localDate < minDay) staggerBad++;
      if (a.localDate === ig.localDate && a.scheduledFor <= ig.scheduledFor) staggerBad++;
    }
  }
  check("stagger respected (copies never before the IG anchor + rule)", staggerBad === 0, staggerBad ? `${staggerBad} violation(s)` : `yt +${cadence.stagger.youtube.slots} slot, tiktok +${cadence.stagger.tiktok.days} day, snapchat +${cadence.stagger.snapchat.days} days`);
  const dupKeys = new Set<string>();
  let dupes = 0;
  for (const a of schedule.assignments) {
    const k = `${a.key}|${a.platform}`;
    if (dupKeys.has(k)) dupes++;
    dupKeys.add(k);
  }
  check("no video twice on one platform", dupes === 0, `${dupes} duplicate(s)`);

  // ---- 3. approve into the outbox, one idempotency key per post
  const store = new MemoryOutboxStore();
  const fakes: Partial<Record<Platform, FakePlatform>> = {};
  const script: Record<string, FakeOutcome[]> = {};
  const expect: Record<string, FakeOutcome[]> = {};
  schedule.assignments.forEach((a, i) => {
    const id = `${a.key}-${a.platform}`;
    const idempotencyKey = `idem-${id}`;
    const s = scriptFor(i);
    if (s && a.platform !== "snapchat") {
      script[idempotencyKey] = s;
      expect[id] = s;
    }
    store.add({ id, idempotencyKey, platform: a.platform, mediaUrl: `https://media.example/${a.key}.mp4`, caption: `${a.key} caption…`, title: a.platform === "youtube" ? a.key : undefined, scheduledFor: a.scheduledFor, status: "approved", attempts: 0, mediaId: a.key, updatedAt: clock.now().toISOString() });
  });
  for (const p of PLATFORMS) {
    if (CAPABILITIES[p].scheduling === "none") continue;
    fakes[p] = new FakePlatform({ platform: p, script, honorsIdempotencyKey: p === "tiktok", canLookup: p !== "youtube" }, clock);
  }
  // Also simulate a worker crash right after one successful create, before the DB write: must recover, not resend.
  const crashId = schedule.assignments.map((a) => `${a.key}-${a.platform}`).find((id, i) => i % 24 === 23 && id.endsWith("-instagram") && !expect[id]);
  if (crashId) store.crashBeforeMarkPublished.add(crashId);

  const adapters = Object.fromEntries(Object.entries(fakes).map(([p, f]) => [p, f.adapter()])) as Partial<Record<Platform, ReturnType<FakePlatform["adapter"]>>>;

  // ---- 4. run the week, tick by tick
  const end = localToUtc(addCalendarDays(weekStart, days + 2), "00:00", timeZone); // 2 spill days for stagger + retries
  let ticks = 0;
  const totals: TickResult = { considered: 0, published: 0, queued: 0, failed: 0, unknown: 0, recovered: 0, skipped: 0, dryRun: false, alerts: [] };
  let crashes = 0;
  while (clock.now().getTime() <= end.getTime()) {
    ticks++;
    try {
      const r = await runOutboxTick(store, { adapters, dryRun: false, policy, cadence, timeZone, now: clock.now, nativeLeadMs: 0, log: opts.keepLog ? (l) => log.push(`${clock.now().toISOString()} ${l}`) : undefined });
      totals.published += r.published;
      totals.queued += r.queued;
      totals.failed += r.failed;
      totals.unknown += r.unknown;
      totals.recovered += r.recovered;
      totals.alerts.push(...r.alerts);
    } catch (err) {
      crashes++;
      log.push(`${clock.now().toISOString()} [sim] worker crashed: ${(err as Error).message}`);
    }
    clock.advanceMs(tickMs);
  }

  // ---- 5. invariants over the fake platforms (the oracle) and the store
  const finalPosts = store.all();
  const doublePosts = Object.values(fakes).flatMap((f) => f.doublePosts());
  check("no double posts (platform ledger)", doublePosts.length === 0, doublePosts.length ? doublePosts.slice(0, 5).join(", ") : `${Object.values(fakes).reduce((n, f) => n + f.created.length, 0)} created across ${Object.keys(fakes).length} platforms`);

  let liveBreaches = 0;
  const liveDetail: string[] = [];
  for (const f of Object.values(fakes)) {
    const byDay = new Map<string, number>();
    for (const c of f.created) {
      const d = localDate(new Date(c.at), timeZone);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    for (const [d, n] of byDay) {
      if (n > cadence.dailyCaps[f.platform]) {
        liveBreaches++;
        liveDetail.push(`${f.platform} ${d} ${n}/${cadence.dailyCaps[f.platform]}`);
      }
    }
  }
  check("no cap breach at fire time (platform ledger)", liveBreaches === 0, liveBreaches ? liveDetail.join("; ") : "within caps every local day");

  const stuck = finalPosts.filter((p) => p.status === "queued" || p.status === "publishing" || (p.status === "approved" && CAPABILITIES[p.platform].scheduling !== "none"));
  check("nothing left queued/publishing after the week", stuck.length === 0, stuck.length ? stuck.slice(0, 5).map((p) => `${p.id}:${p.status}`).join(", ") : "all posts settled");

  const unknownPosts = finalPosts.filter((p) => p.status === "unknown");
  const unknownResent = unknownPosts.filter((p) => (fakes[p.platform]?.calls.filter((c) => c.postId === p.id).length ?? 0) !== 1);
  check("unknown posts were never resent", unknownResent.length === 0 && unknownPosts.length > 0, `${unknownPosts.length} unknown, each called exactly once`);

  const failedPosts = finalPosts.filter((p) => p.status === "failed");
  const failedBad = failedPosts.filter((p) => p.attempts !== policy.maxAttempts || (fakes[p.platform]?.calls.filter((c) => c.postId === p.id).length ?? 0) !== policy.maxAttempts);
  check("failed posts used exactly maxAttempts", failedBad.length === 0 && failedPosts.length > 0, `${failedPosts.length} failed after ${policy.maxAttempts} attempts each`);

  const retried = Object.entries(expect).filter(([, s]) => s[0] === "reject" && s.includes("ok"));
  let backoffBad = 0;
  for (const [id] of retried) {
    const post = store.posts.get(id)!;
    const calls = fakes[post.platform]?.calls.filter((c) => c.postId === id) ?? [];
    if (post.status !== "published") backoffBad++;
    for (let i = 1; i < calls.length; i++) {
      const gap = Date.parse(calls[i]!.at) - Date.parse(calls[i - 1]!.at);
      if (gap < backoffMs(i, policy)) backoffBad++;
    }
  }
  check("retries waited out their backoff and then published", backoffBad === 0 && retried.length > 0, `${retried.length} retried post(s); backoff ${policy.baseBackoffMs / 60000} min × ${policy.factor}`);

  const crashed = crashId ? store.posts.get(crashId) : undefined;
  check("crash after create recovered without a resend", !crashId || (crashes === 1 && crashed?.status === "published" && (fakes.instagram?.calls.filter((c) => c.postId === crashId).length ?? 0) === 1 && totals.recovered >= 1), crashId ? `${crashId}: ${crashed?.status}, ${crashes} crash(es), recovered ${totals.recovered}` : "no crash scheduled");

  const alertKinds = totals.alerts.reduce<Record<string, number>>((m, a) => ((m[a.kind] = (m[a.kind] ?? 0) + 1), m), {});
  check("one alert per final failure / unknown, none duplicated", (alertKinds["final-failure"] ?? 0) === failedPosts.length && (alertKinds["unknown-outcome"] ?? 0) === unknownPosts.length && store.alerts.length === totals.alerts.length, JSON.stringify(alertKinds));

  const handoff = finalPosts.filter((p) => CAPABILITIES[p.platform].scheduling === "none");
  check("assisted (Snapchat) posts never fired", handoff.every((p) => p.status === "approved") && !fakes.snapchat, `${handoff.length} handoff post(s) left for the share sheet`);

  const ok = checks.every((c) => c.ok);
  const report: SimReport = {
    ok,
    timeZone,
    weekStart,
    days,
    slotsPerDay: cadence.slotsPerDay,
    crossesDst,
    posts: finalPosts.length,
    scheduled: schedule.assignments.length,
    unplaced: schedule.unplaced.length,
    published: finalPosts.filter((p) => p.status === "published").length,
    recovered: totals.recovered,
    queuedRetries: totals.queued,
    failed: failedPosts.length,
    unknown: unknownPosts.length,
    handoff: handoff.length,
    alerts: totals.alerts.length,
    doublePosts: doublePosts.length,
    capBreaches: breaches.length + liveBreaches,
    ticks,
    checks,
    scheduleWarnings: schedule.warnings,
    assignments: schedule.assignments,
    finalPosts,
    log,
    summary: "",
  };
  const failing = checks.filter((c) => !c.ok).map((c) => c.name);
  report.summary =
    `simulate-week: ${ok ? "OK" : "FAIL"} ${days}d×${cadence.slotsPerDay} slots · ${report.posts} posts · published ${report.published} (${report.recovered} recovered) · retries ${report.queuedRetries} · failed ${report.failed} · unknown ${report.unknown} · handoff ${report.handoff} · alerts ${report.alerts} · ${report.doublePosts} double-posts · ${report.capBreaches} cap breaches` +
    (crossesDst ? " · DST week" : "") +
    (failing.length ? ` · FAILED: ${failing.join("; ")}` : "");
  return report;
}
