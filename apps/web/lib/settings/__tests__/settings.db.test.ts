import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAP_LIMITS } from "@autopilot/core";
import { loadEngagement, setDmDrafts } from "../../engagement/settings.js";
import { loadCaps, updateCaps } from "../caps.js";

/**
 * Real dev DB (DATABASE_URL). Changes the 'cadence' and 'engagement' settings rows and puts the
 * original values back at the end. The audit alerts it writes ('settings-change', acknowledged) stay:
 * nothing is ever deleted.
 */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("Settings writes (db)", () => {
  let pool: pg.Pool;
  let cadenceOriginal: unknown;
  let engagementOriginal: unknown;
  let engagementExisted = false;
  const start = new Date(Date.now() - 1000);

  const setting = async (key: string) => (await pool.query("select value from settings where key = $1", [key])).rows[0];
  const audit = async (message: string) =>
    (await pool.query(`select platform, acknowledged_at, pushed_at, batch_item_id from alerts where kind = 'settings-change' and message = $1 and created_at >= $2 order by created_at`, [message, start])).rows;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 });
    const c = await setting("cadence");
    if (!c) throw new Error("the 0005 migration seeds the cadence row: migrate the dev DB first");
    cadenceOriginal = c.value;
    const e = await setting("engagement");
    engagementExisted = !!e;
    engagementOriginal = e?.value ?? {};
  });

  afterAll(async () => {
    await pool.query("update settings set value = $2::jsonb, updated_at = now() where key = $1", ["cadence", JSON.stringify(cadenceOriginal)]);
    if (engagementExisted || (await setting("engagement"))) {
      await pool.query("update settings set value = $2::jsonb, updated_at = now() where key = $1", ["engagement", JSON.stringify(engagementOriginal)]);
    }
    await pool.end();
  });

  it("cap save rejects values above CAP_LIMITS and leaves the row alone", async () => {
    const before = (await setting("cadence")).value;
    await expect(updateCaps(pool, { instagram: CAP_LIMITS.instagram + 1 })).rejects.toThrow(RangeError);
    await expect(updateCaps(pool, { snapchat: 2 })).rejects.toThrow(/cap snapchat/);
    expect((await setting("cadence")).value).toEqual(before);
  });

  it("cap save merges the changed platform and writes one acknowledged audit row", async () => {
    const view = await loadCaps(pool);
    const from = view.effective.youtube;
    const to = from === CAP_LIMITS.youtube ? from - 1 : from + 1;
    const res = await updateCaps(pool, { youtube: to, instagram: view.effective.instagram });
    expect(res.message).toBe(`cap youtube ${from}→${to}`);
    const stored = (await setting("cadence")).value as { dailyCaps?: Record<string, number> };
    expect(stored.dailyCaps?.youtube).toBe(to);
    expect((await loadCaps(pool)).effective.youtube).toBe(to);
    const rows = await audit(res.message);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform: "youtube", batch_item_id: null });
    expect(rows[0].acknowledged_at).not.toBeNull();
    expect(rows[0].pushed_at).not.toBeNull();
    // Same values again: nothing written, no audit row.
    expect((await updateCaps(pool, { youtube: to })).message).toBe("");
    expect(await audit(res.message)).toHaveLength(1);
  });

  it("several audit rows with batch_item_id null don't collide on unique (kind, batch_item_id)", async () => {
    const from = (await loadCaps(pool)).effective.tiktok;
    const to = from === CAP_LIMITS.tiktok ? from - 1 : from + 1;
    await updateCaps(pool, { tiktok: to });
    await updateCaps(pool, { tiktok: from });
    expect(await audit(`cap tiktok ${from}→${to}`)).toHaveLength(1);
    expect(await audit(`cap tiktok ${to}→${from}`)).toHaveLength(1);
  });

  it("DM toggle flips dmPollVerified and writes 'dm drafts on|off'", async () => {
    const was = (await loadEngagement(pool)).dmPollVerified;
    const first = await setDmDrafts(pool, !was);
    expect(first).toEqual({ before: was, after: !was });
    expect((await loadEngagement(pool)).dmPollVerified).toBe(!was);
    expect(await audit(`dm drafts ${!was ? "on" : "off"}`)).toHaveLength(1);
    await setDmDrafts(pool, was);
    expect((await loadEngagement(pool)).dmPollVerified).toBe(was);
    expect(await audit(`dm drafts ${was ? "on" : "off"}`)).toHaveLength(1);
    // No change → no audit row.
    await setDmDrafts(pool, was);
    expect(await audit(`dm drafts ${was ? "on" : "off"}`)).toHaveLength(1);
  });
});
