import { describe, expect, it, vi } from "vitest";
import { ALERT_KINDS, PUSH_KINDS_DEFAULT, type AlertKind } from "@autopilot/core";
import type { PushSubscriptionRow } from "@autopilot/db";
import {
  ALERT_PUSH_CRON,
  ALERT_PUSH_TTL_S,
  VAPID_NOT_SET_LINE,
  alertPushConfigFromEnv,
  buildPayload,
  classifyPushStatus,
  effectivePushKinds,
  isPushable,
  runAlertPushOnce,
  runPushTestOnce,
  urgencyFor,
  type AlertPushStore,
  type ClaimedAlert,
  type PushSender,
} from "../jobs/alert-push-core.js";
import { registerAlertPushJob } from "../jobs/alert-push.js";
import { QUEUES } from "../queue.js";

const NOW = new Date("2026-11-13T12:00:00.000Z");
const VAPID = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:someone@example.invalid" };
const ENDPOINT = "https://push.example.invalid/send/SECRET-ENDPOINT-abc123";
const KEYS = { p256dh: "P256DH-KEY-VALUE", auth: "AUTH-KEY-VALUE" };

const sub = (id: string, over: Partial<PushSubscriptionRow> = {}): PushSubscriptionRow => ({
  id,
  endpoint: `${ENDPOINT}/${id}`,
  ...KEYS,
  session_id: null,
  label: null,
  created_at: NOW.toISOString(),
  last_success_at: null,
  revoked_at: null,
  ...over,
});

interface Row {
  id: string;
  kind: string;
  platform: string;
  message: string;
  created_at: Date;
  acknowledged_at: Date | null;
  pushed_at: Date | null;
}

/** In-memory store with the same claim semantics as the pg store (claim = conditional set pushed_at). */
function memoryStore(rows: Row[], subs: PushSubscriptionRow[]) {
  const revoked: string[] = [];
  const success: string[] = [];
  const claimCalls: unknown[][] = [];
  let test: { requested: boolean } = { requested: false };
  const store: AlertPushStore = {
    async claimUnpushed(kinds, since, now, limit) {
      claimCalls.push([kinds, since, now, limit]);
      const out: ClaimedAlert[] = [];
      for (const r of rows) {
        if (out.length >= limit) break;
        if (r.pushed_at || r.acknowledged_at || r.created_at < since || !kinds.includes(r.kind as AlertKind)) continue;
        r.pushed_at = now;
        out.push({ id: r.id, kind: r.kind as AlertKind, platform: r.platform as ClaimedAlert["platform"] });
      }
      return out;
    },
    async activeSubscriptions() {
      return subs.filter((s) => !s.revoked_at);
    },
    async markSuccess(id) {
      success.push(id);
    },
    async revoke(id, now) {
      revoked.push(id);
      const s = subs.find((x) => x.id === id);
      if (s) s.revoked_at = now.toISOString();
    },
    async claimTestRequest() {
      const r = test.requested;
      test = { requested: false };
      return r;
    },
  };
  return { store, revoked, success, claimCalls, requestTest: () => (test = { requested: true }) };
}

const row = (id: string, kind: string, over: Partial<Row> = {}): Row => ({
  id,
  kind,
  platform: "instagram",
  message: `message for ${id}`,
  created_at: new Date(NOW.getTime() - 60_000),
  acknowledged_at: null,
  pushed_at: null,
  ...over,
});

function sender(status: number | ((n: number) => number | Error) = 201) {
  const calls: Array<{ endpoint: string; payload: string; ttl: number; urgency: string }> = [];
  const s: PushSender = {
    async send(target, payload, opts) {
      calls.push({ endpoint: target.endpoint, payload, ttl: opts.ttlSeconds, urgency: opts.urgency });
      const r = typeof status === "function" ? status(calls.length) : status;
      if (r instanceof Error) throw r;
      return { status: r };
    },
  };
  return { s, calls };
}

const cfg = (over: Partial<ReturnType<typeof alertPushConfigFromEnv>> = {}) => ({ ...alertPushConfigFromEnv(VAPID), ...over });

describe("effective push kinds", () => {
  it("defaults to PUSH_KINDS_DEFAULT; metrics-health is never pushed by default", () => {
    expect(effectivePushKinds(undefined)).toEqual(PUSH_KINDS_DEFAULT);
    expect(effectivePushKinds(null)).toEqual(PUSH_KINDS_DEFAULT);
    expect(effectivePushKinds({})).toEqual(PUSH_KINDS_DEFAULT);
    expect(effectivePushKinds({ kinds: "auth" })).toEqual(PUSH_KINDS_DEFAULT);
    expect(PUSH_KINDS_DEFAULT).not.toContain("metrics-health");
    expect(alertPushConfigFromEnv(VAPID).kinds).not.toContain("metrics-health");
  });

  it("the alert_push setting overrides, keeping only known kinds", () => {
    expect(effectivePushKinds({ kinds: ["metrics-health", "auth", "nope", 3] })).toEqual(["metrics-health", "auth"]);
    expect(effectivePushKinds({ kinds: [] })).toEqual([]); // explicit: push nothing
    expect(alertPushConfigFromEnv(VAPID, { kinds: ["duplicate"] }).kinds).toEqual(["duplicate"]);
  });
});

describe("config from env", () => {
  it("is enabled only when all three VAPID names are set", () => {
    expect(alertPushConfigFromEnv(VAPID).enabled).toBe(true);
    for (const k of Object.keys(VAPID)) expect(alertPushConfigFromEnv({ ...VAPID, [k]: "" }).enabled).toBe(false);
    expect(alertPushConfigFromEnv({}).enabled).toBe(false);
    expect(alertPushConfigFromEnv({}).maxAgeH).toBe(24);
  });
});

describe("isPushable (the gate the claim SQL mirrors)", () => {
  const c = cfg();
  const base = { kind: "auth" as string, created_at: new Date(NOW.getTime() - 60_000), pushed_at: null, acknowledged_at: null };
  it("pushes an open, unpushed, recent alert of a push kind", () => expect(isPushable(base, c, NOW)).toBe(true));
  it("never re-pushes or pushes an acknowledged alert", () => {
    expect(isPushable({ ...base, pushed_at: NOW }, c, NOW)).toBe(false);
    expect(isPushable({ ...base, acknowledged_at: NOW }, c, NOW)).toBe(false);
  });
  it("skips kinds outside the list (metrics-health, page-only kinds, unknown text)", () => {
    for (const k of ["metrics-health", "cap-breach", "engagement-mode", "made-up"]) expect(isPushable({ ...base, kind: k }, c, NOW), k).toBe(false);
  });
  it("never pushes rows older than maxAgeH", () => {
    expect(isPushable({ ...base, created_at: new Date(NOW.getTime() - 24 * 3_600_000 - 1) }, c, NOW)).toBe(false);
    expect(isPushable({ ...base, created_at: new Date(NOW.getTime() - 24 * 3_600_000 + 1000) }, c, NOW)).toBe(true);
  });
});

describe("payload", () => {
  it("carries only count, kinds, sources and the alerts url: never message text, ids, tokens or endpoints", () => {
    const p = buildPayload([
      { kind: "token-health", platform: "meta" },
      { kind: "final-failure", platform: "instagram" },
      { kind: "final-failure", platform: "instagram" },
    ]);
    expect(p).toEqual({ count: 3, kinds: ["token-health", "final-failure"], sources: ["meta", "instagram"], url: "/app/alerts" });
    expect(Object.keys(p).sort()).toEqual(["count", "kinds", "sources", "url"]);
  });

  it("a token-shaped or caption-shaped message never reaches the JSON (even if a row carries one)", () => {
    const leaky = [
      { kind: "token-health", platform: "meta", message: "fail: EAAGm0PX4ZCpsBAKZCZBtoken123", id: "id-1" },
      { kind: "final-failure", platform: "instagram", message: "Pull day, slow and boring #gym", id: "id-2" },
    ] as unknown as Array<Pick<ClaimedAlert, "kind" | "platform">>;
    const json = JSON.stringify(buildPayload(leaky));
    for (const bad of ["EAAG", "token123", "Pull day", "#gym", "id-1", "id-2"]) expect(json).not.toContain(bad);
  });

  it("drops unknown kinds and sources (free text in the DB)", () => {
    const p = buildPayload([{ kind: "weird" as AlertKind, platform: "somewhere" as ClaimedAlert["platform"] }, { kind: "auth", platform: "web" }]);
    expect(p.kinds).toEqual(["auth"]);
    expect(p.sources).toEqual(["web"]);
  });

  it("urgency is high only for engagement-kill / unknown-outcome", () => {
    expect(urgencyFor(["engagement-kill"])).toBe("high");
    expect(urgencyFor(["auth", "unknown-outcome"])).toBe("high");
    expect(urgencyFor(["auth", "final-failure"])).toBe("normal");
  });

  it("status classes", () => {
    expect(classifyPushStatus(201)).toBe("ok");
    expect(classifyPushStatus(404)).toBe("revoke");
    expect(classifyPushStatus(410)).toBe("revoke");
    expect(classifyPushStatus(500)).toBe("failed");
    expect(classifyPushStatus(429)).toBe("failed");
  });
});

describe("runAlertPushOnce", () => {
  it("without VAPID: disabled, claims nothing, sends nothing, one log line", async () => {
    const m = memoryStore([row("a", "auth")], [sub("s1")]);
    const { s, calls } = sender();
    const log = vi.fn();
    const r = await runAlertPushOnce(m.store, s, alertPushConfigFromEnv({}), NOW, log);
    expect(r).toEqual({ claimed: 0, sent: 0, revoked: 0, failed: 0 });
    expect(m.claimCalls).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(log.mock.calls).toEqual([[VAPID_NOT_SET_LINE]]);
    expect(VAPID_NOT_SET_LINE).toBe("alert-push: VAPID not set");
  });

  it("bundles all claimed alerts into one notification per active subscription (1 h TTL)", async () => {
    const m = memoryStore([row("a", "auth", { platform: "web" }), row("b", "engagement-kill", { platform: "all" })], [sub("s1"), sub("s2"), sub("s3", { revoked_at: NOW.toISOString() })]);
    const { s, calls } = sender();
    const r = await runAlertPushOnce(m.store, s, cfg(), NOW, () => {});
    expect(r).toEqual({ claimed: 2, sent: 2, revoked: 0, failed: 0 });
    expect(calls.map((c) => c.endpoint)).toEqual([`${ENDPOINT}/s1`, `${ENDPOINT}/s2`]); // revoked s3 skipped
    expect(calls.every((c) => c.ttl === ALERT_PUSH_TTL_S && ALERT_PUSH_TTL_S === 3600)).toBe(true);
    expect(calls[0]!.urgency).toBe("high");
    expect(JSON.parse(calls[0]!.payload)).toEqual({ count: 2, kinds: ["auth", "engagement-kill"], sources: ["web", "all"], url: "/app/alerts" });
    expect(m.success).toEqual(["s1", "s2"]);
  });

  it("a second run over the same alerts sends nothing (pushed_at)", async () => {
    const m = memoryStore([row("a", "auth")], [sub("s1")]);
    const { s, calls } = sender();
    await runAlertPushOnce(m.store, s, cfg(), NOW, () => {});
    const r2 = await runAlertPushOnce(m.store, s, cfg(), new Date(NOW.getTime() + 60_000), () => {});
    expect(r2.claimed).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("only claims kinds in the effective list, within the age cutoff, open and unpushed", async () => {
    const rows = [
      row("ok", "final-failure"),
      row("metrics", "metrics-health"),
      row("page-only", "cap-breach"),
      row("old", "auth", { created_at: new Date(NOW.getTime() - 25 * 3_600_000) }),
      row("acked", "auth", { acknowledged_at: NOW }),
      row("pushed", "auth", { pushed_at: NOW }),
    ];
    const m = memoryStore(rows, [sub("s1")]);
    const { s } = sender();
    const r = await runAlertPushOnce(m.store, s, cfg(), NOW, () => {});
    expect(r.claimed).toBe(1);
    const pushed = Object.fromEntries(rows.map((x) => [x.id, x.pushed_at]));
    expect(pushed.ok).toEqual(NOW);
    for (const id of ["metrics", "page-only", "old", "acked"]) expect(pushed[id], id).toBeNull();
    const [kinds, since] = m.claimCalls[0]! as [AlertKind[], Date];
    expect(kinds).toEqual(PUSH_KINDS_DEFAULT);
    expect(since.getTime()).toBe(NOW.getTime() - 24 * 3_600_000);
  });

  it("no active subscription → claims nothing (alerts stay pushable once a phone subscribes)", async () => {
    const m = memoryStore([row("a", "auth")], [sub("s1", { revoked_at: NOW.toISOString() })]);
    const { s, calls } = sender();
    const r = await runAlertPushOnce(m.store, s, cfg(), NOW, () => {});
    expect(r.claimed).toBe(0);
    expect(m.claimCalls).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("404/410 revokes that subscription (no delete); others still get it", async () => {
    const m = memoryStore([row("a", "auth")], [sub("s1"), sub("s2"), sub("s3")]);
    const { s } = sender((n) => (n === 1 ? 410 : n === 2 ? 404 : 201));
    const r = await runAlertPushOnce(m.store, s, cfg(), NOW, () => {});
    expect(r).toEqual({ claimed: 1, sent: 1, revoked: 2, failed: 0 });
    expect(m.revoked).toEqual(["s1", "s2"]);
  });

  it("a 500 or a throw after the claim leaves pushed_at set (at-most-once) and counts failed", async () => {
    const rows = [row("a", "auth")];
    const m = memoryStore(rows, [sub("s1"), sub("s2")]);
    const { s } = sender((n) => (n === 1 ? 500 : new Error(`connect ECONNREFUSED ${ENDPOINT}`)));
    const r = await runAlertPushOnce(m.store, s, cfg(), NOW, () => {});
    expect(r).toEqual({ claimed: 1, sent: 0, revoked: 0, failed: 2 });
    expect(rows[0]!.pushed_at).toEqual(NOW);
    const r2 = await runAlertPushOnce(m.store, sender().s, cfg(), NOW, () => {});
    expect(r2.claimed).toBe(0);
  });

  it("runs the same in dry-run (no dry-run input at all: private notification, approved)", () => {
    expect(runAlertPushOnce.length).toBeLessThanOrEqual(5);
    expect(Object.keys(cfg())).not.toContain("dryRun");
  });

  it("logs never contain endpoints, keys or messages (spy)", async () => {
    const rows = [row("a", "auth", { message: "secret message EAAGtoken" }), row("b", "final-failure")];
    const m = memoryStore(rows, [sub("s1"), sub("s2"), sub("s3")]);
    const { s } = sender((n) => (n === 1 ? 410 : n === 2 ? new Error(`boom ${ENDPOINT} ${KEYS.p256dh}`) : 500));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const lines: string[] = [];
    await runAlertPushOnce(m.store, s, cfg(), NOW, (l) => lines.push(l));
    await runAlertPushOnce(m.store, s, cfg(), NOW); // default logger → console
    const all = [...lines, ...spy.mock.calls.flat(), ...err.mock.calls.flat()].map(String).join("\n");
    spy.mockRestore();
    err.mockRestore();
    expect(lines.some((l) => /failed n=2/.test(l))).toBe(true);
    for (const bad of ["push.example", "SECRET-ENDPOINT", KEYS.p256dh, KEYS.auth, "secret message", "EAAG", "s1", "s2"]) expect(all).not.toContain(bad);
  });
});

describe("test notification", () => {
  it("sends a kind-free test payload once per request to active subscriptions", async () => {
    const m = memoryStore([], [sub("s1"), sub("s2", { revoked_at: NOW.toISOString() })]);
    const { s, calls } = sender();
    expect((await runPushTestOnce(m.store, s, cfg(), NOW, () => {})).sent).toBe(0);
    m.requestTest();
    const r = await runPushTestOnce(m.store, s, cfg(), NOW, () => {});
    expect(r).toEqual({ claimed: 1, sent: 1, revoked: 0, failed: 0 });
    expect(JSON.parse(calls[0]!.payload)).toEqual({ count: 0, kinds: [], sources: [], url: "/app/alerts", test: true });
    expect((await runPushTestOnce(m.store, s, cfg(), NOW, () => {})).sent).toBe(0);
  });

  it("disabled → no claim of the request", async () => {
    const m = memoryStore([], [sub("s1")]);
    m.requestTest();
    const r = await runPushTestOnce(m.store, sender().s, alertPushConfigFromEnv({}), NOW, () => {});
    expect(r.claimed).toBe(0);
    expect(await m.store.claimTestRequest(NOW)).toBe(true);
  });
});

describe("job registration", () => {
  it("every minute, on its own queue; without VAPID it logs once and registers nothing", async () => {
    expect(ALERT_PUSH_CRON).toBe("* * * * *");
    expect(QUEUES.alertPush).toBe("alert-push");
    const calls: string[] = [];
    const boss = {
      createQueue: async (n: string) => calls.push(`create ${n}`),
      work: async (n: string) => calls.push(`work ${n}`),
      schedule: async (n: string, c: string) => calls.push(`schedule ${n} ${c}`),
    };
    const pool = { query: async () => ({ rows: [] }) };
    await registerAlertPushJob(boss, pool, VAPID);
    expect(calls).toEqual(["create alert-push", "work alert-push", "schedule alert-push * * * * *"]);
    const lines: string[] = [];
    const calls2: string[] = [];
    await registerAlertPushJob({ ...boss, createQueue: async (n: string) => calls2.push(n) }, pool, {}, (l) => lines.push(l));
    expect(calls2).toEqual([]);
    expect(lines).toEqual([VAPID_NOT_SET_LINE]);
  });

  it("by default exactly the approved kinds are pushable; every other declared kind is page-only", () => {
    const pushable = ALERT_KINDS.filter((k) => isPushable({ kind: k, created_at: NOW, pushed_at: null, acknowledged_at: null }, cfg(), NOW));
    expect(new Set(pushable)).toEqual(new Set(["engagement-kill", "unknown-outcome", "final-failure", "token-health", "auth", "ready-for-approval"]));
  });
});
