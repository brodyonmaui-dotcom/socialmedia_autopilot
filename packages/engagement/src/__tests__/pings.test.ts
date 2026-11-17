import { describe, expect, it } from "vitest";
import { PING_EACH_CAP_PER_HOUR, PING_GENERIC, digestMessage, pingMessage, planPings, type PingItem, type PingState } from "../pings.js";
import { DEFAULT_ENGAGEMENT, normalizeEngagement } from "../settings.js";

const NOW = new Date("2026-01-05T15:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const item = (i: number, over: Partial<PingItem> = {}): PingItem => ({
  commentId: `c${i}`, platform: "instagram", authorHandle: `gym_fan_${i}`, text: "love the energy in this one", draft: "Appreciate you man", reasons: [], ...over,
});
const state = (over: Partial<PingState> = {}): PingState => ({
  sentLastHour: 0, lastPingAt: null, lastDigestAt: null, waiting: { drafted: 5, flagged: 2 }, newSinceLastPing: 3, ...over,
});

describe("engagement.pings setting", () => {
  it("defaults to hourly and only accepts each | hourly | off", () => {
    expect(DEFAULT_ENGAGEMENT.pings).toBe("hourly");
    expect(normalizeEngagement({ pings: "each" }).pings).toBe("each");
    expect(normalizeEngagement({ pings: "off" }).pings).toBe("off");
    expect(normalizeEngagement({ pings: "always" }).pings).toBe("hourly");
    expect(normalizeEngagement({ pings: 3 }).pings).toBe("hourly");
  });
});

describe("pingMessage", () => {
  it("drafted: name, 60-char excerpts, Approve?", () => {
    const long = "this is honestly the best breakdown of position sizing I have seen on any channel so far";
    const m = pingMessage(item(1, { text: long }));
    expect(m).toBe(`@gym_fan_1 commented: "${long.slice(0, 60)}…". Drafted: "Appreciate you man". Approve?`);
  });

  it("flagged: Needs you; no handle → Someone", () => {
    expect(pingMessage(item(1, { draft: null, authorHandle: null, text: "what program do you run?" }))).toBe('Someone commented: "what program do you run?". Needs you.');
  });

  it.each([
    ["a whereabouts comment", item(1, { text: "which gym is this", draft: null })],
    ["a location reason", item(1, { text: "ok", reasons: ["location/schedule"] })],
    ["a street address", item(1, { text: "is that 742 evergreen ave", draft: null })],
    ["a blocklisted term", item(1, { text: "greetings from fooville" })],
    ["a hide reason", item(1, { text: "you are trash", reasons: ["threat"], draft: null })],
  ])("%s → only the generic line (never a place in a push)", (_n, it_) => {
    expect(pingMessage(it_, ["fooville"])).toBe(PING_GENERIC);
  });
});

describe("digestMessage", () => {
  it("counts drafted and needs-you, leaving zero parts out", () => {
    expect(digestMessage({ drafted: 5, flagged: 2 })).toBe("5 replies drafted, 2 need you");
    expect(digestMessage({ drafted: 1, flagged: 0 })).toBe("1 reply drafted");
    expect(digestMessage({ drafted: 0, flagged: 1 })).toBe("1 needs you");
    expect(digestMessage({ drafted: 0, flagged: 0 })).toBe(PING_GENERIC);
  });
});

describe("planPings", () => {
  const items = Array.from({ length: 9 }, (_, i) => item(i));

  it("off: nothing, ever", () => {
    expect(planPings("off", items, state(), NOW)).toEqual([]);
  });

  it("each: one ping per item up to the hourly cap, then one digest", () => {
    const out = planPings("each", items, state(), NOW);
    expect(out.filter((p) => p.kind === "item")).toHaveLength(PING_EACH_CAP_PER_HOUR);
    expect(out.filter((p) => p.kind === "digest")).toEqual([{ kind: "digest", message: "5 replies drafted, 2 need you" }]);
    expect(out[0]).toMatchObject({ kind: "item", commentId: "c0", platform: "instagram" });
  });

  it("each: the cap counts what was already sent this hour; one digest per hour", () => {
    expect(planPings("each", items.slice(0, 2), state({ sentLastHour: 5 }), NOW).map((p) => p.kind)).toEqual(["item", "digest"]);
    expect(planPings("each", items.slice(0, 2), state({ sentLastHour: 6, lastDigestAt: ago(20) }), NOW)).toEqual([]);
    expect(planPings("each", items.slice(0, 2), state({ sentLastHour: 6, lastDigestAt: ago(61) }), NOW).map((p) => p.kind)).toEqual(["digest"]);
    expect(planPings("each", items.slice(0, 2), state(), NOW).map((p) => p.kind)).toEqual(["item", "item"]);
    expect(planPings("each", [], state(), NOW)).toEqual([]);
  });

  it("hourly: one digest when something new waits and the last ping is an hour old", () => {
    expect(planPings("hourly", items, state(), NOW)).toEqual([{ kind: "digest", message: "5 replies drafted, 2 need you" }]);
    expect(planPings("hourly", items, state({ lastPingAt: ago(59) }), NOW)).toEqual([]);
    expect(planPings("hourly", items, state({ lastPingAt: ago(60) }), NOW)).toHaveLength(1);
    expect(planPings("hourly", [], state({ newSinceLastPing: 0 }), NOW)).toEqual([]);
    expect(planPings("hourly", [], state({ waiting: { drafted: 0, flagged: 0 } }), NOW)).toEqual([]);
  });
});
