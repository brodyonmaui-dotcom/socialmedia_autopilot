import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fingerprintsMatch, type OutboxPost, type PlatformAdapter, type PublishResult } from "@autopilot/core";
import { blockedVideoIds, recentVideoUse } from "@autopilot/db";
import { fingerprintFile, runMediaFingerprintOnce } from "../jobs/media-fingerprint.js";
import { runOutboxWith, type OutboxConfig, type OutboxPool } from "../jobs/outbox.js";

/**
 * F26 A duplicate guard v2 against the dev DB (DATABASE_URL): a fixed copy, a re-upload with a new hash, a renamed
 * copy, an already-posted reject and a reel with new edits, through recentVideoUse / blockedVideoIds; the outbox's
 * pre-publish hold; and the fingerprint backfill with real ffmpeg. Own rows only: archived media (no library job
 * picks them) with a random tag, one batch in a random far-future week, items rejected at the end. Nothing deleted.
 */
const url = process.env.DATABASE_URL;
const TAG = `dupguard-${randomBytes(6).toString("hex")}`;
const YEAR = 2400 + Math.floor(Math.random() * 99);
const monday = (() => {
  const d = new Date(Date.UTC(YEAR, 5, 10));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
})();
const at = (n: number, hh = "12") => new Date(Date.parse(`${monday}T${hh}:00:00Z`) + n * 86_400_000).toISOString();
const NOW = new Date(at(0));
const HAS_FFMPEG = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Two textured 4 s clips that differ, plus a re-encode of the first (new bytes, same picture). */
function makeClips(dir: string): { a: string; aReencoded: string; b: string } {
  const a = join(dir, "a.mp4");
  const b = join(dir, "b.mp4");
  const aReencoded = join(dir, "a2.mp4");
  const ff = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
  ff(["-f", "lavfi", "-i", "testsrc2=size=320x568:rate=30:duration=4", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "20", a]);
  ff(["-f", "lavfi", "-i", "mandelbrot=size=320x568:rate=30", "-t", "4", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "20", b]);
  ff(["-i", a, "-vf", "scale=288:512", "-c:v", "libx264", "-crf", "32", aReencoded]);
  return { a, aReencoded, b };
}

describe.skipIf(!url)("duplicate guard v2 (db)", () => {
  let pool: pg.Pool;
  let batchId: string;
  const m: Record<string, string> = {};
  const items: Record<string, string> = {};
  let fpOrig: string | null = null;
  let tmp: string;
  let clips: ReturnType<typeof makeClips> | null = null;

  const mk = async (key: string, o: { derivedFrom?: string; sourcePath?: string | null; duration?: number; fingerprint?: string | null } = {}) => {
    m[key] = (
      await pool.query(
        `insert into media (content_hash, source_path, r2_key, duration_s, width, height, pillar, status, derived_from, fingerprint, fingerprint_at)
         values ($1, $2, $3, $4, 1080, 1920, 'gym', 'archived', $5, $6, case when $6::text is null then null else now() end) returning id`,
        [`${TAG}-${key}`, o.sourcePath ?? null, `library/${TAG}-${key}.mp4`, o.duration ?? 4, o.derivedFrom ?? null, o.fingerprint ?? null],
      )
    ).rows[0].id;
    return m[key]!;
  };
  const item = async (key: string, media: string, platform: string, when: string, status: string) => {
    items[key] = (
      await pool.query(
        `insert into batch_items (batch_id, media_id, platform, caption, scheduled_for, status, approved_at, platform_post_id)
         values ($1, $2, $3, $4, $5, $6, case when $6 in ('approved','published') then now() end, case when $6 = 'published' then $7 end) returning id`,
        [batchId, media, platform, `dup guard fixture ${key}`, when, status, `${TAG}-${key}`],
      )
    ).rows[0].id;
    return items[key]!;
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 });
    tmp = mkdtempSync(join(tmpdir(), "dupguard-"));
    if (HAS_FFMPEG) {
      clips = makeClips(tmp);
      fpOrig = await fingerprintFile(clips.a);
    }
    batchId = (await pool.query(`insert into batches (week_start, status) values ($1, 'approved') returning id`, [monday])).rows[0].id;
    await mk("orig", { sourcePath: "C:\\Users\\x\\Videos\\IMG_4242.MOV", fingerprint: fpOrig });
    await mk("fix", { derivedFrom: m.orig, sourcePath: "C:\\Users\\x\\Videos\\IMG_4242-fixed.mp4" });
    await mk("reupload", { sourcePath: "upload-from-phone.mp4" }); // fingerprint filled by the backfill test below
    await mk("renamed", { sourcePath: "D:/phone/img_4242.mov", duration: 4.3 });
    await mk("reel", { derivedFrom: m.orig, sourcePath: "IMG_4242-reel.mp4" });
    await pool.query(
      `insert into media_edits (kind, source_media_id, params, status, result_media_id, finished_at) values ('reel', $1, $2::jsonb, 'done', $3, now())`,
      [m.orig, JSON.stringify({ audio: "replace", trimStartS: null, trimEndS: null }), m.reel],
    );
    await mk("posted-by-hand", { sourcePath: "different.mp4", duration: 9 });
    await mk("fresh", { sourcePath: "brand-new.mp4", duration: 7 });
    // The original went out on Instagram 10 days ago; another clip was dropped as "already posted" on TikTok.
    await item("published", m.orig!, "instagram", at(-10), "published");
    await item("ap", m["posted-by-hand"]!, "tiktok", at(-20), "draft");
    await pool.query(`update batch_items set status = 'rejected' where id = $1`, [items.ap]);
    await pool.query(`insert into batch_item_events (batch_item_id, kind, from_status, to_status, detail, at) values ($1, 'reject', 'draft', 'rejected', '{"reason":"already-posted"}'::jsonb, now())`, [items.ap]);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`update batch_items set status = 'rejected', approved_at = null where batch_id = $1`, [batchId]);
    await pool.query(`update batches set status = 'draft', approved_at = null where id = $1`, [batchId]);
    await pool.end();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("a fixed copy is the same video: blocked on Instagram within 90 days, by lineage", async () => {
    const u = await recentVideoUse(pool, { mediaId: m.fix!, platform: "instagram", at: at(1), now: NOW });
    expect(u.level).toBe("block");
    expect(u.hit).toMatchObject({ id: items.published, relation: "same", why: "lineage", wentOut: true });
    // Other platforms are free; 100 days later only a warning.
    expect((await recentVideoUse(pool, { mediaId: m.fix!, platform: "youtube", at: at(1), now: NOW })).level).toBeNull();
    expect((await recentVideoUse(pool, { mediaId: m.fix!, platform: "instagram", at: at(95), now: NOW })).level).toBe("warn");
  });

  it("a renamed copy (same basename, duration within 0.5 s) is the same video", async () => {
    const u = await recentVideoUse(pool, { mediaId: m.renamed!, platform: "instagram", at: at(1), now: NOW });
    expect(u).toMatchObject({ level: "block", hit: { why: "name" } });
  });

  it("a reel with a new sound is derived footage: a warning, flagged for trial reels", async () => {
    const u = await recentVideoUse(pool, { mediaId: m.reel!, platform: "instagram", at: at(1), now: NOW });
    expect(u).toMatchObject({ level: "warn", trialIneligible: true, hit: { relation: "derived" } });
  });

  it("an already-posted reject counts as posted at its time", async () => {
    const u = await recentVideoUse(pool, { mediaId: m["posted-by-hand"]!, platform: "tiktok", at: at(1), now: NOW });
    expect(u).toMatchObject({ level: "block", hit: { id: items.ap, wentOut: true, alreadyPosted: true } });
    expect((await recentVideoUse(pool, { mediaId: m.fresh!, platform: "tiktok", at: at(1), now: NOW })).level).toBeNull();
  });

  it("pickers: blockedVideoIds holds the original's whole same-video family, not derived footage or other clips", async () => {
    const ig = await blockedVideoIds(pool, { platform: "instagram", now: NOW, at: at(1) });
    for (const k of ["orig", "fix", "renamed"]) expect(ig.has(m[k]!), k).toBe(true);
    expect(ig.has(m.reel!)).toBe(false);
    expect(ig.has(m.fresh!)).toBe(false);
    expect((await blockedVideoIds(pool, { platform: "tiktok", now: NOW, at: at(1) })).has(m["posted-by-hand"]!)).toBe(true);
  });

  it.skipIf(!HAS_FFMPEG)("backfill tick fingerprints a re-upload (new hash, re-encoded) and it then matches the posted original", async () => {
    expect(fpOrig).toMatch(/^v1:4(\.\d+)?:/);
    const storage = { download: vi.fn(async (_key: string, to: string) => copyFileSync(clips!.aReencoded, to)), upload: vi.fn(async () => {}) };
    const s = await runMediaFingerprintOnce({ db: pool, storage, onlyMediaIds: [m.reupload!] });
    expect(s).toMatchObject({ done: 1, failed: 0, skipped: null });
    const fp = (await pool.query(`select fingerprint, fingerprint_at from media where id = $1`, [m.reupload])).rows[0];
    expect(fp.fingerprint_at).not.toBeNull();
    expect(fingerprintsMatch(fp.fingerprint, fpOrig)).toBe(true);
    expect(fingerprintsMatch(await fingerprintFile(clips!.b), fpOrig)).toBe(false); // a different clip never matches
    // A second tick has nothing left to do for it.
    expect(await runMediaFingerprintOnce({ db: pool, storage, onlyMediaIds: [m.reupload!] })).toMatchObject({ done: 0, empty: 0, failed: 0 });
    const u = await recentVideoUse(pool, { mediaId: m.reupload!, platform: "instagram", at: at(1), now: NOW });
    expect(u).toMatchObject({ level: "block", hit: { id: items.published, why: "fingerprint" } });
  });

  it("backfill: an unreadable file is stamped (not retried), no fingerprint stored", async () => {
    const id = await mk("garbage", { sourcePath: "garbage.mp4" });
    const storage = { download: vi.fn(async (_key: string, to: string): Promise<void> => void execFileSync("sh", ["-c", `printf 'not a video' > "${to}"`])), upload: vi.fn(async () => {}) };
    expect(await runMediaFingerprintOnce({ db: pool, storage, onlyMediaIds: [id] })).toMatchObject({ done: 0, empty: 1 });
    expect((await pool.query(`select fingerprint, fingerprint_at from media where id = $1`, [id])).rows[0]).toMatchObject({ fingerprint: null, fingerprint_at: expect.any(Date) });
    expect(await runMediaFingerprintOnce({ db: pool, storage, onlyMediaIds: [id] })).toMatchObject({ done: 0, empty: 0, failed: 0 });
  });

  it("outbox: an approved fixed copy due now is HELD (status unchanged, adapter never called, one duplicate-held alert)", async () => {
    const due = await item("due-fix", m.fix!, "instagram", at(0, "11"), "approved");
    const ok = await item("due-fresh", m.fresh!, "instagram", at(0, "11"), "approved");
    const allowed = new Set([due, ok]);
    const scoped: OutboxPool = {
      async query(sql: string, params?: unknown[]) {
        const res = await pool.query(sql, params);
        return { rows: res.rows.filter((r) => !("idempotency_key" in r) || allowed.has(r.id)), rowCount: res.rowCount };
      },
    };
    const publish = vi.fn(async (post: OutboxPost): Promise<PublishResult> => {
      if (!allowed.has(post.id)) throw new Error("non-fixture row");
      return { platformPostId: `${TAG}-out-${post.id.slice(0, 4)}`, platformPostUrl: "https://www.instagram.com/reel/x/" };
    });
    const adapter: PlatformAdapter = { platform: "instagram", publish };
    const cfg: OutboxConfig = { publicMediaBase: "https://media.example.invalid", dryRun: false, timeZone: "UTC", now: () => new Date(at(0, "11")), log: () => {}, alerts: { send: async () => {} }, blocklist: [] };
    await runOutboxWith(scoped, { instagram: adapter }, cfg);
    await runOutboxWith(scoped, { instagram: adapter }, cfg); // a second tick: still held, still one alert
    expect(publish.mock.calls.map((c) => c[0].id)).toEqual([ok]);
    expect((await pool.query(`select status, attempts from batch_items where id = $1`, [due])).rows[0]).toEqual({ status: "approved", attempts: 0 });
    const alerts = (await pool.query(`select kind, platform, message from alerts where batch_item_id = $1`, [due])).rows;
    expect(alerts).toEqual([{ kind: "duplicate-held", platform: "instagram", message: expect.stringMatching(/^This video was already posted on Instagram on \w{3} \w{3} \d{1,2}$/) }]);
    await pool.query(`update alerts set acknowledged_at = now() where batch_item_id = $1`, [due]);
  });
});
