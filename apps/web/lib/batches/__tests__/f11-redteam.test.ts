import { describe, expect, it } from "vitest";
import { fillTimesChanges } from "../fill-times.js";
import { POST_ID_RE, RESET_CHECKLIST, validatePostUrl } from "../reset.js";
import { planTransition, type BatchAction } from "../transitions.js";
import { makeBatch, makeItem, NOW } from "./fixtures.js";

/** F11 red-team pass over the pure layer (review pack f11-pure.md). */
const IG = [...RESET_CHECKLIST.instagram];

describe("F11 red team: status sweeps", () => {
  it("no batch-level or per-item non-F11 action moves a failed/unknown row", () => {
    for (const status of ["failed", "unknown"] as const) {
      const bad = makeItem({ status, attempts: 4 });
      const draft = makeItem();
      const batch = makeBatch([bad, draft]);
      const actions: BatchAction[] = [
        { kind: "approve", itemIds: [bad.id] },
        { kind: "reject", itemIds: [bad.id] },
        { kind: "unapprove", itemIds: [bad.id] },
        { kind: "edit", itemId: bad.id, patch: { caption: "x" } },
        { kind: "edit", itemId: bad.id, patch: { scheduledFor: "2026-11-20T10:00:00.000Z" } },
      ];
      for (const a of actions) expect(planTransition(batch, a, NOW).ok).toBe(false);
      const all = planTransition(batch, { kind: "approve-all" }, NOW);
      expect(all.ok && all.changes.map((c) => c.itemId)).toEqual([draft.id]);
      // fill-times only ever patches drafts, even if handed a patch for the failed row.
      expect(fillTimesChanges(batch, [{ itemId: bad.id, scheduledFor: "2026-11-20T10:00:00.000Z" }]).length).toBe(0);
    }
  });

  it("reset never touches the idempotency key and never leaves attempts at 0", () => {
    const item = makeItem({ status: "failed", attempts: 0 });
    const r = planTransition(makeBatch([item]), { kind: "reset-checked", itemId: item.id, checked: IG, autoCheck: "not-found" }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changes[0]!.patch).toEqual({ attempts: 1, last_error: null, next_attempt_at: null });
    expect(JSON.stringify(r)).not.toMatch(/idempotency/i);
  });
});

describe("F11 red team: auto-check and checklist forgery", () => {
  const item = makeItem({ status: "failed" });
  const batch = makeBatch([item]);
  const reset = (checked: unknown, autoCheck: unknown) =>
    planTransition(batch, { kind: "reset-checked", itemId: item.id, checked: checked as string[], autoCheck: autoCheck as "n/a" }, NOW);

  it("IG: undefined, null, 'found', 'NOT-FOUND' and junk auto-checks are refused", () => {
    for (const a of [undefined, null, "found", "NOT-FOUND", "not-found ", "", 0, {}]) expect(reset(IG, a).ok).toBe(false);
  });

  it("checklist: duplicates are harmless, reorder is fine; extra, whitespace/Unicode variants, non-strings refused", () => {
    expect(reset([...IG, IG[0]], "not-found").ok).toBe(true);
    expect(reset([...IG].reverse(), "not-found").ok).toBe(true);
    expect(reset([IG[0], IG[0], IG[1]], "not-found").ok).toBe(false); // duplicate can't stand in for a missing box
    expect(reset([...IG, "anything else"], "not-found").ok).toBe(false);
    expect(reset([` ${IG[0]}`, IG[1], IG[2]], "not-found").ok).toBe(false);
    expect(reset([IG[0], IG[1]!.replace("→", "->"), IG[2]], "not-found").ok).toBe(false);
    expect(reset([IG[0]!.normalize("NFD").toUpperCase(), IG[1], IG[2]], "not-found").ok).toBe(false);
    expect(reset("Profile grid and Reels tab (newest first)", "not-found").ok).toBe(false);
    expect(reset(null, "not-found").ok).toBe(false);
    expect(reset([...IG, 1], "not-found").ok).toBe(false);
  });

  it("the stored detail.checked is the canonical list, not the submitted array", () => {
    const r = reset([...IG].reverse().concat(IG[0]!), "not-found");
    expect(r.ok && r.changes[0]!.detail!.checked).toEqual(IG);
  });
});

describe("F11 red team: URL evidence", () => {
  const refused = [
    "https://instagram.com.evil.example/p/x",
    "https://instagram.com@evil.example/p/x",
    "https://user:pw@instagram.com/p/x",
    "http://instagram.com/p/x",
    "javascript:alert(1)//instagram.com/p/x",
    "data:text/html,instagram.com/p/x",
    "https://instagram.com./p/x",
    "https://xn--nstagram-6qf.com/p/x", // "іnstagram" with a Cyrillic i
    "https://іnstagram.com/p/x",
    "https://instagram.com:8443/p/x",
    "https://evilinstagram.com/p/x",
    "https://instagram.com",
    "https://instagram.com/",
    `https://instagram.com/p/${"a".repeat(2100)}`,
    "//instagram.com/p/x",
    "https://[::1]/p/x",
  ];
  for (const u of refused) it(`instagram refuses ${u.slice(0, 60)}`, () => expect(validatePostUrl("instagram", u)).toBeNull());

  it("accepted forms normalise safely (uppercase host, default port, backslash stays on the host)", () => {
    expect(validatePostUrl("instagram", "https://WWW.INSTAGRAM.COM/reel/abc/")).toBe("https://www.instagram.com/reel/abc/");
    expect(validatePostUrl("instagram", "https://instagram.com:443/p/x")).toBe("https://instagram.com/p/x");
    expect(new URL(validatePostUrl("instagram", "https://instagram.com\\@evil.example/p")!).hostname).toBe("instagram.com");
    expect(validatePostUrl("youtube", "https://youtu.be/abc")).not.toBeNull();
    expect(validatePostUrl("youtube", "https://m.youtube.com/shorts/abc")).not.toBeNull();
    expect(validatePostUrl("instagram", "https://youtu.be/abc")).toBeNull();
    expect(validatePostUrl("tiktok", "https://m.youtube.com/shorts/abc")).toBeNull();
  });

  it("snapchat: no URL is ever valid and record-published is refused", () => {
    expect(validatePostUrl("snapchat", "https://www.snapchat.com/spotlight/abc")).toBeNull();
    const snap = makeItem({ platform: "snapchat", status: "failed" });
    expect(planTransition(makeBatch([snap]), { kind: "record-published", itemId: snap.id, url: "https://www.snapchat.com/spotlight/abc" }, NOW).ok).toBe(false);
  });

  it("non-string url / id inputs are refused, not thrown", () => {
    const item = makeItem({ status: "unknown" });
    const b = makeBatch([item]);
    expect(planTransition(b, { kind: "record-published", itemId: item.id, url: undefined as unknown as string }, NOW).ok).toBe(false);
    const r = planTransition(b, { kind: "record-published", itemId: item.id, url: "https://instagram.com/p/x", platformPostId: 42 as unknown as string }, NOW);
    expect(r.ok && r.changes[0]!.patch!.platform_post_id).toBeUndefined();
  });
});

describe("F11 red team: POST_ID_RE", () => {
  it("refuses injection-shaped ids, newlines, spaces, slashes, quotes, over-long", () => {
    for (const id of ["1'; drop table x;--", "a b", "a/b", "a\nb", "abc\n", "<x>", "a".repeat(129), "", "%2F", "é"]) expect(POST_ID_RE.test(id)).toBe(false);
    for (const id of ["17890000000000000", "abc_DEF-1.2:3", "a".repeat(128)]) expect(POST_ID_RE.test(id)).toBe(true);
  });
});
