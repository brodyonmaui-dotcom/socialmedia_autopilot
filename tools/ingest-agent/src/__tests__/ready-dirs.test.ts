import { describe, expect, it } from "vitest";
import { dirLabel, parseReadyDirs } from "../ready/dirs.js";

describe("parseReadyDirs", () => {
  it("parses `;` and newline separated entries, splitting on the last `=` (Windows paths)", () => {
    const r = parseReadyDirs({ INGEST_READY_DIRS: "C:\\Renders\\Trade = trade-recaps ;\n/renders/a=b/workout=workout-assembly\n\n;" });
    expect(r.errors).toEqual([]);
    expect(r.dirs).toEqual([
      { path: "C:\\Renders\\Trade", source: "trade-recaps" },
      { path: "/renders/a=b/workout", source: "workout-assembly" },
    ]);
  });

  it("a bad source or a missing `=` is an error naming the entry index, not the path", () => {
    const r = parseReadyDirs({ INGEST_READY_DIRS: "/renders/trade=trade-recaps;/renders/secret=manual;/renders/nosource" });
    expect(r.dirs).toEqual([{ path: "/renders/trade", source: "trade-recaps" }]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/entry 2/);
    expect(r.errors[1]).toMatch(/entry 3/);
    expect(r.errors.join(" ")).not.toContain("/renders");
  });

  it("duplicate paths → error", () => {
    const r = parseReadyDirs({ INGEST_READY_DIRS: "/renders/x=trade-recaps;/renders/x=workout-assembly" });
    expect(r.dirs).toHaveLength(1);
    expect(r.errors).toEqual(["INGEST_READY_DIRS entry 2: duplicate path"]);
  });

  it("legacy INGEST_READY_DIR alone, both together, and deduped by path", () => {
    expect(parseReadyDirs({ INGEST_READY_DIR: "/renders/ready" })).toEqual({ dirs: [{ path: "/renders/ready", source: null }], errors: [] });
    expect(parseReadyDirs({ INGEST_READY_DIR: "/renders/ready", INGEST_READY_DIRS: "/renders/trade=trade-recaps" }).dirs).toEqual([
      { path: "/renders/trade", source: "trade-recaps" },
      { path: "/renders/ready", source: null },
    ]);
    expect(parseReadyDirs({ INGEST_READY_DIR: "/renders/trade", INGEST_READY_DIRS: "/renders/trade=trade-recaps" }).dirs).toEqual([
      { path: "/renders/trade", source: "trade-recaps" },
    ]);
  });

  it("nothing configured → no dirs, no errors", () => {
    expect(parseReadyDirs({})).toEqual({ dirs: [], errors: [] });
    expect(parseReadyDirs({ INGEST_READY_DIRS: " ; \n" })).toEqual({ dirs: [], errors: [] });
  });

  it("labels: the source, or `ready` for legacy", () => {
    expect(dirLabel({ path: "/x", source: "trade-recaps" })).toBe("trade-recaps");
    expect(dirLabel({ path: "/x", source: null })).toBe("ready");
  });
});
