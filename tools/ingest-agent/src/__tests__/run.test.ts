import { describe, expect, it } from "vitest";
import { isConnectionError, runIngest, summaryLine, type IngestDeps } from "../run.js";

const files = ["a", "b", "c", "d"].map((n) => ({ path: `C:\\clips\\${n}.mp4`, pillar: "gym" }));
const refused = () => Object.assign(new AggregateError([Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5433"), { code: "ECONNREFUSED" })], ""), {});

function deps(over: Partial<IngestDeps> = {}) {
  const lines: string[] = [];
  const ingested: string[] = [];
  const d: IngestDeps = {
    files,
    dryRun: false,
    hash: async (p) => `h-${p}`,
    exists: async () => false,
    ingest: async (f) => {
      ingested.push(f.path);
      return `INGESTED ${f.path}`;
    },
    ping: async () => {},
    log: (l) => lines.push(l),
    sleep: async () => {},
    ...over,
  };
  return { d, lines, ingested };
}

describe("isConnectionError", () => {
  it("recognizes tunnel/DB loss, including pg's empty-message AggregateError", () => {
    expect(isConnectionError(refused())).toBe(true);
    expect(isConnectionError(new Error("read ECONNRESET"))).toBe(true);
    expect(isConnectionError(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isConnectionError(Object.assign(new Error(""), { code: "ECONNRESET" }))).toBe(true);
  });
  it("doesn't mistake a bad file for a lost connection", () => {
    expect(isConnectionError(new Error("ffprobe: Invalid data found when processing input"))).toBe(false);
    expect(isConnectionError(new Error('duplicate key value violates unique constraint "media_content_hash_key"'))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });
});

describe("runIngest", () => {
  it("happy path: ingests new files, skips known hashes and in-run duplicates", async () => {
    const { d, ingested } = deps({ exists: async (h) => h.endsWith("b.mp4"), hash: async (p) => (p.endsWith("d.mp4") ? "h-C:\\clips\\a.mp4" : `h-${p}`) });
    const s = await runIngest(d);
    expect(s).toEqual({ ingested: 2, skipped: 2, failed: 0, stopped: false, remaining: 0 });
    expect(ingested).toEqual(["C:\\clips\\a.mp4", "C:\\clips\\c.mp4"]);
  });

  it("a bad file is counted and the run continues", async () => {
    const { d } = deps({ ingest: async (f) => { if (f.path.endsWith("b.mp4")) throw new Error("ffprobe failed"); return "ok"; } });
    expect(await runIngest(d)).toMatchObject({ ingested: 3, failed: 1, stopped: false });
  });

  it("tunnel drops and stays down: bounded checks, then ONE stop — no error per remaining file", async () => {
    let down = false;
    let pings = 0;
    const { d, lines, ingested } = deps({
      exists: async (h) => { if (h.endsWith("c.mp4")) down = true; if (down) throw refused(); return false; },
      ping: async () => { pings++; throw refused(); },
    });
    const s = await runIngest(d);
    expect(s).toEqual({ ingested: 2, skipped: 0, failed: 0, stopped: true, remaining: 2 });
    expect(ingested).toHaveLength(2);
    expect(pings).toBe(3);
    expect(lines.filter((l) => l.startsWith("ERROR"))).toHaveLength(0);
    expect(summaryLine(s, false)).toMatch(/^ingest: STOPPED — database connection lost .* 2 not reached\. Safe to re-run/);
  });

  it("tunnel blips and comes back: reconnects, retries the same file once, finishes", async () => {
    let blips = 1;
    let pings = 0;
    const { d, lines, ingested } = deps({
      exists: async (h) => { if (h.endsWith("b.mp4") && blips-- > 0) throw new Error("Connection terminated unexpectedly"); return false; },
      ping: async () => { if (++pings < 2) throw refused(); },
    });
    const s = await runIngest(d);
    expect(s).toMatchObject({ ingested: 4, failed: 0, stopped: false });
    expect(ingested).toHaveLength(4);
    expect(lines).toContain("RECONNECTED after 2 check(s)");
  });

  it("DB answers but the file keeps failing on the network (R2): counted as failed, run continues", async () => {
    const { d } = deps({ ingest: async (f) => { if (f.path.endsWith("a.mp4")) throw new Error("socket hang up"); return "ok"; } });
    expect(await runIngest(d)).toMatchObject({ ingested: 3, failed: 1, stopped: false });
  });

  it("backs off between reconnect checks", async () => {
    const waits: number[] = [];
    const { d } = deps({ exists: async () => { throw refused(); }, ping: async () => { throw refused(); }, sleep: async (ms) => { waits.push(ms); }, reconnectBaseMs: 1000 });
    await runIngest(d);
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it("dry run never calls ingest", async () => {
    const { d, ingested, lines } = deps({ dryRun: true });
    const s = await runIngest(d);
    expect(ingested).toHaveLength(0);
    expect(lines.filter((l) => l.startsWith("WOULD INGEST"))).toHaveLength(4);
    expect(summaryLine(s, true)).toBe("ingest (dry run): 4 would be ingested, 0 skipped (dup), 0 failed");
  });
});
