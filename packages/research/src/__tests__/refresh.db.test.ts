import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../../../db/src/client.js";
import { createFakeNoteWriter } from "../auto/ai-notes.js";
import { fixtureDiscover } from "../auto/fixture.js";
import { runResearchRefresh, researchNeverRan } from "../auto/refresh.js";
import { DiscoveryRateLimitError } from "../discovery.js";
import { lastResearchRun, listHookCards, listIdeaCards, researchCounts, setHookUsed, setIdeaUsed } from "../store.js";

/**
 * End-to-end on a scratch schema inside ONE transaction that is always rolled back: the real
 * migrations (0001–0011 + 0013) are applied to a fresh schema, then research-refresh runs twice
 * against the demo Business Discovery fixture. Nothing persists in the dev DB.
 */
const url = process.env.DATABASE_URL;
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const FIXTURE = JSON.parse(readFileSync(new URL("../../fixtures/business-discovery-demo.json", import.meta.url), "utf8"));
const NOW = new Date("2026-11-16T12:00:00Z");

describe.skipIf(!url)("research-refresh end to end (scratch schema, rolled back)", () => {
  const pool = createPool(url ?? "");
  let client: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>; release(): void };

  beforeAll(async () => {
    client = (await pool.connect()) as typeof client;
    await client.query("begin");
    const schema = `rr_test_${process.pid}_${Date.now()}`;
    await client.query(`create schema ${schema}`);
    await client.query(`set local search_path = ${schema}, public`);
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .filter((f) => f <= "0011" || f.startsWith("0013_"))
      .sort();
    for (const f of files) await client.query(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
    for (const [handle, pillar] of [
      ["demo_lifter_one", "gym"],
      ["demo_trader_four", "trading"],
      ["demo_mindset_five", "lifestyle"],
      ["demo_missing_six", "gym"], // not in the fixture → skipped with one note line
    ]) {
      await client.query("insert into creators (platform, handle, pillar) values ('instagram', $1, $2)", [handle, pillar]);
    }
    await client.query("insert into creators (platform, handle, pillar) values ('tiktok', 'demo_tiktok_only', 'gym')"); // never sent to Business Discovery
  });

  afterAll(async () => {
    await client.query("rollback");
    client.release();
    await pool.end();
  });

  const count = async (sql: string) => Number((await client.query(sql)).rows[0].n);

  it("first run: 9 creator ideas, 3 niche, 20 scripts, hooks; a missing creator is one note line", async () => {
    expect(await researchNeverRan(client)).toBe(true);
    const r = await runResearchRefresh(client, { discover: fixtureDiscover(FIXTURE), now: NOW });
    expect(r.ideasAdded).toEqual({ creator: 9, niche: 3, script: 20 });
    expect(r.hooksAdded).toBe(9 + 20);
    expect(r.creatorsChecked).toBe(3);
    expect(r.status).toBe("partial");
    expect(r.note.split("\n")).toEqual([expect.stringMatching(/^@demo_missing_six skipped: business discovery: HTTP 400 code 110/)]);
    expect(await researchNeverRan(client)).toBe(false);

    const run = await lastResearchRun(client);
    expect(run).toMatchObject({ status: "partial", creatorsChecked: 3, ideasAdded: 32, hooksAdded: 29 });
    expect(run!.finishedAt).not.toBeNull();
  });

  it("creator ideas link out, quote only the hook line, and never store a place", async () => {
    const ideas = await listIdeaCards(client, { tab: "ideas", source: "creator" });
    expect(ideas).toHaveLength(9);
    for (const i of ideas) {
      expect(i.referenceUrl).toMatch(/^https:\/\/www\.instagram\.com\/(reel|p)\/DEMO\d+\/$/);
      expect(i.about).toMatch(/^A (reel|video|post|carousel) by @demo_\w+ that opens with a .+ hook: “.+”\.? It got [\d.]+× their usual engagement\.$/);
      expect(i.adapt).toMatch(/Don't/);
      expect(i.creatorHandle).toMatch(/^demo_/);
      expect(i.notesBy).toBe("code");
    }
    const all = JSON.stringify(await client.query("select * from ideas")) + JSON.stringify(await client.query("select * from hooks")) + JSON.stringify(await client.query("select * from creator_media"));
    expect(all).not.toMatch(/Ironside|Harbor Point|Maple Trail/);
    expect(await count("select count(*) n from creator_media")).toBe(33);
    expect(await count("select count(*) n from creator_media where hook_line is null")).toBeGreaterThanOrEqual(3); // the three place lines
    const hooks = await listHookCards(client, { used: false });
    const creatorHook = hooks.find((h) => h.source === "creator")!;
    expect(creatorHook.text).toMatch(/^“.+” \(@demo_\w+\)$/);
    expect(creatorHook.template).not.toBe("");
    expect(hooks.filter((h) => h.source === "script")).toHaveLength(20);
  });

  it("second run on the same fixture: no duplicates, only 3 new niche ideas", async () => {
    const r = await runResearchRefresh(client, { discover: fixtureDiscover(FIXTURE), now: new Date(NOW.getTime() + 3 * 86_400_000) });
    expect(r.ideasAdded).toEqual({ creator: 0, niche: 3, script: 0 });
    expect(r.hooksAdded).toBe(0);
    expect(await count("select count(*) n from (select source_key from ideas where source_key is not null group by 1 having count(*) > 1) d")).toBe(0);
    expect(await count("select count(*) n from (select source_key from hooks where source_key is not null group by 1 having count(*) > 1) d")).toBe(0);
    expect(await count("select count(*) n from ideas where source = 'niche'")).toBe(6);
    expect(await count("select count(*) n from ideas where source = 'script'")).toBe(20);
    expect(await count("select count(*) n from research_runs")).toBe(2);
  });

  it("Used checkbox moves an idea to the archive and back; hooks too", async () => {
    const [first] = await listIdeaCards(client, { tab: "ideas", source: "script" });
    const used = await setIdeaUsed(client, first!.id, true);
    expect(used!.usedAt).not.toBeNull();
    const again = await setIdeaUsed(client, first!.id, true);
    expect(again!.usedAt).toBe(used!.usedAt); // double tap keeps the first time
    expect((await listIdeaCards(client, { tab: "used" })).map((i) => i.id)).toContain(first!.id);
    expect((await listIdeaCards(client, { tab: "ideas" })).map((i) => i.id)).not.toContain(first!.id);
    await setIdeaUsed(client, first!.id, false);
    expect((await listIdeaCards(client, { tab: "used" })).map((i) => i.id)).not.toContain(first!.id);

    const [h] = await listHookCards(client, { used: false });
    const hu = await setHookUsed(client, h!.id, true);
    expect(hu).toMatchObject({ timesUsed: h!.timesUsed + 1 });
    expect((await setHookUsed(client, h!.id, true))!.timesUsed).toBe(h!.timesUsed + 1);
    const c = await researchCounts(client);
    expect(c.hooksUsed).toBe(1);
    expect(c.bySource.script).toBe(20);
    expect(c.bySource.creator).toBe(9);
  });

  it("no credentials: niche + scripts still run and the note says so; rate limit ends a run cleanly", async () => {
    const r = await runResearchRefresh(client, { discover: null, now: NOW });
    expect(r.status).toBe("ok");
    expect(r.note).toMatch(/no Instagram credentials/);
    expect(r.ideasAdded.niche).toBe(3);

    let calls = 0;
    const limited = await runResearchRefresh(client, {
      discover: async () => {
        calls++;
        throw new DiscoveryRateLimitError("HTTP 429");
      },
      now: NOW,
    });
    expect(calls).toBe(1);
    expect(limited.status).toBe("partial");
    expect(limited.note).toMatch(/rate limited at @demo_/);
  });

  it("AI notes: within budget they replace code notes; past the budget the code notes stay", async () => {
    // fresh creator media so there's something new to annotate
    await client.query("insert into creators (platform, handle, pillar) values ('instagram', 'demo_ai_seven', 'gym')");
    const fixture = { demo_ai_seven: structuredClone(FIXTURE.demo_lifter_one) };
    for (const m of fixture.demo_ai_seven.business_discovery.media.data) m.id = m.id.replace(/^9/, "8");
    const writer = createFakeNoteWriter({ tokens: { inputTokens: 1000, outputTokens: 200 } });
    const r = await runResearchRefresh(client, { discover: fixtureDiscover(fixture), noteWriter: writer, aiMonthlyTokens: 3000, now: NOW, maxCreators: 10 });
    expect(r.ideasAdded.creator).toBe(3);
    // 1200 tokens per idea, budget 3000, estimate 1500: first fits (0+1500), second (1200+1500) fits, third (2400+1500) doesn't
    expect(writer.calls).toHaveLength(2);
    expect(r.aiNotes).toBe(2);
    expect(r.note).toMatch(/budget used up/);
    expect(await count("select count(*) n from ideas where notes_by = 'ai'")).toBe(2);
    expect(await count("select input_tokens + output_tokens n from ai_token_usage where purpose = 'research-notes'")).toBe(2400);
  });
});
