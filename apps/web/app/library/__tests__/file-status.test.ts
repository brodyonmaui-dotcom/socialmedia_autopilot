import { describe, expect, it } from "vitest";
import { sourceFileStatus } from "../file-status.js";

const disk = (...paths: string[]) => (p: string) => paths.includes(p);
const root = "C:\\Users\\me\\Gym Content\\Ready To Post\\Single Sets";

describe("sourceFileStatus", () => {
  it("present when the file is there", () => {
    expect(sourceFileStatus(`${root}\\Upper Body\\a.mp4`, disk(`${root}\\Upper Body\\a.mp4`, root))).toBe("present");
  });

  it("missing when the file is gone but a nearby folder is reachable (renamed/removed subfolder)", () => {
    // The real orphan: Single Sets\Physique no longer exists, Single Sets does.
    expect(sourceFileStatus(`${root}\\Physique\\shirtless-physique-check.mp4`, disk(root))).toBe("missing");
  });

  it("unknown when nothing near the path is reachable (page running on the server)", () => {
    expect(sourceFileStatus(`${root}\\Upper Body\\a.mp4`, disk("/srv", "/"))).toBe("unknown");
  });

  it("a drive root alone doesn't count as reachable", () => {
    expect(sourceFileStatus("C:\\a.mp4", disk("C:", "C:\\"))).toBe("unknown");
    expect(sourceFileStatus("C:\\x\\a.mp4", disk("C:"))).toBe("unknown");
  });

  it("only climbs a few levels, so a missing whole tree stays unknown", () => {
    expect(sourceFileStatus(`${root}\\Upper Body\\a.mp4`, disk("C:\\Users"))).toBe("unknown");
  });

  it("works with forward slashes too", () => {
    expect(sourceFileStatus("/home/me/clips/old/a.mp4", disk("/home/me/clips"))).toBe("missing");
  });
});
