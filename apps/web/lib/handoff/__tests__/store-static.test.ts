import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanSpotlightUrl, handoffContext } from "../store.js";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const store = read("../store.ts");

describe("handoff store SQL (static)", () => {
  it("never deletes", () => {
    for (const src of [store, read("../media.ts"), read("../../../app/handoff/actions.ts"), read("../../../app/handoff/media/[itemId]/route.ts")]) {
      expect(src).not.toMatch(/\bdelete\s+from\b/i);
    }
  });

  it("every batch_items update goes through the snapchat + approved guard", () => {
    const updates = [...store.matchAll(/update batch_items set [^`]*`/g)].map((m) => m[0]);
    expect(updates.length).toBe(3);
    for (const u of updates) expect(u).toContain("where ${WRITABLE}");
    const guard = /const WRITABLE = `([^`]*)`/.exec(store)?.[1] ?? "";
    for (const cond of ["id = $1", "platform = 'snapchat'", "status = 'approved'", "approved_at is not null", "b.status = 'approved'"]) expect(guard).toContain(cond);
  });

  it("skip locks the snapchat rows in its transaction", () => {
    expect(store).toMatch(/for update/);
    expect(store).toMatch(/pg_advisory_xact_lock/);
  });
});

describe("cleanSpotlightUrl", () => {
  it.each([
    ["https://www.snapchat.com/spotlight/abc", "https://www.snapchat.com/spotlight/abc"],
    ["https://snapchat.com/x", "https://snapchat.com/x"],
    ["  https://story.snapchat.com/s/1  ", "https://story.snapchat.com/s/1"],
  ])("keeps %s", (raw, want) => expect(cleanSpotlightUrl(raw)).toBe(want));

  it.each([
    "http://www.snapchat.com/x",
    "https://evilsnapchat.com/x",
    "https://snapchat.com.evil.example/x",
    "https://user:pw@snapchat.com/x",
    "https://snapchat.com@evil.example/x",
    "https:\\\\evil.example\\@snapchat.com/x",
    "https://snapchat.com./x",
    "javascript:alert(1)",
    "not a url",
    "",
    null,
    undefined,
  ])("drops %s", (raw) => expect(cleanSpotlightUrl(raw)).toBeNull());
});

describe("handoffContext", () => {
  it("never guesses a zone", () => {
    expect(handoffContext({}).timeZone).toBeNull();
    expect(handoffContext({ TZ_CREATOR: "Not/AZone" }).timeZone).toBeNull();
    expect(handoffContext({ TZ_CREATOR: "Europe/London" }).timeZone).toBe("Europe/London");
  });

  it("reads PRIVACY_BLOCKLIST", () => {
    expect(handoffContext({ PRIVACY_BLOCKLIST: "a, b ,," }).blocklist).toEqual(["a", "b"]);
  });
});
