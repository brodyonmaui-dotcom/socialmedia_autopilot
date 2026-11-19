import { describe, expect, it } from "vitest";
import { parseSidecar, resolveSidecar, sourceDefaults } from "../ready/sidecar.js";

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

  it("rejects version 2, a bad timestamp and a missing required field", () => {
    expect(fail({ version: 2 }).path).toBe("version");
    expect(fail({ approvedInEditor: "yesterday" }).path).toBe("approvedInEditor");
    const { when: _w, ...noWhen } = valid;
    expect(parseSidecar(noWhen)).toMatchObject({ ok: false, path: "when" });
  });

  it("soundInApp defaults to false; approvedInEditor may be absent (= not approved in the editor)", () => {
    const { soundInApp: _s, approvedInEditor: _a, ...bare } = valid;
    const r = parseSidecar(bare);
    expect(r).toMatchObject({ ok: true, value: { soundInApp: false } });
    if (r.ok) expect("approvedInEditor" in r.value).toBe(false);
  });

  it("legacy parse (no folder): pillar / platforms / source are still required", () => {
    for (const key of ["pillar", "platforms", "source"] as const) {
      const { [key]: _drop, ...rest } = valid;
      expect(parseSidecar(rest)).toMatchObject({ ok: false, path: key });
    }
  });
});

describe("resolveSidecar (folder defaults)", () => {
  const minimal = { version: 1, when: "today", caption: { instagram: "x" } };

  it("fills pillar / platforms / source from the folder", () => {
    expect(resolveSidecar(minimal, "trade-recaps")).toMatchObject({
      ok: true,
      value: { pillar: "trade-recap", platforms: ["instagram", "youtube", "tiktok"], source: "trade-recaps", soundInApp: false },
    });
    expect(resolveSidecar(minimal, "workout-assembly")).toMatchObject({
      ok: true,
      value: { pillar: "workout-log", platforms: ["instagram", "youtube", "tiktok"], source: "workout-assembly" },
    });
  });

  it("snapchat joins the workout defaults only with INGEST_SNAPCHAT_DEFAULT=on", () => {
    expect(sourceDefaults("workout-assembly", {}).platforms).not.toContain("snapchat");
    expect(sourceDefaults("workout-assembly", { INGEST_SNAPCHAT_DEFAULT: "off" }).platforms).not.toContain("snapchat");
    expect(sourceDefaults("workout-assembly", { INGEST_SNAPCHAT_DEFAULT: "on" }).platforms).toContain("snapchat");
    expect(sourceDefaults("trade-recaps", { INGEST_SNAPCHAT_DEFAULT: "on" }).platforms).not.toContain("snapchat");
  });

  it("sidecar values win over defaults", () => {
    expect(resolveSidecar({ ...minimal, pillar: "yap", platforms: ["tiktok"] }, "workout-assembly")).toMatchObject({
      ok: true,
      value: { pillar: "yap", platforms: ["tiktok"], source: "workout-assembly" },
    });
  });

  it("a sidecar source that disagrees with the folder fails on source", () => {
    expect(resolveSidecar({ ...minimal, source: "workout-assembly" }, "trade-recaps")).toEqual({
      ok: false,
      path: "source",
      message: "sidecar says workout-assembly but folder is trade-recaps",
    });
    expect(resolveSidecar({ ...minimal, source: "trade-recaps" }, "trade-recaps").ok).toBe(true);
  });

  it("legacy folder (null): the first missing field is the failure path", () => {
    expect(resolveSidecar(minimal, null)).toMatchObject({ ok: false, path: "pillar" });
    expect(resolveSidecar({ ...minimal, pillar: "yap" }, null)).toMatchObject({ ok: false, path: "platforms" });
    expect(resolveSidecar({ ...minimal, pillar: "yap", platforms: ["tiktok"] }, null)).toMatchObject({ ok: false, path: "source" });
  });

  it("still strict: unknown keys fail", () => {
    expect(resolveSidecar({ ...minimal, pilar: "yap" }, "trade-recaps")).toMatchObject({ ok: false, path: "(root)" });
  });
});
