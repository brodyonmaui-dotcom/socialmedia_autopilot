import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutboxAlert, PlatformAdapter } from "@autopilot/core";
import { consoleAlertSink, loadCadence, PgOutboxStore, privacyCaptionGuard, runOutboxWith } from "../jobs/outbox.js";

interface FakeRow {
  id: string;
  idempotency_key: string;
  media_id: string;
  platform: string;
  caption: string;
  title: string | null;
  trial: null | { tiktokDraft?: boolean };
  scheduled_for: string;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  platform_post_id: string | null;
  platform_post_url: string | null;
  updated_at: string;
  r2_key: string | null;
}

/** Routes the store's SQL by shape and records every write, so a test can assert exact params. */
function fakePool(rows: FakeRow[], opts: { sentToday?: number; settings?: Record<string, unknown>; claimFails?: boolean } = {}) {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const reads: string[] = [];
  const settings: Record<string, unknown> = { posting_windows: [{ start: "09:00", end: "21:00" }], cadence: {}, ...opts.settings };
  return {
    writes,
    reads,
    query: async (sql: string, params: unknown[] = []) => {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.startsWith("select")) reads.push(s);
      if (s.startsWith("select value from settings")) return { rows: settings[params[0] as string] === undefined ? [] : [{ value: settings[params[0] as string] }] };
      if (s.startsWith("select count(*)::int as n")) return { rows: [{ n: opts.sentToday ?? 0 }] };
      if (s.startsWith("select bi.id") && s.includes("status = 'publishing'")) return { rows: [] };
      if (s.startsWith("select bi.id")) return { rows };
      writes.push({ sql: s, params });
      if (s.startsWith("update batch_items set status = 'publishing'")) return { rows: opts.claimFails ? [] : [{ id: params[0] }] };
      if (s.startsWith("insert into alerts")) return { rows: [{ id: "alert-1" }] };
      return { rows: [] };
    },
  };
}

function adapter(platform: string, impl: PlatformAdapter["publish"], findExisting?: PlatformAdapter["findExisting"]): PlatformAdapter {
  return { platform: platform as PlatformAdapter["platform"], publish: impl, findExisting };
}

const NOW = "2026-11-01T09:30:00Z"; // in the past: the engine runs on the real clock here
const base: FakeRow = {
  id: "item-1",
  idempotency_key: "idem-1",
  media_id: "media-1",
  platform: "instagram",
  caption: "caption",
  title: null,
  trial: null,
  scheduled_for: "2026-11-01T09:00:00Z",
  status: "approved",
  attempts: 0,
  next_attempt_at: null,
  last_error: null,
  platform_post_id: null,
  platform_post_url: null,
  updated_at: "2026-10-31T09:00:00Z",
  r2_key: "library/abc.mp4",
};
const cfg = { publicMediaBase: "https://media.example", dryRun: false, timeZone: "UTC", log: () => {} };
const alerts: OutboxAlert[] = [];
const sink = { send: async (a: OutboxAlert) => void alerts.push(a) };

describe("runOutboxWith (pg store)", () => {
  it("dry-run: never calls the adapter or writes a row", async () => {
    const pool = fakePool([base]);
    let called = false;
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => ((called = true), { platformPostId: "x" })) }, { ...cfg, dryRun: true });
    expect(r).toMatchObject({ considered: 1, published: 0, dryRun: true });
    expect(called).toBe(false);
    expect(pool.writes).toEqual([]);
  });

  it("refuses a live run without TZ_CREATOR", async () => {
    await expect(runOutboxWith(fakePool([base]), {}, { ...cfg, timeZone: undefined })).rejects.toThrow(/TZ_CREATOR/);
  });

  it("success: claims the row, then marks it published with the platform id/url and the media URL built from r2_key", async () => {
    const pool = fakePool([base]);
    let seenUrl = "";
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async (p) => ((seenUrl = p.mediaUrl), { platformPostId: "ig1", platformPostUrl: "https://instagram.com/p/ig1" })) }, cfg);
    expect(r.published).toBe(1);
    expect(seenUrl).toBe("https://media.example/library/abc.mp4");
    expect(pool.writes[0]!.sql).toMatch(/^update batch_items set status = 'publishing'.*where id = \$1 and status in \('approved', 'queued'\)/);
    expect(pool.writes[1]!.sql).toMatch(/^update batch_items set status = 'published'/);
    expect(pool.writes[1]!.params.slice(0, 4)).toEqual(["item-1", "ig1", "https://instagram.com/p/ig1", 1]);
  });

  it("rejection: queued with a 5-minute backoff and the error", async () => {
    const pool = fakePool([base]);
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => { throw new Error("HTTP 400"); }) }, cfg);
    expect(r.queued).toBe(1);
    const w = pool.writes.find((x) => x.sql.startsWith("update batch_items set status = 'queued'"))!;
    expect(w.params[0]).toBe("item-1");
    expect(w.params[1]).toBe(1);
    expect(Date.parse(w.params[2] as string) - Date.parse(w.params[4] as string)).toBe(5 * 60_000);
    expect(w.params[3]).toBe("HTTP 400");
  });

  it("final rejection at maxAttempts: failed + one alert row + sink", async () => {
    alerts.length = 0;
    const pool = fakePool([{ ...base, status: "queued", attempts: 3, next_attempt_at: NOW }]);
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => { throw new Error("quota"); }, async () => null) }, { ...cfg, alerts: sink });
    expect(r.failed).toBe(1);
    expect(pool.writes.some((w) => w.sql.startsWith("update batch_items set status = 'failed'") && w.params[1] === 4)).toBe(true);
    const a = pool.writes.find((w) => w.sql.startsWith("insert into alerts"))!;
    expect(a.params.slice(0, 3)).toEqual(["final-failure", "item-1", "instagram"]);
    expect(alerts).toHaveLength(1);
  });

  it("network/timeout failure: unknown, alert, and never queued again", async () => {
    const pool = fakePool([base]);
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => { throw new TypeError("fetch failed"); }) }, cfg);
    expect(r.unknown).toBe(1);
    expect(pool.writes.some((w) => w.sql.startsWith("update batch_items set status = 'unknown'"))).toBe(true);
    expect(pool.writes.some((w) => w.sql.startsWith("update batch_items set status = 'queued'"))).toBe(false);
    expect(pool.writes.find((w) => w.sql.startsWith("insert into alerts"))!.params[0]).toBe("unknown-outcome");
  });

  it("retry: asks the adapter whether the post exists before resending, and recovers without a publish call", async () => {
    const pool = fakePool([{ ...base, status: "queued", attempts: 1, next_attempt_at: NOW }]);
    let published = 0;
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => ((published++), { platformPostId: "dup" }), async () => ({ platformPostId: "ig-existing" })) }, cfg);
    expect(r.recovered).toBe(1);
    expect(published).toBe(0);
    expect(pool.writes.find((w) => w.sql.startsWith("update batch_items set status = 'published'"))!.params[1]).toBe("ig-existing");
  });

  it("holds a post when today's count already meets the platform cap", async () => {
    const pool = fakePool([base], { sentToday: 4 });
    let called = false;
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => ((called = true), { platformPostId: "x" })) }, cfg);
    expect(called).toBe(false);
    expect(r.skipped).toBe(1);
    expect(pool.writes.find((w) => w.sql.startsWith("insert into alerts"))!.params[0]).toBe("cap-breach");
  });

  it("a lost claim race means no publish", async () => {
    const pool = fakePool([base], { claimFails: true });
    let called = false;
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => ((called = true), { platformPostId: "x" })) }, cfg);
    expect(called).toBe(false);
    expect(r.skipped).toBe(1);
  });

  it("an r2_key that escapes PUBLIC_MEDIA_BASE fails permanently with a sanitized error; never published", async () => {
    const mediaBase = "https://media.example/bucket";
    for (const key of ["../x.mp4", "a/%2e%2e/%2e%2e/x.mp4", "..\\x.mp4", "a.mp4?x=1", "a.mp4#f"]) {
      alerts.length = 0;
      const pool = fakePool([{ ...base, r2_key: key }]);
      let called = false;
      const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => ((called = true), { platformPostId: "x" })) }, { ...cfg, publicMediaBase: mediaBase, alerts: sink });
      expect(called, key).toBe(false);
      expect(r.failed, key).toBe(1);
      const failed = pool.writes.find((w) => w.sql.startsWith("update batch_items set status = 'failed'"));
      expect(failed, key).toBeDefined();
      const text = [String(failed!.params[2]), ...alerts.map((a) => a.message)].join("\n");
      expect(text).toMatch(/media url/);
      expect(text).not.toContain(mediaBase);
      expect(text).not.toContain("media.example");
      expect(text).not.toContain(key);
      expect(alerts.map((a) => a.kind)).toContain("final-failure");
    }
    // a dry run refuses it too
    let called = false;
    const r = await runOutboxWith(fakePool([{ ...base, r2_key: "../x.mp4" }]), { instagram: adapter("instagram", async () => ((called = true), { platformPostId: "x" })) }, { ...cfg, publicMediaBase: mediaBase, dryRun: true });
    expect(called).toBe(false);
    expect(r.skipped).toBe(1);
  });

  it("skips rows for platforms with no configured adapter", async () => {
    const pool = fakePool([{ ...base, platform: "youtube" }]);
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => ({ platformPostId: "x" })) }, cfg);
    expect(r).toMatchObject({ considered: 1, skipped: 1, published: 0 });
  });
});

describe("loadCadence", () => {
  it("merges posting_windows + cadence overrides over the core defaults", async () => {
    const pool = fakePool([], { settings: { posting_windows: [{ start: "10:00", end: "12:00" }], cadence: { dailyCaps: { tiktok: 2 } } } });
    const c = await loadCadence(pool);
    expect(c.windows).toEqual([{ start: "10:00", end: "12:00" }]);
    expect(c.dailyCaps.tiktok).toBe(2);
    expect(c.dailyCaps.instagram).toBe(4);
  });
});

describe("PgOutboxStore", () => {
  it("maps rows to posts, including the TikTok draft flag and the retry fields", async () => {
    const pool = fakePool([{ ...base, platform: "tiktok", trial: { tiktokDraft: true }, status: "queued", attempts: 2, next_attempt_at: NOW }]);
    const [post] = await new PgOutboxStore(pool, "https://m").listDue(new Date(NOW));
    expect(post).toMatchObject({ id: "item-1", platform: "tiktok", tiktokDraft: true, status: "queued", attempts: 2, nextAttemptAt: "2026-11-01T09:30:00.000Z", mediaId: "media-1", mediaUrl: "https://m/library/abc.mp4" });
  });
  it("listDue SQL carries the approval gate: approved batch and a stamped item", async () => {
    const pool = fakePool([base]);
    await new PgOutboxStore(pool, "https://m").listDue(new Date(NOW));
    const sql = pool.reads.find((r) => r.startsWith("select bi.id"))!;
    expect(sql).toContain("join batches b on b.id = bi.batch_id");
    expect(sql).toContain("b.status = 'approved'");
    expect(sql).toContain("bi.approved_at is not null");
  });
  it("rule: an item fires only if its batch is approved and it carries approved_at (a fake DB that honours the gate)", async () => {
    // The fake plays Postgres: rows come back only when the query actually asks for the gate,
    // so dropping either predicate from listDue empties the outbox here and fails the test.
    const gated = {
      query: async (sql: string) => {
        const s = sql.replace(/\s+/g, " ");
        const hasGate = s.includes("b.status = 'approved'") && s.includes("bi.approved_at is not null");
        return { rows: hasGate ? [base] : [] };
      },
    };
    const due = await new PgOutboxStore(gated, "https://m").listDue(new Date(NOW));
    expect(due.map((p) => p.id)).toEqual(["item-1"]);
  });
  it("countSentOn resolves the day in the given zone inside SQL and never stores it", async () => {
    const pool = fakePool([], { sentToday: 2 });
    const store = new PgOutboxStore(pool, "https://m");
    expect(await store.countSentOn("instagram", "2026-12-01", "Etc/GMT+5")).toBe(2);
    expect(pool.writes).toEqual([]); // a read, not a write
  });
});

// ---- F7 red-team rows (B2/B3, C5, A11) ----
const META = "EAAB" + "x7Yq2Lm9Pz3Kd8Rw4Tn6Vb1Hc5Jf0Gs";
const ZERNIO = "sk_" + "live_9fA3kLm2Qx7Rt8Vw1Yz4Bc6De0Gh";
const SECRETS = [META.slice(4), ZERNIO.slice(4)];
const leaky = `HTTP 400 for /me/media?access_token=${META} (Bearer ${ZERNIO})`;

describe("F7 B2/B3: sanitised writes and console lines", () => {
  afterEach(() => vi.restoreAllMocks());

  it("last_error, the alerts row and the [alert] console line carry no token", async () => {
    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    const errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    const engineLines: string[] = [];
    const pool = fakePool([{ ...base, status: "queued", attempts: 3, next_attempt_at: NOW }]);
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => { throw new Error(leaky); }, async () => null) }, { ...cfg, log: (l) => engineLines.push(l), alerts: undefined });
    expect(r.failed).toBe(1);
    const failed = pool.writes.find((w) => w.sql.startsWith("update batch_items set status = 'failed'"))!;
    const alert = pool.writes.find((w) => w.sql.startsWith("insert into alerts"))!;
    expect(lines.some((l) => l.startsWith("[alert] final-failure"))).toBe(true);
    for (const text of [String(failed.params[2]), String(alert.params[3]), ...lines, ...engineLines]) for (const s of SECRETS) expect(text).not.toContain(s);
    expect(logSpy).toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("the store sanitises even when called directly, and so does the console sink", async () => {
    const pool = fakePool([]);
    const store = new PgOutboxStore(pool, "https://m", () => {});
    await store.markQueued("i", 1, NOW, leaky, new Date(NOW));
    await store.markUnknown("i", 1, leaky, new Date(NOW));
    await store.recordAlert({ kind: "unknown-outcome", platform: "instagram", postId: "i", idempotencyKey: "k", message: leaky, at: NOW });
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    await consoleAlertSink.send({ kind: "unknown-outcome", platform: "instagram", postId: "i", idempotencyKey: "k", message: leaky, at: NOW });
    for (const text of [...pool.writes.flatMap((w) => w.params.map(String)), ...lines]) for (const s of SECRETS) expect(text).not.toContain(s);
  });
});

describe("F7 C5: publish-time privacy lint", () => {
  it("a caption naming a place is refused: never published, failed, alerted", async () => {
    alerts.length = 0;
    const pool = fakePool([{ ...base, caption: "Leg day at Riverside Fitness. Same plan as last week." }]);
    let called = false;
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => ((called = true), { platformPostId: "x" })) }, { ...cfg, alerts: sink, blocklist: [] });
    expect(called).toBe(false);
    expect(r.failed).toBe(1);
    const failed = pool.writes.find((w) => w.sql.startsWith("update batch_items set status = 'failed'"))!;
    expect(failed.params[2]).toMatch(/caption failed privacy lint: privacy\.place/);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "final-failure", postId: "item-1" });
  });

  it("a blocklisted term (from PRIVACY_BLOCKLIST) and a YouTube title are checked too", () => {
    const guard = privacyCaptionGuard(["Quuxville"]);
    const post = { id: "p", idempotencyKey: "k", platform: "youtube" as const, mediaUrl: "u", caption: "steady week", scheduledFor: NOW, status: "approved" as const, attempts: 0 };
    expect(guard(post)).toBeNull();
    expect(guard({ ...post, caption: "back in quuxville" })).toMatch(/privacy\.blocklist/);
    expect(guard({ ...post, title: "Morning run on Oak Ridge Trail" })).toMatch(/privacy\.place/);
  });

  it("style-only lint errors don't block a scheduled post (privacy rules only)", () => {
    const guard = privacyCaptionGuard([]);
    const post = { id: "p", idempotencyKey: "k", platform: "instagram" as const, mediaUrl: "u", caption: "this is insane 🔥🔥", scheduledFor: NOW, status: "approved" as const, attempts: 0 };
    expect(guard(post)).toBeNull();
  });

  it("a clean caption goes through (dry-run logs would publish)", async () => {
    const pool = fakePool([{ ...base, caption: "Same plan as last week. Slow progress is still progress." }]);
    const lines: string[] = [];
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => ({ platformPostId: "x" })) }, { ...cfg, dryRun: true, blocklist: [], log: (l) => lines.push(l) });
    expect(r.skipped).toBe(0);
    expect(lines.join("\n")).toMatch(/dry-run: would publish instagram item-1/);
    expect(pool.writes).toEqual([]);
  });
});

describe("F7 A11: an item with no media file is never fired", () => {
  it("listDue SQL excludes a null r2_key", async () => {
    const pool = fakePool([base]);
    await new PgOutboxStore(pool, "https://m", () => {}).listDue(new Date(NOW));
    expect(pool.reads.find((r) => r.startsWith("select bi.id"))!).toContain("m.r2_key is not null");
  });

  it("a null r2_key row that still comes back yields no post (logged), and the adapter is never called", async () => {
    const lines: string[] = [];
    const pool = fakePool([{ ...base, r2_key: null }]);
    expect(await new PgOutboxStore(pool, "https://m", (l) => lines.push(l)).listDue(new Date(NOW))).toEqual([]);
    expect(lines[0]).toMatch(/item-1.*r2_key is null/);
    let called = false;
    const r = await runOutboxWith(pool, { instagram: adapter("instagram", async () => ((called = true), { platformPostId: "x" })) }, { ...cfg, log: () => {} });
    expect(called).toBe(false);
    expect(r.considered).toBe(0);
    expect(pool.writes).toEqual([]);
  });
});
