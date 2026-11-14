import { describe, expect, it } from "vitest";
import {
  ackAllCopy,
  alertsHref,
  heroLines,
  isUrgent,
  kindTabs,
  listHead,
  pulseFor,
  pushPulse,
  shownMessage,
  sourceGlyph,
  splitUrgent,
  stateTabs,
} from "../view.js";

describe("alertsHref", () => {
  it("keeps open + no kind as the bare path", () => {
    expect(alertsHref("open")).toBe("/alerts");
    expect(alertsHref("open", "config")).toBe("/alerts?kind=config");
    expect(alertsHref("acknowledged", "auth")).toBe("/alerts?state=acknowledged&kind=auth");
  });
});

describe("hero + pulse", () => {
  it("shows the open count as the big number", () => {
    expect(heroLines(3).map((l) => l.text)).toEqual(["Alerts", "open now", "3"]);
    expect(heroLines(-1)[2]!.text).toBe("0");
  });
  it("urgent beats info; nothing open is blue, never green", () => {
    expect(pulseFor({ "final-failure": 1, config: 2 })).toEqual({ label: "1 needs you", tone: "danger" });
    expect(pulseFor({ "unknown-outcome": 2 })).toEqual({ label: "2 need you", tone: "danger" });
    expect(pulseFor({ config: 1 })).toEqual({ label: "1 notice open", tone: "warn" });
    expect(pulseFor({})).toEqual({ label: "All clear", tone: "accent" });
  });
  it("splits urgent (push set) from info", () => {
    expect(isUrgent("token-health")).toBe(true);
    expect(isUrgent("config")).toBe(false);
    expect(splitUrgent({ "final-failure": 2, "token-health": 1, config: 1, "metrics-health": 3 })).toEqual({ urgent: 3, info: 4 });
  });
});

describe("tabs", () => {
  it("state tabs mark the current one and count open", () => {
    const t = stateTabs("acknowledged", 4);
    expect(t[0]).toMatchObject({ label: "Open", count: 4, active: false, href: "/alerts" });
    expect(t[1]).toMatchObject({ label: "Acknowledged", active: true, href: "/alerts?state=acknowledged" });
  });
  it("kind tabs: All + present kinds in core order; the active one links back to All", () => {
    const t = kindTabs("open", "config", { config: 1, "final-failure": 2 });
    expect(t.map((x) => x.label)).toEqual(["All", "Failed", "Configuration"]);
    expect(t[0]).toMatchObject({ count: 3, active: false });
    expect(t[2]).toMatchObject({ active: true, href: "/alerts" });
    expect(t[1]!.href).toBe("/alerts?kind=final-failure");
  });
  it("keeps an active kind with zero rows visible so it can be cleared", () => {
    expect(kindTabs("open", "auth", {}).map((x) => x.label)).toEqual(["All", "Login"]);
  });
});

describe("rows", () => {
  it("list head per state", () => {
    expect(listHead("open", 3, undefined, 30)).toMatchObject({ title: "Open", meta: "3 shown · newest first" });
    expect(listHead("acknowledged", 0, "config", 30).meta).toBe("Last 30 days · Configuration · kept, never deleted");
  });
  it("platform glyph only for the four platforms; unknown sources are 'other'", () => {
    expect(sourceGlyph("tiktok")).toEqual({ platform: "tiktok", label: "TikTok" });
    expect(sourceGlyph("all")).toEqual({ platform: null, label: "All platforms" });
    expect(sourceGlyph("<b>x</b>")).toEqual({ platform: null, label: "other" });
  });
  it("caps the message", () => {
    expect(shownMessage("short")).toBe("short");
    expect(shownMessage("a".repeat(1200))).toHaveLength(1001);
  });
  it("ack-all copy carries the count and the scope", () => {
    expect(ackAllCopy(1, undefined)).toMatchObject({ title: "Acknowledge 1 alert?", confirm: "Confirm: acknowledge 1" });
    expect(ackAllCopy(3, "config").scope).toBe("All open “Configuration” alerts on this page");
  });
  it("push pulse", () => {
    expect(pushPulse(null, null).tone).toBe("muted");
    expect(pushPulse("ok", true)).toEqual({ label: "On for this device", tone: "accent" });
    expect(pushPulse("denied", null)).toEqual({ label: "Blocked", tone: "warn" });
  });
});
