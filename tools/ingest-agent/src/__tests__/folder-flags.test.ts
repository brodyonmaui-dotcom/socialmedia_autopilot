import { describe, expect, it } from "vitest";
import { folderForClip, parseIngestFlags } from "../folder-flags.js";
import { runIngest, summaryLine } from "../run.js";

const flags = (argv: string[]) => {
  const r = parseIngestFlags(argv);
  if (!r.ok) throw new Error(r.error);
  return r.flags;
};
const err = (argv: string[]) => {
  const r = parseIngestFlags(argv);
  return r.ok ? null : r.error;
};

describe("parseIngestFlags", () => {
  it("defaults: nothing set", () => {
    expect(flags([])).toEqual({ dryRun: false, folder: null, folderFromWeek: false, retag: false });
    expect(flags(["--dry-run"]).dryRun).toBe(true);
  });
  it("--folder takes a trimmed label (space or = form)", () => {
    expect(flags(["--folder", "  Upper body "]).folder).toBe("Upper body");
    expect(flags(["--folder=Week of Nov 23"]).folder).toBe("Week of Nov 23");
  });
  it("refuses a missing, empty, long or path-like label", () => {
    expect(err(["--folder"])).toMatch(/needs a label/);
    expect(err(["--folder", "--dry-run"])).toMatch(/needs a label/);
    expect(err(["--folder", "  "])).toMatch(/empty/);
    expect(err(["--folder", "x".repeat(61)])).toMatch(/longer than 60/);
    expect(err(["--folder", "a/b"])).toMatch(/slashes/);
    expect(err(["--folder", "C:\\clips"])).toMatch(/slashes/);
  });
  it("--folder-from only knows week and can't combine with --folder", () => {
    expect(flags(["--folder-from", "week"]).folderFromWeek).toBe(true);
    expect(err(["--folder-from", "month"])).toMatch(/only supports "week"/);
    expect(err(["--folder-from", "week", "--folder", "x"])).toMatch(/not both/);
  });
  it("--retag needs --folder", () => {
    expect(flags(["--folder", "X", "--retag"]).retag).toBe(true);
    expect(err(["--retag"])).toMatch(/needs --folder/);
    expect(err(["--folder-from", "week", "--retag"])).toMatch(/needs --folder/);
  });
});

describe("folderForClip", () => {
  it("fixed label wins; week comes from the captured date in the zone", () => {
    expect(folderForClip({ folder: "X", folderFromWeek: false }, null, "UTC")).toBe("X");
    expect(folderForClip({ folder: null, folderFromWeek: true }, "2026-11-26T12:00:00Z", "UTC")).toBe("Week of Nov 23");
    expect(folderForClip({ folder: null, folderFromWeek: true }, "2026-11-29T23:00:00Z", "Pacific/Auckland")).toBe("Week of Nov 30");
  });
  it("no captured date or no flag: null", () => {
    expect(folderForClip({ folder: null, folderFromWeek: true }, null, "UTC")).toBeNull();
    expect(folderForClip({ folder: null, folderFromWeek: false }, "2026-11-26T12:00:00Z", "UTC")).toBeNull();
  });
});

describe("runIngest --retag", () => {
  const base = (dryRun: boolean, retagged: string[]) => ({
    files: [{ path: "/a/one.mp4", pillar: "p" }],
    dryRun,
    hash: async () => "h1",
    exists: async () => true,
    ingest: async () => "x",
    ping: async () => {},
    log: () => {},
    retag: async (h: string) => (retagged.push(h), true),
  });
  it("re-labels existing clips; a dry run writes nothing", async () => {
    const done: string[] = [];
    const real = await runIngest(base(false, done));
    expect(done).toEqual(["h1"]);
    expect(real.retagged).toBe(1);
    expect(real.skipped).toBe(0);
    const dry: string[] = [];
    const s = await runIngest(base(true, dry));
    expect(dry).toEqual([]);
    expect(summaryLine(s, true)).toContain("1 would be re-labelled");
  });
  it("without retag, existing clips are still skipped untouched", async () => {
    const s = await runIngest({ ...base(false, []), retag: undefined });
    expect(s.skipped).toBe(1);
  });
});
