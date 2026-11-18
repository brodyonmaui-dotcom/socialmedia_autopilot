import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { filenameDate, scanRenders, type ScanDeps } from "../post-ready/scan.js";
import { postReadyLine, validateCaptions, writePostReady, type PostReadyWriteDeps } from "../post-ready/write.js";
import type { ReadyDir } from "../ready/dirs.js";
import { SETTLE_MS } from "../ready/run.js";
import { resolveSidecar, type Sidecar } from "../ready/sidecar.js";
import { trialJson } from "../ready/write.js";

const TRADE = resolve("/renders/trade");
const WORKOUT = resolve("/renders/workout");
const LEGACY = resolve("/renders/ready");
const DIRS: ReadyDir[] = [
  { path: TRADE, source: "trade-recaps" },
  { path: WORKOUT, source: "workout-assembly" },
  { path: LEGACY, source: null },
];
const NOW = new Date("2026-11-18T17:00:00Z");

function memFs(files: Record<string, string>, mtimes: Record<string, number> = {}) {
  const m = new Map(Object.entries(files));
  return {
    files: m,
    list: (dir: string) => [...m.keys()].filter((p) => dirname(p) === dir).map((p) => p.slice(dir.length + 1)),
    exists: (p: string) => m.has(p) || [...m.keys()].some((k) => dirname(k) === p),
    mtimeMs: (p: string) => mtimes[p] ?? 0,
    readText: (p: string) => {
      const v = m.get(p);
      if (v === undefined) throw new Error("ENOENT");
      return v;
    },
    writeText: (p: string, t: string) => void m.set(p, t),
    rename: (from: string, to: string) => {
      const v = m.get(from);
      if (v === undefined) throw new Error("ENOENT");
      m.delete(from);
      m.set(to, v);
    },
  };
}

describe("filenameDate", () => {
  it("reads YYYY-MM-DD, YYYY_MM_DD and YYYYMMDD; rejects impossible dates", () => {
    expect(filenameDate("recap 2026-11-18 es.mp4")).toBe("2026-11-18");
    expect(filenameDate("recap_2026_11_18.mp4")).toBe("2026-11-18");
    expect(filenameDate("legs20261118.mp4")).toBe("2026-11-18");
    expect(filenameDate("recap-2026-02-30.mp4")).toBeNull();
    expect(filenameDate("clip-20261340.mp4")).toBeNull();
    expect(filenameDate("clip-123456789.mp4")).toBeNull();
    expect(filenameDate("clip.mp4")).toBeNull();
    expect(filenameDate("v2 2026-13-01 then 2026-11-17.mp4")).toBe("2026-11-17");
  });
});

describe("scanRenders", () => {
  const setup = (files: Record<string, string>, mtimes: Record<string, number> = {}, probe?: ScanDeps["probe"]) => {
    const warns: string[] = [];
    const probed: string[] = [];
    const d: ScanDeps = {
      dirs: DIRS,
      env: {},
      now: () => NOW,
      fs: memFs(files, mtimes),
      probe: probe ?? (async (f) => (probed.push(f), { durationSec: 21.5, hasAudio: true })),
      warn: (l) => warns.push(l),
    };
    return { d, warns, probed };
  };

  it("lists settled top-level renders without a sidecar, with defaults and facts", async () => {
    const { d, probed } = setup({
      [join(TRADE, "recap-2026-11-18.mp4")]: "v",
      [join(TRADE, "done.mp4")]: "v",
      [join(TRADE, "done.post.json")]: "{}",
      [join(TRADE, ".hidden.mp4")]: "v",
      [join(TRADE, "notes.txt")]: "x",
      [join(TRADE, "_ingested", "old.mp4")]: "v",
      [join(WORKOUT, "legs.mp4")]: "v",
      [join(LEGACY, "legacy.mp4")]: "v",
    });
    const out = await scanRenders(d);
    expect(out.count).toBe(2);
    expect(out.renders).toEqual([
      {
        file: join(TRADE, "recap-2026-11-18.mp4"),
        name: "recap-2026-11-18.mp4",
        source: "trade-recaps",
        defaults: { pillar: "trade-recap", platforms: ["instagram", "youtube", "tiktok"] },
        filenameDate: "2026-11-18",
        durationSec: 21.5,
        hasAudio: true,
      },
      {
        file: join(WORKOUT, "legs.mp4"),
        name: "legs.mp4",
        source: "workout-assembly",
        defaults: { pillar: "workout-log", platforms: ["instagram", "youtube", "tiktok"] },
        filenameDate: null,
        durationSec: 21.5,
        hasAudio: true,
      },
    ]);
    expect(probed).toHaveLength(2);
  });

  it("skips a render still being written; ffprobe failure → nulls, keeps going", async () => {
    const files = { [join(TRADE, "fresh.mp4")]: "v", [join(TRADE, "ok.mp4")]: "v" };
    const { d } = setup(files, { [join(TRADE, "fresh.mp4")]: NOW.getTime() - SETTLE_MS + 5 }, async () => {
      throw new Error("ffprobe not found");
    });
    const out = await scanRenders(d);
    expect(out.renders.map((r) => [r.name, r.durationSec, r.hasAudio])).toEqual([["ok.mp4", null, null]]);
  });

  it("a missing folder is a warning without its path; others still scanned", async () => {
    const { d, warns } = setup({ [join(WORKOUT, "legs.mp4")]: "v" });
    const out = await scanRenders(d);
    expect(out.count).toBe(1);
    expect(warns).toEqual(["post-ready: trade-recaps folder does not exist; skipped"]);
  });
});

const NFA = "Not financial advice.";
const tradeDraft = {
  caption: {
    instagram: `Green day, stuck to the plan. ${NFA} #daytrading #futures`,
    tiktok: `Stuck to the plan today. ${NFA} #daytrading #futures #trading`,
    youtube: { title: "Trade recap: patience paid", description: `Waited for the setup. ${NFA}` },
  },
};

function writeSetup(files: Record<string, string>, over: Partial<PostReadyWriteDeps> = {}) {
  const fs = memFs(files);
  const d: PostReadyWriteDeps = { dirs: DIRS, env: {}, fs, ...over };
  return { d, fs };
}
const render = join(TRADE, "recap.mp4");
const draftPath = resolve("/drafts/recap.json");

describe("writePostReady", () => {
  it("writes a resolved sidecar: when today, folder source, defaults, no approvedInEditor; atomic via a hidden tmp file", () => {
    const { d, fs } = writeSetup({ [render]: "v", [draftPath]: JSON.stringify(tradeDraft) });
    const renames: string[] = [];
    const rename = fs.rename;
    fs.rename = (from, to) => (renames.push(`${from} -> ${to}`), rename(from, to));
    const r = writePostReady(d, render, draftPath);
    expect(postReadyLine(r)).toBe("post-ready: wrote recap.post.json");
    const written = JSON.parse(fs.files.get(join(TRADE, "recap.post.json"))!);
    expect(written).toEqual({
      version: 1,
      pillar: "trade-recap",
      platforms: ["instagram", "youtube", "tiktok"],
      when: "today",
      caption: tradeDraft.caption,
      soundInApp: false,
      source: "trade-recaps",
    });
    expect(renames).toEqual([`${join(TRADE, ".recap.post.json.tmp")} -> ${join(TRADE, "recap.post.json")}`]);
    expect(resolveSidecar(written, "trade-recaps").ok).toBe(true);
  });

  it("draft overrides (pillar, platforms, soundInApp, earliest) are kept", () => {
    const draft = { caption: { instagram: "Legs, slow tempo. #legday" }, pillar: "single-set", platforms: ["instagram"], soundInApp: true, earliest: "18:00" };
    const p = join(WORKOUT, "set.mp4");
    const { d, fs } = writeSetup({ [p]: "v", [draftPath]: JSON.stringify(draft) });
    expect(writePostReady(d, p, draftPath).ok).toBe(true);
    expect(JSON.parse(fs.files.get(join(WORKOUT, "set.post.json"))!)).toMatchObject({ pillar: "single-set", platforms: ["instagram"], soundInApp: true, earliest: "18:00", source: "workout-assembly" });
  });

  it("refuses to overwrite an existing sidecar", () => {
    const { d, fs } = writeSetup({ [render]: "v", [join(TRADE, "recap.post.json")]: "{}", [draftPath]: JSON.stringify(tradeDraft) });
    const r = writePostReady(d, render, draftPath);
    expect(postReadyLine(r)).toBe("post-ready: FAIL recap.mp4: recap.post.json already exists; not overwritten");
    expect(fs.files.get(join(TRADE, "recap.post.json"))).toBe("{}");
  });

  it("render must sit directly in a configured source folder (not legacy, not a subfolder)", () => {
    for (const p of [join(LEGACY, "x.mp4"), join(TRADE, "sub", "x.mp4"), resolve("/elsewhere/x.mp4")]) {
      const { d } = writeSetup({ [p]: "v", [draftPath]: JSON.stringify(tradeDraft) });
      const r = writePostReady(d, p, draftPath);
      expect(r.ok).toBe(false);
      expect(postReadyLine(r)).toMatch(/not directly inside a configured source folder/);
      expect(postReadyLine(r)).not.toContain("/renders");
    }
  });

  it("bad draft JSON, unknown draft keys, a non-mp4 or missing render → FAIL, nothing written", () => {
    const cases: Array<[Record<string, string>, string, RegExp]> = [
      [{ [render]: "v", [draftPath]: "{oops" }, render, /draft is not valid JSON/],
      [{ [render]: "v", [draftPath]: JSON.stringify({ ...tradeDraft, approvedInEditor: "2026-11-18T00:00:00Z" }) }, render, /draft \(root\)/],
      [{ [join(TRADE, "x.mov")]: "v", [draftPath]: "{}" }, join(TRADE, "x.mov"), /must be an \.mp4/],
      [{ [draftPath]: "{}" }, render, /render not found/],
    ];
    for (const [files, p, re] of cases) {
      const { d, fs } = writeSetup(files);
      const before = fs.files.size;
      expect(postReadyLine(writePostReady(d, p, draftPath))).toMatch(re);
      expect(fs.files.size).toBe(before);
    }
  });

  it("caption errors are joined with '; ' and exit as FAIL", () => {
    const draft = { caption: { instagram: "no disclaimer" } };
    const { d, fs } = writeSetup({ [render]: "v", [draftPath]: JSON.stringify(draft) });
    const line = postReadyLine(writePostReady(d, render, draftPath));
    expect(line).toBe(
      'post-ready: FAIL recap.mp4: tiktok caption missing; youtube title missing; youtube description missing; instagram caption needs "Not financial advice."',
    );
    expect(fs.files.has(join(TRADE, "recap.post.json"))).toBe(false);
  });
});

describe("validateCaptions", () => {
  const sc = (over: Partial<Sidecar> = {}): Sidecar => ({
    version: 1,
    pillar: "workout-log",
    platforms: ["instagram", "youtube", "tiktok"],
    when: "today",
    caption: { instagram: "Leg day.", tiktok: "Leg day. #legday #gym #lifting", youtube: { title: "Leg day", description: "Full session." } },
    soundInApp: false,
    source: "workout-assembly",
    ...over,
  });

  it("a clean workout sidecar passes (no NFA needed outside trade recaps)", () => {
    expect(validateCaptions(sc())).toEqual([]);
  });

  it("snapchat needs no caption", () => {
    expect(validateCaptions(sc({ platforms: ["snapchat"], caption: {} }))).toEqual([]);
  });

  it("> 5 hashtags and a > 60 char YouTube title are errors", () => {
    const errs = validateCaptions(
      sc({ caption: { instagram: "a #a #b #c #d #e #f", tiktok: "Leg day. #legday #gym #lifting", youtube: { title: "x".repeat(61), description: "d" } } }),
    );
    expect(errs).toEqual(["instagram caption has 6 hashtags (max 5)", "youtube title over 60 chars"]);
  });

  it("trade recaps need the disclaimer on Instagram, TikTok and the YouTube description (not the title)", () => {
    const errs = validateCaptions(sc({ source: "trade-recaps", pillar: "trade-recap" }));
    expect(errs).toEqual([
      'instagram caption needs "Not financial advice."',
      'tiktok caption needs "Not financial advice."',
      'youtube description needs "Not financial advice."',
    ]);
  });

  it("place / location lint errors block the write; blocklist terms too", () => {
    const named = validateCaptions(sc({ caption: { ...sc().caption, instagram: "Leg day at Riverside Gym." } }));
    expect(named).toEqual(["instagram caption: names an identifiable place (privacy.place)"]);
    const address = validateCaptions(sc({ caption: { ...sc().caption, youtube: { title: "Leg day", description: "Filmed at 42 Maple Street" } } }));
    expect(address.join(" ")).toMatch(/youtube description: .*privacy\.address/);
    const blocked = validateCaptions(sc({ caption: { ...sc().caption, instagram: "Leg day in examplecity." } }), { blocklist: ["examplecity"] });
    expect(blocked).toEqual(["instagram caption: contains a blocklisted private term (privacy.blocklist)"]);
  });
});

describe("trialJson without approvedInEditor", () => {
  it("omits the key instead of writing null", () => {
    const sidecar = resolveSidecar({ version: 1, when: "today", caption: {} }, "trade-recaps");
    if (!sidecar.ok) throw new Error("expected ok");
    const item = { platform: "instagram" as const, ingestKey: "h:instagram", caption: "", title: null, scheduledFor: null, weekStart: "2026-11-16", tiktokDraft: false, flags: [] };
    const editor = JSON.parse(trialJson(sidecar.value, item)).editor;
    expect(editor).toEqual({ source: "trade-recaps", pillar: "trade-recap", when: "today", earliest: null, flags: [] });
  });
});
