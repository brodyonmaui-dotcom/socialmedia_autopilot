// F10 Share state machine: pure, no React, so it can be unit-tested with a fake fetch/navigator.
// Two taps on purpose: "Prepare" downloads the clip (slow), "Share" calls navigator.share() inside a
// fresh user gesture (iOS drops the gesture if a long fetch sits between the tap and share()).
// Never logs or shows the media URL.

/** Must match `basePath` in next.config.mjs (client fetches aren't prefixed automatically). */
export const BASE_PATH = "/app";

export type ShareState =
  | { kind: "idle" }
  | { kind: "blocked" }
  | { kind: "preparing" }
  | { kind: "ready"; file: File; sizeMb: string }
  | { kind: "sharing"; file: File; sizeMb: string }
  | { kind: "shared"; file: File; sizeMb: string }
  | { kind: "error"; message: string; file?: File; sizeMb?: string };

export const CANT_SHARE = "This browser can't share files; open on the iPhone.";

export interface ShareNavigator {
  canShare?: (data: { files?: File[]; text?: string }) => boolean;
  share?: (data: { files?: File[]; text?: string }) => Promise<void>;
}

export type FetchLike = (input: string, init?: { credentials?: "same-origin"; cache?: "no-store" }) => Promise<{
  ok: boolean;
  status: number;
  blob(): Promise<Blob>;
}>;

export function mediaPath(itemId: string): string {
  return `${BASE_PATH}/handoff/media/${encodeURIComponent(itemId)}`;
}

/** Starting state: any block (lint privacy error, no clean file) disables Share entirely. */
export function initialState(blocks: readonly string[]): ShareState {
  return blocks.length > 0 ? { kind: "blocked" } : { kind: "idle" };
}

export function fmtMb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

/** Tap 1: fetch the clip through the same-origin proxy and wrap it as a File. */
export async function prepare(fetchFn: FetchLike, itemId: string, blocks: readonly string[]): Promise<ShareState> {
  if (blocks.length > 0) return { kind: "blocked" };
  try {
    const res = await fetchFn(mediaPath(itemId), { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return { kind: "error", message: res.status === 404 ? "Clip not available (not due, or no clean file). Reload." : `Couldn't load the clip (HTTP ${res.status}).` };
    const blob = await res.blob();
    if (blob.size === 0) return { kind: "error", message: "The clip came back empty." };
    const file = new File([blob], "spotlight.mp4", { type: "video/mp4" });
    return { kind: "ready", file, sizeMb: fmtMb(file.size) };
  } catch {
    return { kind: "error", message: "Couldn't load the clip (network)." };
  }
}

/** Tap 2: hand the file + caption to the share sheet. AbortError (sheet closed) is not an error. */
export async function share(nav: ShareNavigator | undefined, file: File, sizeMb: string, caption: string): Promise<ShareState> {
  const data = { files: [file], text: caption };
  let can = false;
  try {
    can = typeof nav?.canShare === "function" && typeof nav.share === "function" && nav.canShare({ files: [file] }) === true;
  } catch {
    can = false;
  }
  if (!can) return { kind: "error", message: CANT_SHARE, file, sizeMb };
  try {
    await nav!.share!(data);
    return { kind: "shared", file, sizeMb };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return { kind: "ready", file, sizeMb };
    const name = e instanceof Error && e.name && e.name !== "Error" ? e.name : "error";
    return { kind: "error", message: `Share failed (${name}). Try again.`, file, sizeMb };
  }
}

/** What the button says / whether it's tappable, per state. */
export function buttonFor(s: ShareState): { label: string; disabled: boolean; action: "prepare" | "share" | null } {
  switch (s.kind) {
    case "blocked":
      return { label: "Share (blocked)", disabled: true, action: null };
    case "idle":
      return { label: "Prepare", disabled: false, action: "prepare" };
    case "preparing":
      return { label: "Preparing…", disabled: true, action: null };
    case "ready":
      return { label: `Share (${s.sizeMb} MB)`, disabled: false, action: "share" };
    case "sharing":
      return { label: "Sharing…", disabled: true, action: null };
    case "shared":
      return { label: "Share again", disabled: false, action: "share" };
    case "error":
      return s.file ? { label: `Share (${s.sizeMb} MB)`, disabled: false, action: "share" } : { label: "Prepare again", disabled: false, action: "prepare" };
  }
}
