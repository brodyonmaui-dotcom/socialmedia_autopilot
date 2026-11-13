import { describe, expect, it, vi } from "vitest";
import { buttonFor, CANT_SHARE, initialState, mediaPath, prepare, share, type FetchLike, type ShareNavigator } from "../share-machine.js";

const ITEM = "0b5e1a2c-0000-4000-8000-000000000001";
const okFetch = (bytes = 2_500_000) =>
  vi.fn<FetchLike>(async () => ({ ok: true, status: 200, blob: async () => new Blob([new Uint8Array(bytes)], { type: "video/mp4" }) }));

function fakeNav(over: Partial<ShareNavigator> = {}): ShareNavigator & { share: ReturnType<typeof vi.fn>; canShare: ReturnType<typeof vi.fn> } {
  return { canShare: vi.fn(() => true), share: vi.fn(async () => undefined), ...over } as never;
}

describe("share machine", () => {
  it("prepare → share: fetches the same-origin proxy under /app, then shares file + caption", async () => {
    const f = okFetch();
    const ready = await prepare(f, ITEM, []);
    expect(f).toHaveBeenCalledWith(`/app/handoff/media/${ITEM}`, expect.objectContaining({ credentials: "same-origin" }));
    expect(ready.kind).toBe("ready");
    if (ready.kind !== "ready") throw new Error("not ready");
    expect(ready.file.type).toBe("video/mp4");
    expect(ready.file.name.endsWith(".mp4")).toBe(true);
    expect(ready.sizeMb).toBe("2.5");
    expect(buttonFor(ready)).toEqual({ label: "Share (2.5 MB)", disabled: false, action: "share" });

    const nav = fakeNav();
    const done = await share(nav, ready.file, ready.sizeMb, "Back day check-in #gym");
    expect(done.kind).toBe("shared");
    expect(nav.canShare).toHaveBeenCalledWith({ files: [ready.file] });
    expect(nav.share).toHaveBeenCalledWith({ files: [ready.file], text: "Back day check-in #gym" });
  });

  it("canShare false → the 'open on the iPhone' message, share() never called", async () => {
    const file = new File([new Uint8Array(10)], "spotlight.mp4", { type: "video/mp4" });
    const nav = fakeNav({ canShare: vi.fn(() => false) });
    const s = await share(nav, file, "0.0", "x");
    expect(s).toMatchObject({ kind: "error", message: CANT_SHARE });
    expect(nav.share).not.toHaveBeenCalled();
  });

  it("canShare missing (or no navigator) → the same message", async () => {
    const file = new File([new Uint8Array(10)], "spotlight.mp4", { type: "video/mp4" });
    expect(await share({ share: vi.fn() }, file, "0.0", "x")).toMatchObject({ kind: "error", message: CANT_SHARE });
    expect(await share(undefined, file, "0.0", "x")).toMatchObject({ kind: "error", message: CANT_SHARE });
  });

  it("AbortError (user closed the sheet) → back to ready, no error", async () => {
    const file = new File([new Uint8Array(10)], "spotlight.mp4", { type: "video/mp4" });
    const nav = fakeNav({ share: vi.fn(async () => Promise.reject(new DOMException("closed", "AbortError"))) });
    const s = await share(nav, file, "0.0", "x");
    expect(s).toEqual({ kind: "ready", file, sizeMb: "0.0" });
  });

  it("other share errors → a short message, file kept for a retry", async () => {
    const file = new File([new Uint8Array(10)], "spotlight.mp4", { type: "video/mp4" });
    const nav = fakeNav({ share: vi.fn(async () => Promise.reject(new DOMException("nope", "NotAllowedError"))) });
    const s = await share(nav, file, "0.0", "x");
    expect(s).toMatchObject({ kind: "error", message: "Share failed (NotAllowedError). Try again." });
    expect(buttonFor(s).action).toBe("share");
  });

  it("blocks non-empty → disabled, and prepare never fetches", async () => {
    const blocks = ["privacy.place: names a place"];
    expect(initialState(blocks)).toEqual({ kind: "blocked" });
    expect(buttonFor(initialState(blocks))).toMatchObject({ disabled: true, action: null });
    const f = okFetch();
    expect(await prepare(f, ITEM, blocks)).toEqual({ kind: "blocked" });
    expect(f).not.toHaveBeenCalled();
    expect(initialState([])).toEqual({ kind: "idle" });
  });

  it("proxy errors never echo the URL", async () => {
    const f404 = vi.fn<FetchLike>(async () => ({ ok: false, status: 404, blob: async () => new Blob() }));
    const s = await prepare(f404, ITEM, []);
    expect(s.kind).toBe("error");
    expect(JSON.stringify(s)).not.toContain("/handoff/media");
    const fNet = vi.fn<FetchLike>(async () => Promise.reject(new TypeError(`failed ${mediaPath(ITEM)}`)));
    const n = await prepare(fNet, ITEM, []);
    expect(n).toEqual({ kind: "error", message: "Couldn't load the clip (network)." });
  });
});
