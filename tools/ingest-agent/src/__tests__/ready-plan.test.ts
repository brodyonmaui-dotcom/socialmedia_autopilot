import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE, localDate, localHHMM, localToUtc, normalizeCadence, type Platform } from "@autopilot/core";
import { lintText } from "@autopilot/research";
import { ingestKey, planReadyItems, readyWindow, type ReadyExisting, type ReadyInput } from "../ready/plan.js";
import type { Sidecar } from "../ready/sidecar.js";

// Test zone only (fixtures); the creator's zone lives in .env.
const TZ = "America/New_York";
const at = (ymd: string, hhmm: string) => localToUtc(ymd, hhmm, TZ);
const local = (iso: string | null) => (iso ? `${localDate(new Date(iso), TZ)} ${localHHMM(new Date(iso), TZ)}` : null);
// Default grid: 10:38, 13:00, 16:30, 20:30. 2026-11-18 is a Wednesday.
const WED = "2026-11-18";

const sidecar = (over: Partial<Sidecar> = {}): Sidecar => ({
  version: 1,
  pillar: "workout-log",
  platforms: ["instagram"],
  when: "today",
  caption: { instagram: "leg day", tiktok: "legs", youtube: { title: "Leg day", description: "full session" }, snapchat: "legs" },
  soundInApp: false,
  approvedInEditor: "2026-11-18T15:00:00Z",
  source: "workout-assembly",
  ...over,
});

function plan(over: Partial<ReadyInput> & { sc?: Partial<Sidecar> } = {}) {
  const { sc, ...rest } = over;
  return planReadyItems({
    sidecar: sidecar(sc),
    contentHash: "abc123",
    mediaId: "m1",
    now: at(WED, "12:00"),
    timeZone: TZ,
    cadence: DEFAULT_CADENCE,
    existing: [],
    lint: (text, kind, platform) => lintText({ text, kind, platform }),
    ...rest,
  });
}
const posts = (platform: Platform, ymd: string, times: string[], extra: Partial<ReadyExisting> = {}): ReadyExisting[] =>
  times.map((t) => ({ platform, scheduledFor: at(ymd, t).toISOString(), ...extra }));

describe("ingestKey", () => {
  it("is `${hash}:${platform}`", () => expect(ingestKey("h", "tiktok")).toBe("h:tiktok"));
});

describe("when → window", () => {
  it("today: next grid slot after now, every platform independently (no stagger)", () => {
    const items = plan({ sc: { platforms: ["instagram", "youtube", "tiktok"] } });
    expect(items.map((i) => [i.platform, local(i.scheduledFor)])).toEqual([
      ["instagram", `${WED} 13:00`],
      ["youtube", `${WED} 13:00`],
      ["tiktok", `${WED} 13:00`],
    ]);
    expect(items.every((i) => i.weekStart === "2026-11-16" && i.flags.length === 0)).toBe(true);
    expect(items[0]!.ingestKey).toBe("abc123:instagram");
  });

  it("today + earliest: nothing before earliest", () => {
    expect(local(plan({ sc: { earliest: "17:00" } })[0]!.scheduledFor)).toBe(`${WED} 20:30`);
    // earliest already passed → now wins
    expect(local(plan({ sc: { earliest: "08:00" } })[0]!.scheduledFor)).toBe(`${WED} 13:00`);
  });

  it("tomorrow: from earliest (or the day's start), never today", () => {
    expect(local(plan({ sc: { when: "tomorrow" } })[0]!.scheduledFor)).toBe("2026-11-19 10:38");
    expect(local(plan({ sc: { when: "tomorrow", earliest: "12:00" } })[0]!.scheduledFor)).toBe("2026-11-19 13:00");
  });

  it("this-week: from max(now, earliest) through the local Sunday", () => {
    expect(local(plan({ sc: { when: "this-week", earliest: "21:00" } })[0]!.scheduledFor)).toBe("2026-11-19 10:38");
    const w = readyWindow({ when: "this-week" }, at(WED, "12:00"), TZ);
    expect(w.notAfter.toISOString()).toBe(at("2026-11-23", "00:00").toISOString());
    // Sunday 21:00 → nothing left this week → no-slot, weekStart = that Monday
    const sun = plan({ now: at("2026-11-22", "21:00"), sc: { when: "this-week" } })[0]!;
    expect(sun).toMatchObject({ scheduledFor: null, weekStart: "2026-11-16", flags: ["no-slot"] });
  });

  it("DST week (fall back on Sunday 2026-11-01): wall-clock slot holds, week is the local Monday", () => {
    const sat = at("2026-10-31", "22:00");
    const item = plan({ now: sat, sc: { when: "tomorrow" } })[0]!;
    expect(local(item.scheduledFor)).toBe("2026-11-01 10:38");
    expect(item.scheduledFor).toBe("2026-11-01T15:38:00.000Z"); // EST (UTC-5) after the change
    expect(item.weekStart).toBe("2026-10-26");
    const w = readyWindow({ when: "this-week" }, sat, TZ);
    expect(w.notAfter.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(readyWindow({ when: "tomorrow" }, sat, TZ).notBefore.toISOString()).toBe("2026-11-01T04:00:00.000Z"); // EDT midnight
  });
});

describe("caps and no-slot", () => {
  it("5th post on a day with 4 grid posts goes to the flex grid; a 6th is no-slot (cap 5)", () => {
    const now = at(WED, "08:00");
    const four = posts("instagram", WED, ["10:38", "13:00", "16:30", "20:30"]);
    const fifth = plan({ now, existing: four })[0]!;
    expect(fifth.scheduledFor).not.toBeNull();
    expect(fifth.flags).toEqual([]);
    const five = [...four, { platform: "instagram" as const, scheduledFor: fifth.scheduledFor! }];
    const sixth = plan({ now, existing: five })[0]!;
    expect(sixth).toMatchObject({ scheduledFor: null, flags: ["no-slot"], weekStart: "2026-11-16" });
  });

  it("today full → no-slot, never rolled into tomorrow", () => {
    const item = plan({ existing: posts("instagram", WED, ["09:30", "10:38", "13:00", "16:30", "20:30"]) })[0]!;
    expect(item.scheduledFor).toBeNull();
    expect(item.flags).toContain("no-slot");
  });

  it("a stored cadence with caps 4 still yields 4", () => {
    const cadence = normalizeCadence({ dailyCaps: { instagram: 4, youtube: 4, tiktok: 4, snapchat: 1 } });
    const item = plan({ now: at(WED, "08:00"), cadence, existing: posts("instagram", WED, ["10:38", "13:00", "16:30", "20:30"]) })[0]!;
    expect(item.flags).toEqual(["no-slot"]);
  });
});

describe("captions and flags", () => {
  it("per-platform mapping: YouTube caption = description, title = title", () => {
    const [ig, yt, tt, sc] = plan({ sc: { platforms: ["instagram", "youtube", "tiktok", "snapchat"] } });
    expect([ig!.caption, ig!.title]).toEqual(["leg day", null]);
    expect([yt!.caption, yt!.title]).toEqual(["full session", "Leg day"]);
    expect(tt!.caption).toBe("legs");
    expect(sc!.caption).toBe("legs");
  });

  it("missing or empty caption → needs-caption (YT: empty title or description)", () => {
    const items = plan({ sc: { platforms: ["instagram", "youtube", "tiktok"], caption: { instagram: "  ", youtube: { title: "", description: "d" } } } });
    expect(items.map((i) => i.flags.includes("needs-caption"))).toEqual([true, true, true]);
    const noDesc = plan({ sc: { platforms: ["youtube"], caption: { youtube: { title: "T" } } } })[0]!;
    expect(noDesc.flags).toContain("needs-caption");
    expect(noDesc.caption).toBe("");
  });

  it("soundInApp → TikTok inbox draft, IG/YT add-sound-in-app, Snapchat untouched", () => {
    const items = plan({ sc: { platforms: ["instagram", "youtube", "tiktok", "snapchat"], soundInApp: true } });
    const by = Object.fromEntries(items.map((i) => [i.platform, i]));
    expect(by.tiktok).toMatchObject({ tiktokDraft: true, flags: [] });
    expect(by.instagram!.flags).toEqual(["add-sound-in-app"]);
    expect(by.youtube!.flags).toEqual(["add-sound-in-app"]);
    expect(by.snapchat).toMatchObject({ tiktokDraft: false, flags: [] });
    expect(plan({ sc: { platforms: ["tiktok"] } })[0]!.tiktokDraft).toBe(false);
  });

  it("lint error (street address) → lint-error, still planned", () => {
    const item = plan({ sc: { caption: { instagram: "leg day at 42 Maple Street" } } })[0]!;
    expect(item.flags).toEqual(["lint-error"]);
    expect(item.scheduledFor).not.toBeNull();
    const yt = plan({ sc: { platforms: ["youtube"], caption: { youtube: { title: "Squats at 42 Maple Street", description: "ok" } } } })[0]!;
    expect(yt.flags).toEqual(["lint-error"]);
  });

  it("≥5 TikTok drafts in the 24 h before the slot → tiktok-draft-limit", () => {
    const drafts = (n: number) => posts("tiktok", "2026-11-17", ["14:00", "15:00", "16:00", "17:00", "18:00"].slice(0, n), { tiktokDraft: true });
    const nonDrafts = posts("tiktok", "2026-11-17", ["19:00", "20:00"]);
    const sc = { platforms: ["tiktok" as const], soundInApp: true };
    expect(plan({ sc, existing: drafts(5) })[0]!.flags).toEqual(["tiktok-draft-limit"]);
    expect(plan({ sc, existing: [...drafts(4), ...nonDrafts] })[0]!.flags).toEqual([]);
    // not a draft itself → no limit check
    expect(plan({ sc: { platforms: ["tiktok"] }, existing: drafts(5) })[0]!.flags).toEqual([]);
  });
});
