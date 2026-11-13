import { describe, expect, it } from "vitest";
import { shapeNote, shapeOf } from "../lib.js";

describe("shapeOf (F9 T1)", () => {
  it("lists leaf paths with types, arrays as []", () => {
    expect(shapeOf({ a: [{ b: 1, c: "x" }] })).toBe("a[].b:number,a[].c:string");
    expect(shapeOf({ x: true, y: null, e: {}, l: [] })).toBe("e:object(empty),l:array(empty),x:boolean,y:null");
  });

  it("handles nested arrays and de-duplicates", () => {
    expect(shapeOf({ m: [[1, 2], [3]], d: [{ v: [{ n: 1 }, { n: 2 }] }, { v: [{ n: 3 }] }] })).toBe("d[].v[].n:number,m[][]:number");
  });

  it("unions keys across elements and marks absent ones with ?", () => {
    expect(shapeOf({ data: [{ comments_count: 1, like_count: 2 }, { comments_count: 3 }] })).toBe("data[].comments_count:number,data[].like_count:number?");
    expect(shapeOf([{ v: 1 }, { v: "1" }, { v: null }])).toBe("[].v:null|number|string");
    expect(shapeOf({ d: [{ a: [{ z: 1 }] }, { b: 1 }] })).toBe("d[].a[].z:number?,d[].b:number?");
  });

  it("caps output length with a +N more tail", () => {
    const big = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`field_${String(i).padStart(3, "0")}`, i]));
    const out = shapeOf(big, { maxLen: 100 });
    expect(out.length).toBeLessThan(120);
    expect(out).toMatch(/^field_000:number,.*…\+\d+ more$/);
    const shown = out.split("…")[0]!.split(",").length;
    expect(out.endsWith(`…+${200 - shown} more`)).toBe(true);
    expect(shapeOf(big).length).toBeLessThanOrEqual(1500 + 20);
  });

  it("never outputs values, ids, names, permalinks or tokens; collapses id-like keys", () => {
    const token = "EAAB" + "x9Kq2LmN7pQr4StUv8WxYz1AbCdEf";
    const fixture = {
      id: "17912345678901234",
      caption: "Sunset ride by the harbour",
      username: "creator_handle_here",
      permalink: "https://www.instagram.com/reel/AbC123xyz/",
      access_token: token,
      by_id: { "17998877665544332": { count: 4 }, ["k".repeat(41)]: 1, "has space": 2 },
      data: [{ name: "views", values: [{ value: 1234 }] }],
    };
    const out = shapeOf(fixture);
    for (const v of ["17912345678901234", "Sunset", "harbour", "creator_handle_here", "instagram.com", "AbC123xyz", token.slice(4), "17998877665544332", "k".repeat(41), "has space", "views", "1234"]) {
      expect(out).not.toContain(v);
    }
    expect(out).toContain("by_id.<key>.count:number");
    expect(out).toContain("by_id.<key>:number");
    expect(out).toContain("id:string");
    expect(out).toContain("data[].values[].value:number");
  });
});

describe("shapeNote: the builder behind reel_insight_shape / media_fields_shape / video_stats_shape", () => {
  it("reel_insight_shape: an insights body prints only shapes", () => {
    const body = { data: [{ name: "views", period: "lifetime", values: [{ value: 812 }], title: "Views", description: "Total views", id: "18000000000000001/insights/views/lifetime" }] };
    const r = shapeNote(200, body);
    expect(r).toEqual({ ok: true, note: "data[].description:string,data[].id:string,data[].name:string,data[].period:string,data[].title:string,data[].values[].value:number" });
  });

  it("media_fields_shape: like_count may be hidden", () => {
    expect(shapeNote(200, { comments_count: 3, id: "18000000000000001" })).toEqual({ ok: true, note: "comments_count:number,id:string" });
  });

  it("video_stats_shape: YouTube counts come back as strings", () => {
    const body = { kind: "youtube#videoListResponse", etag: "abc", items: [{ kind: "youtube#video", etag: "def", id: "nk3rl0GYLhE", statistics: { viewCount: "10", likeCount: "2", favoriteCount: "0", commentCount: "1" } }], pageInfo: { totalResults: 1, resultsPerPage: 1 } };
    const r = shapeNote(200, body);
    expect(r.ok).toBe(true);
    expect(r.note).toContain("items[].statistics.viewCount:string");
    expect(r.note).not.toContain("nk3rl0GYLhE");
    expect(r.note).not.toContain("youtube#");
  });

  it("failures give status, code and a redacted message with ids masked", () => {
    const token = "EAAB" + "x9Kq2LmN7pQr4StUv8WxYz1AbCdEf";
    const r = shapeNote(400, { error: { code: 100, message: `Object with ID '17912345678901234' does not exist (access_token=${token})` } });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/^HTTP 400 code 100: Object with ID '<id>'/);
    expect(r.note).not.toContain(token.slice(4));
    expect(shapeNote(403, { error: { errors: [{ reason: "forbidden" }], message: "nope" } }).note).toBe("HTTP 403 code forbidden: nope");
  });
});
