import { describe, expect, it } from "vitest";
import { POSITIVE_POOL } from "../pools.js";
import { normaliseReply, pickReply, seededRng, type RotationHistory } from "../rotation.js";

const empty = (): RotationHistory => ({ recent: [], toAuthor: [], overused: new Set() });
const pool = [...POSITIVE_POOL];

describe("seededRng", () => {
  it("is deterministic per seed and in [0,1)", () => {
    const a = seededRng("abc");
    const b = seededRng("abc");
    const xs = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seededRng("abd")()).not.toBe(xs[0]);
  });
});

describe("pickReply", () => {
  it("is deterministic for the same seed", () => {
    expect(pickReply(pool, empty(), "c-123")).toBe(pickReply(pool, empty(), "c-123"));
  });

  it("spreads over the pool across seeds", () => {
    const picks = new Set(Array.from({ length: 200 }, (_, i) => pickReply(pool, empty(), `s${i}`)));
    expect(picks.size).toBeGreaterThan(pool.length / 2);
  });

  it("excludes recent, toAuthor and overused (normalised)", () => {
    const cands = ["Appreciate you man", "Thanks, means a lot", "Glad it helped", "Haha thanks man"];
    const h: RotationHistory = {
      recent: ["  appreciate   YOU man "],
      toAuthor: ["Thanks, means a lot"],
      overused: new Set(["glad it helped"]),
    };
    for (let i = 0; i < 50; i++) expect(pickReply(cands, h, `x${i}`)).toBe("Haha thanks man");
  });

  it("returns null when everything is excluded", () => {
    expect(pickReply(["A b", "C d"], { recent: ["a b"], toAuthor: [], overused: new Set(["c d"]) }, "s")).toBeNull();
    expect(pickReply([], empty(), "s")).toBeNull();
  });

  it("normalises for comparison", () => {
    expect(normaliseReply("  Thanks,   Means a LOT ")).toBe("thanks, means a lot");
  });

  it("1,000 sequential picks with recent = last 3 never repeat the previous text", () => {
    const sent: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const recent = sent.slice(-3).reverse();
      const pick = pickReply(pool, { recent, toAuthor: [], overused: new Set() }, `comment-${i}`);
      expect(pick).not.toBeNull();
      if (sent.length) expect(pick).not.toBe(sent[sent.length - 1]);
      expect(recent).not.toContain(pick);
      sent.push(pick as string);
    }
  });
});
