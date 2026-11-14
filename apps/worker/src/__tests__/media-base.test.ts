import { describe, expect, it } from "vitest";
import { isValidMediaBase } from "../jobs/outbox.js";

describe("isValidMediaBase (PUBLIC_MEDIA_BASE)", () => {
  it.each([
    ["", false],
    [undefined, false],
    ["not a url", false],
    ["ftp://x", false],
    ["https://cdn.example.com", true],
    ["https://cdn.example.com/media/", true],
    ["http://localhost:9000/b", true],
    ["https://u:p@x.com", false],
  ] as Array<[string | undefined, boolean]>)("%j → %s", (base, expected) => {
    expect(isValidMediaBase(base)).toBe(expected);
  });

  it("refuses plain http off the local stack, queries and fragments", () => {
    expect(isValidMediaBase("http://127.0.0.1:9000/b")).toBe(true);
    expect(isValidMediaBase("http://cdn.example.com")).toBe(false);
    expect(isValidMediaBase("https://cdn.example.com/m?x=1")).toBe(false);
    expect(isValidMediaBase("https://cdn.example.com/m#x")).toBe(false);
    expect(isValidMediaBase("https://u@x.com")).toBe(false);
  });
});
