import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_INGEST_CRON,
  analyticsSourcesFromEnv,
  analyticsStartupLine,
  registerAnalyticsIngestJob,
  runAnalyticsIngestOnce,
  type AnalyticsSourcesEnv,
} from "../jobs/analytics-ingest.js";
import type { BossLike } from "../jobs/register-engagement.js";
import { QUEUES } from "../queue.js";

const IG_TOKEN = "EAABsbCS1iHgBAKZBZCfakeIgTokenForTests0123456789";
const YT_REFRESH = "1//0gFakeRefreshTokenForTests0123456789abc";
const YT_ACCESS = "ya29.a0FakeAccessTokenForTests0123456789";
const T0 = Date.parse("2026-11-01T00:00:00Z");
const at = (h: number) => new Date(T0 + h * 3_600_000);

interface Item { id: string; platform: string; platform_post_id: string; scheduled_for: string }

/** In-memory stand-in for the four tables this job touches, routed on the SQL text. */
function fakePool(items: Item[]) {
  const metrics: Array<{ batch_item_id: string; age_hours: number; metrics: string }> = [];
  const settings = new Map<string, unknown>();
  const alerts: Array<{ kind: string; platform: string; message: string; acknowledged_at: string | null }> = [];
  const sqls: string[] = [];
  const query = async (sql: string, params: unknown[] = []): Promise<{ rows: any[] }> => {
    sqls.push(sql);
    if (/from batch_items bi left join post_metrics/.test(sql)) {
      const since = Date.parse(String(params[0]));
      return {
        rows: items
          .filter((i) => Date.parse(i.scheduled_for) >= since)
          .map((i) => ({ id: i.id, platform: i.platform, platform_post_id: i.platform_post_id, scheduled_for: i.scheduled_for, ages: metrics.filter((m) => m.batch_item_id === i.id).map((m) => m.age_hours) })),
      };
    }
    if (/^\s*insert into post_metrics/.test(sql)) {
      const [id, age, m] = params as [string, number, string];
      if (!metrics.some((x) => x.batch_item_id === id && x.age_hours === age)) metrics.push({ batch_item_id: id, age_hours: age, metrics: m });
      return { rows: [] };
    }
    if (/select value from settings/.test(sql)) return { rows: settings.has(String(params[0])) ? [{ value: settings.get(String(params[0])) }] : [] };
    if (/insert into settings/.test(sql)) return (settings.set(String(params[0]), JSON.parse(String(params[1]))), { rows: [] });
    if (/insert into alerts/.test(sql)) {
      const [kind, platform, message] = params as string[];
      if (alerts.some((a) => a.kind === kind && a.platform === platform && a.acknowledged_at === null)) return { rows: [] };
      alerts.push({ kind: kind!, platform: platform!, message: message!, acknowledged_at: null });
      return { rows: [{ id: alerts.length }] };
    }
    throw new Error(`unexpected sql: ${sql}`);
  };
  return { query, metrics, settings, alerts, sqls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFetch(opts: { ytRefresh?: "ok" | "fail"; ig?: "ok" | "fail" } = {}) {
  const calls: Array<{ url: string; method: string; auth?: string }> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init?.method ?? "GET", auth: headers.Authorization });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return opts.ytRefresh === "fail" ? json(400, { error: "invalid_grant", error_description: `Token has been expired or revoked. ${YT_REFRESH}` }) : json(200, { access_token: YT_ACCESS, expires_in: 3599 });
    }
    if (url.includes("graph.facebook.com")) {
      if (opts.ig === "fail") return json(400, { error: { message: `Invalid OAuth access token - Cannot parse access token ${IG_TOKEN}`, code: 190 } });
      if (url.includes("/insights?metric=")) {
        const metric = new URL(url).searchParams.get("metric")!;
        return json(200, { data: [{ name: metric, period: "lifetime", values: [{ value: 10 }] }] });
      }
      return json(200, { like_count: 5, comments_count: 1 });
    }
    if (url.includes("googleapis.com/youtube/v3/videos")) {
      const id = new URL(url).searchParams.get("id");
      return json(200, { items: [{ id, statistics: { viewCount: "100", likeCount: "7", commentCount: "2" } }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { f, calls };
}

const items: Item[] = [
  { id: "ig1", platform: "instagram", platform_post_id: "17944070922377356", scheduled_for: at(0).toISOString() },
  { id: "yt1", platform: "youtube", platform_post_id: "dQw4w9WgXcQ", scheduled_for: at(0).toISOString() },
  { id: "tt1", platform: "tiktok", platform_post_id: "zernio-post-1", scheduled_for: at(0).toISOString() },
];
const cfg: AnalyticsSourcesEnv = {
  instagram: { accessToken: IG_TOKEN, graphVersion: "v25.0" },
  youtube: { clientId: "client-id", clientSecret: "client-secret-value", refreshToken: YT_REFRESH },
};

afterEach(() => vi.restoreAllMocks());

describe("runAnalyticsIngestOnce", () => {
  it("writes due snapshots through writeSnapshot; a second run writes nothing new", async () => {
    const pool = fakePool(items);
    const { f, calls } = fakeFetch();
    const lines: string[] = [];
    const r1 = await runAnalyticsIngestOnce(pool, cfg, { now: at(25), fetchImpl: f, log: (l) => lines.push(l) });
    expect(r1).toMatchObject({ captured: 2, failed: 0, skippedNoSource: 1 });
    expect(pool.metrics.map((m) => [m.batch_item_id, m.age_hours]).sort()).toEqual([["ig1", 24], ["yt1", 24]]);
    expect(JSON.parse(pool.metrics.find((m) => m.batch_item_id === "yt1")!.metrics)).toMatchObject({ views: 100, likes: 7, comments: 2 });
    expect(lines[0]).toBe("[analytics] captured 2 · failed 0 (ig 0, yt 0) · no-source 1");
    expect(calls.every((c) => c.method === "GET" || c.url.startsWith("https://oauth2.googleapis.com/token"))).toBe(true);
    expect(calls.some((c) => c.url.includes(IG_TOKEN) || c.url.includes(YT_ACCESS))).toBe(false); // tokens only in headers

    const r2 = await runAnalyticsIngestOnce(pool, cfg, { now: at(26), fetchImpl: f, log: () => {} });
    expect(r2.captured).toBe(0);
    expect(pool.metrics).toHaveLength(2);
  });

  it("a failed YT token refresh counts YT as failed; IG still runs", async () => {
    const pool = fakePool(items);
    const { f } = fakeFetch({ ytRefresh: "fail" });
    const lines: string[] = [];
    const r = await runAnalyticsIngestOnce(pool, cfg, { now: at(25), fetchImpl: f, log: (l) => lines.push(l) });
    expect(r.failedByPlatform).toEqual({ youtube: 1 });
    expect(r.attemptedByPlatform).toEqual({ instagram: 1, youtube: 1 });
    expect(pool.metrics.map((m) => m.batch_item_id)).toEqual(["ig1"]);
    expect(r.lastErrorByPlatform.youtube).toMatch(/^youtube token refresh failed/);
    expect(lines.join("\n")).not.toContain(YT_REFRESH);
  });

  it("3 failing runs raise one metrics-health alert per platform, not one per run; no token in logs or alerts", async () => {
    const pool = fakePool(items);
    const { f } = fakeFetch({ ig: "fail", ytRefresh: "fail" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) await runAnalyticsIngestOnce(pool, cfg, { now: at(25 + i), fetchImpl: f });
    expect(pool.alerts.map((a) => [a.kind, a.platform]).sort()).toEqual([["metrics-health", "instagram"], ["metrics-health", "youtube"]]);
    expect(pool.settings.get("metrics_health")).toMatchObject({ instagram: { consecutive: 5, lastOkAt: null }, youtube: { consecutive: 5 } });
    const logged = [...spy.mock.calls, ...errSpy.mock.calls].flat().map(String).join("\n");
    expect(logged).toContain("[analytics] captured 0 · failed 2 (ig 1, yt 1)");
    for (const secret of [IG_TOKEN, YT_REFRESH, YT_ACCESS, "client-secret-value"]) {
      expect(logged).not.toContain(secret);
      expect(pool.alerts.map((a) => a.message).join("\n")).not.toContain(secret);
    }
    expect(pool.alerts.every((a) => a.message.length <= 300)).toBe(true);

    // Acknowledge, keep failing: no new row until the counter has reset and tripped again.
    pool.alerts.forEach((a) => (a.acknowledged_at = "x"));
    await runAnalyticsIngestOnce(pool, cfg, { now: at(31), fetchImpl: f, log: () => {} });
    expect(pool.alerts).toHaveLength(2);
  });

  it("a failed alert insert on the tripping run is retried next run (the trip is not lost)", async () => {
    const pool = fakePool(items);
    const inner = pool.query;
    let failInsert = true;
    const flaky = {
      query: async (sql: string, params?: unknown[]) => {
        if (/insert into alerts/.test(sql) && failInsert) {
          failInsert = false;
          throw new Error("db hiccup");
        }
        return inner(sql, params);
      },
    };
    const { f } = fakeFetch({ ig: "fail" });
    const cfgIg: AnalyticsSourcesEnv = { instagram: cfg.instagram! };
    await runAnalyticsIngestOnce(flaky, cfgIg, { now: at(25), fetchImpl: f, log: () => {} });
    await runAnalyticsIngestOnce(flaky, cfgIg, { now: at(26), fetchImpl: f, log: () => {} });
    await expect(runAnalyticsIngestOnce(flaky, cfgIg, { now: at(27), fetchImpl: f, log: () => {} })).rejects.toThrow("db hiccup");
    expect(pool.alerts).toHaveLength(0);
    await runAnalyticsIngestOnce(flaky, cfgIg, { now: at(28), fetchImpl: f, log: () => {} });
    expect(pool.alerts.map((a) => [a.kind, a.platform])).toEqual([["metrics-health", "instagram"]]);
  });

  it("runs with DRY_RUN=true (read-only, not gated by run mode)", async () => {
    const env = { DRY_RUN: "true", META_ACCESS_TOKEN: IG_TOKEN } as NodeJS.ProcessEnv;
    const pool = fakePool(items);
    const { f } = fakeFetch();
    const r = await runAnalyticsIngestOnce(pool, analyticsSourcesFromEnv(env), { now: at(25), fetchImpl: f, log: () => {} });
    expect(r.captured).toBe(1);
    expect(r.skippedNoSource).toBe(2);
  });

  it("without creds logs `analytics: no sources` and touches nothing", async () => {
    const pool = fakePool(items);
    const { f, calls } = fakeFetch();
    const lines: string[] = [];
    const r = await runAnalyticsIngestOnce(pool, analyticsSourcesFromEnv({} as NodeJS.ProcessEnv), { now: at(25), fetchImpl: f, log: (l) => lines.push(l) });
    expect(lines).toEqual(["[analytics] analytics: no sources"]);
    expect(r.captured).toBe(0);
    expect(pool.sqls).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("analyticsSourcesFromEnv", () => {
  it("TikTok only with ZERNIO_ANALYTICS=1; partial YT creds are ignored", () => {
    expect(analyticsSourcesFromEnv({ ZERNIO_API_KEY: "k" } as NodeJS.ProcessEnv)).toEqual({});
    expect(analyticsSourcesFromEnv({ ZERNIO_API_KEY: "k", ZERNIO_ANALYTICS: "1" } as NodeJS.ProcessEnv).tiktok).toEqual({ apiKey: "k" });
    expect(analyticsSourcesFromEnv({ GOOGLE_CLIENT_ID: "c" } as NodeJS.ProcessEnv).youtube).toBeUndefined();
    expect(analyticsStartupLine({})).toBe("analytics=read-only · sources=none · cron=23 * * * *");
  });
});

describe("registerAnalyticsIngestJob", () => {
  it("creates the queue and schedules it hourly at :23", async () => {
    const calls: string[] = [];
    const boss: BossLike = {
      createQueue: async (n) => calls.push(`create ${n}`),
      work: async (n) => calls.push(`work ${n}`),
      schedule: async (n, cron) => calls.push(`schedule ${n} ${cron}`),
    };
    await registerAnalyticsIngestJob(boss, fakePool([]), {});
    expect(ANALYTICS_INGEST_CRON).toBe("23 * * * *");
    expect(calls).toEqual(["create analytics-ingest", "work analytics-ingest", "schedule analytics-ingest 23 * * * *"]);
    expect(QUEUES.analyticsIngest).toBe("analytics-ingest");
  });
});
