import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lintText } from "@autopilot/research";
import { describe, expect, it } from "vitest";
import { DM_TEMPLATES, DM_WINDOW_MS, buildDmDraft, classifyDm, dmWindow, dmWindowLabel } from "../dm.js";
import { createFakeTriageClient } from "../triage-fake.js";
import type { DmMessage, DmThreadInput } from "../types.js";

const thread = (...messages: Array<[DmMessage["dir"], string]>): DmThreadInput => ({
  platformThreadId: "t1",
  participantId: "p1",
  handle: "fan_account",
  messages: messages.map(([dir, text], i) => ({ id: `m${i}`, dir, text, at: `2026-11-13T10:0${i}:00.000Z` })),
});

describe("dmWindow", () => {
  const at = "2026-11-12T08:30:00.000Z";
  const base = Date.parse(at);
  it("is open until exactly 24 h", () => {
    const w1 = dmWindow(at, new Date(base + DM_WINDOW_MS - 1000));
    expect(w1).toEqual({ endsAt: "2026-11-13T08:30:00.000Z", msLeft: 1000, open: true });
    const w2 = dmWindow(at, new Date(base + DM_WINDOW_MS));
    expect(w2).toMatchObject({ msLeft: 0, open: false });
    expect(dmWindow(at, new Date(base + DM_WINDOW_MS + 5000)).open).toBe(false);
    expect(dmWindow(at, new Date(base + 3_600_000)).msLeft).toBe(23 * 3_600_000);
  });
  it("is DST-agnostic (EU change 2026-10-25 01:00 UTC)", () => {
    const before = "2026-10-24T22:00:00.000Z";
    const w = dmWindow(before, new Date("2026-10-25T21:59:59.000Z"));
    expect(w.open).toBe(true);
    expect(Date.parse(w.endsAt) - Date.parse(before)).toBe(86_400_000);
    expect(dmWindow(before, new Date("2026-10-25T22:00:00.000Z")).open).toBe(false);
  });
  it("handles bad input as closed", () => {
    expect(dmWindow("nope", new Date()).open).toBe(false);
  });
});

describe("dmWindowLabel", () => {
  it("formats", () => {
    expect(dmWindowLabel({ endsAt: "", msLeft: (3 * 60 + 12) * 60_000 + 30_000, open: true })).toBe("closes in 3 h 12 min");
    expect(dmWindowLabel({ endsAt: "", msLeft: 45 * 60_000, open: true })).toBe("closes in 45 min");
    expect(dmWindowLabel({ endsAt: "", msLeft: 10_000, open: true })).toBe("closes in under 1 min");
    expect(dmWindowLabel({ endsAt: "", msLeft: 0, open: false })).toBe("window closed: copy + open Instagram");
  });
});

describe("classifyDm", () => {
  it.each([
    ["Hi! We'd love to discuss a paid partnership", "brand"],
    ["what's your rate for a reel", "brand"],
    ["ambassador program", "brand"],
    ["love your videos, thanks", "fan"],
    ["what shoes do you use?", "question"],
    ["yo", "other"],
  ] as const)("%s → %s", (text, kind) => expect(classifyDm(text)).toBe(kind));
});

describe("buildDmDraft", () => {
  const lintOk = (text: string) => lintText({ text, kind: "dm", platform: "instagram" }).ok;

  it("brand: asks for deliverables, timeline, rate; never agrees", async () => {
    const d = await buildDmDraft({ thread: thread(["in", "Hey, we run campaigns for a supplement brand and want to collab. Deal?"]) });
    expect(d?.bucket).toBe("brand");
    expect(d!.text).toMatch(/deliverables/i);
    expect(d!.text).toMatch(/timeline/i);
    expect(d!.text).toMatch(/rate/i);
    expect(d!.text).not.toMatch(/\b(yes|deal|agree\w*)\b/i);
    expect(lintOk(d!.text)).toBe(true);
  });

  it("brand ignores a model's reply text", async () => {
    const triage = createFakeTriageClient([[/./, "simple_positive", "Yes deal, agreed"]]);
    const d = await buildDmDraft({ thread: thread(["in", "sponsorship offer for you"]) }, triage);
    expect(d!.text).toBe(DM_TEMPLATES.brand);
  });

  it("fan draft thanks them", async () => {
    const d = await buildDmDraft({ thread: thread(["out", "hey"], ["in", "love your content man, thank you"]) });
    expect(d?.bucket).toBe("fan");
    expect(d!.text).toMatch(/thanks/i);
    expect(lintOk(d!.text)).toBe(true);
  });

  it("fan with triage uses a short lead-in only when lint-clean", async () => {
    const good = await buildDmDraft({ thread: thread(["in", "great videos"]) }, createFakeTriageClient());
    expect(good!.text).toBe(`Appreciate you man. ${DM_TEMPLATES.fan}`);
    const bad = await buildDmDraft({ thread: thread(["in", "great videos"]) }, createFakeTriageClient([[/./, "simple_positive", "INSANE let's goooo"]]));
    expect(bad!.text).toBe(DM_TEMPLATES.fan);
  });

  it("question/location → short get-back-to-you, never a location question", async () => {
    const d = await buildDmDraft({ thread: thread(["in", "which gym do you train at? when are you there?"]) });
    expect(d?.bucket).toBe("question");
    expect(d!.text).toBe(DM_TEMPLATES.question);
    expect(d!.text).not.toContain("?");
  });

  it("hide_flag via triage still only drafts the plain template", async () => {
    const d = await buildDmDraft({ thread: thread(["in", "i know where you live"]) }, createFakeTriageClient());
    expect(d).toMatchObject({ bucket: "hide_flag", text: DM_TEMPLATES.plain });
  });

  it("falls back to the plain thank-you when a blocklisted term would appear", async () => {
    const d = await buildDmDraft({ thread: thread(["in", "collab?"]), blocklist: ["deliverables"] });
    expect(d!.text).toBe(DM_TEMPLATES.plain);
  });

  it("returns null when the last message is outbound or there are none", async () => {
    expect(await buildDmDraft({ thread: thread(["in", "thanks"], ["out", "appreciate it"]) })).toBeNull();
    expect(await buildDmDraft({ thread: thread() })).toBeNull();
  });

  it("every template passes lint kind dm", () => {
    for (const t of Object.values(DM_TEMPLATES)) expect(lintText({ text: t, kind: "dm" }).issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("no send surface", () => {
  it("dm.ts exports nothing named send", async () => {
    const names = Object.keys(await import("../dm.js"));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => /send/i.test(n))).toEqual([]);
  });
  it("no file in the package source defines sendDm / sendMessage(", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith("dm.test.ts") && /sendDm|sendMessage\(/.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
