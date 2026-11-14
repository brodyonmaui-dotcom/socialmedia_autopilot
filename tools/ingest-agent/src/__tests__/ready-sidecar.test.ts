import { describe, expect, it } from "vitest";
import { parseSidecar } from "../ready/sidecar.js";

const valid = {
  version: 1,
  pillar: "workout-log",
  platforms: ["instagram", "youtube", "tiktok", "snapchat"],
  when: "today",
  earliest: "17:30",
  caption: { instagram: "leg day", tiktok: "", youtube: { title: "Leg day", description: "full session" }, snapchat: "legs" },
  soundInApp: false,
  approvedInEditor: "2026-11-14T15:02:00Z",
  source: "workout-assembly",
};

const fail = (over: Record<string, unknown>) => {
  const r = parseSidecar({ ...valid, ...over });
  if (r.ok) throw new Error("expected a failure");
  return r;
};

describe("parseSidecar (contract v1)", () => {
  it("accepts the full contract, and without the optional earliest / caption keys", () => {
    expect(parseSidecar(valid)).toMatchObject({ ok: true, value: { pillar: "workout-log", when: "today" } });
    const { earliest: _e, ...noEarliest } = valid;
    expect(parseSidecar({ ...noEarliest, caption: {} }).ok).toBe(true);
    expect(parseSidecar({ ...valid, approvedInEditor: "2026-11-14T10:02:00-05:00" }).ok).toBe(true);
  });

  it("rejects each bad enum with its path", () => {
    expect(fail({ pillar: "gym" }).path).toBe("pillar");
    expect(fail({ when: "next-week" }).path).toBe("when");
    expect(fail({ source: "chatgpt" }).path).toBe("source");
    expect(fail({ platforms: ["instagram", "facebook"] }).path).toBe("platforms.1");
  });

  it("rejects unknown keys (top level and inside caption)", () => {
    expect(fail({ captions: {} }).path).toBe("(root)");
    expect(fail({ caption: { instagram: "x", insta: "y" } }).path).toBe("caption");
    expect(fail({ caption: { youtube: { title: "t", desc: "d" } } }).path).toBe("caption.youtube");
  });

  it("rejects empty or duplicate platforms", () => {
    expect(fail({ platforms: [] }).path).toBe("platforms");
    expect(fail({ platforms: ["tiktok", "tiktok"] })).toMatchObject({ path: "platforms", message: "platforms must be unique" });
  });

  it("rejects a bad earliest", () => {
    for (const earliest of ["24:00", "9:30", "12:60", "noon"]) expect(fail({ earliest }).path).toBe("earliest");
  });

  it("rejects version 2, a bad timestamp and a missing field", () => {
    expect(fail({ version: 2 }).path).toBe("version");
    expect(fail({ approvedInEditor: "yesterday" }).path).toBe("approvedInEditor");
    const { soundInApp: _s, ...noSound } = valid;
    expect(parseSidecar(noSound)).toMatchObject({ ok: false, path: "soundInApp" });
  });
});
