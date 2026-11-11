import { describe, expect, it } from "vitest";
import { parseIngestRoots } from "../config.js";

describe("parseIngestRoots", () => {
  it("splits pillar=path entries on the first =, tolerating = in the path", () => {
    expect(parseIngestRoots("gym=C:\\Users\\brody\\Gym Content\\Ready To Post;trading=C:\\Users\\brody\\Trades"))
      .toEqual([
        { pillar: "gym", path: "C:\\Users\\brody\\Gym Content\\Ready To Post" },
        { pillar: "trading", path: "C:\\Users\\brody\\Trades" },
      ]);
  });

  it("throws on an entry with no pillar=", () => {
    expect(() => parseIngestRoots("not-valid")).toThrow();
  });

  it("ignores blank entries", () => {
    expect(parseIngestRoots("gym=C:\\a;;  ;")).toEqual([{ pillar: "gym", path: "C:\\a" }]);
  });
});
